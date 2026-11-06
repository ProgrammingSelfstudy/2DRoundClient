#!/usr/bin/env python3
"""Read-only audit of the decrypted original images.

Reads decrypted-images.zip member by member (nothing is extracted) and reports, per image: real format, pixel size, alpha, file
bytes and the GPU memory it costs once decoded (w*h*4). Exact duplicates are found by the sha256 in the zip's manifest.json.
No third-party packages: PNG, WebP and JPEG headers are parsed by hand.

  python3 pipeline/audit.py <decrypted-images.zip> <out-dir>
"""
import collections
import json
import struct
import sys
import zipfile


def png_info(b):
    w, h = struct.unpack(">II", b[16:24])
    return "png", w, h, b[25] in (4, 6) or b"tRNS" in b[:512]


def webp_info(b):
    kind = b[12:16]
    if kind == b"VP8 ":
        w, h = struct.unpack("<HH", b[26:30])
        return "webp", w & 0x3FFF, h & 0x3FFF, False
    if kind == b"VP8L":
        bits = struct.unpack("<I", b[21:25])[0]
        return "webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1, bool((bits >> 28) & 1)
    if kind == b"VP8X":
        w = int.from_bytes(b[24:27], "little") + 1
        h = int.from_bytes(b[27:30], "little") + 1
        return "webp", w, h, bool(b[20] & 0x10)
    raise ValueError("unknown webp chunk")


def jpg_info(b):
    i = 2
    while i + 9 < len(b):
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", b[i + 5:i + 9])
            return "jpg", w, h, False
        i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
    raise ValueError("no SOF")


def info(b):
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return png_info(b)
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return webp_info(b)
    if b[:2] == b"\xff\xd8":
        return jpg_info(b)
    raise ValueError("unrecognised image")


def main(zip_path, out_dir):
    z = zipfile.ZipFile(zip_path)
    manifest = json.loads(z.read("manifest.json"))
    sha = {m["decoded"].rsplit("/", 1)[-1]: m["decoded_sha256"] for m in manifest if m.get("decoded")}
    rows, bad = [], []
    for zi in z.infolist():
        name = zi.filename
        if zi.is_dir() or not name.startswith("decoded/"):
            continue
        base = name.rsplit("/", 1)[-1]
        try:
            fmt, w, h, alpha = info(z.read(zi)[:4096] if not name.endswith(".jpg") else z.read(zi))
        except Exception as e:  # keep going: the report lists what could not be read
            bad.append({"name": base, "bytes": zi.file_size, "error": str(e)})
            continue
        rows.append({"name": base, "fmt": fmt, "w": w, "h": h, "alpha": alpha, "bytes": zi.file_size,
                     "gpu": w * h * 4, "sha": sha.get(base, "")})

    groups = collections.defaultdict(list)
    for r in rows:
        if r["sha"]:
            groups[r["sha"]].append(r)
    dups = [g for g in groups.values() if len(g) > 1]
    dup_extra_bytes = sum(sum(x["bytes"] for x in g[1:]) for g in dups)

    def pot(n):
        return n & (n - 1) == 0

    total = sum(r["bytes"] for r in rows)
    gpu = sum(r["gpu"] for r in rows)
    big = sorted((r for r in rows if r["bytes"] > 1_000_000), key=lambda r: -r["bytes"])
    huge = sorted((r for r in rows if max(r["w"], r["h"]) > 2048), key=lambda r: -r["gpu"])
    gpu_top = sorted(rows, key=lambda r: -r["gpu"])[:30]
    buckets = collections.Counter()
    for r in rows:
        s = max(r["w"], r["h"])
        buckets["<=64" if s <= 64 else "<=256" if s <= 256 else "<=512" if s <= 512 else "<=1024" if s <= 1024
                else "<=2048" if s <= 2048 else ">2048"] += 1
    by_fmt = collections.Counter(r["fmt"] for r in rows)

    summary = {
        "images": len(rows), "unreadable": len(bad), "total_bytes": total, "gpu_bytes_if_all_loaded": gpu,
        "formats": dict(by_fmt), "with_alpha": sum(r["alpha"] for r in rows),
        "over_1mb": len(big), "over_1mb_bytes": sum(r["bytes"] for r in big),
        "longest_side_over_2048": len(huge), "non_power_of_two": sum(not (pot(r["w"]) and pot(r["h"])) for r in rows),
        "longest_side_buckets": dict(buckets),
        "duplicate_groups": len(dups), "duplicate_files": sum(len(g) - 1 for g in dups), "duplicate_bytes": dup_extra_bytes,
    }
    with open(f"{out_dir}/audit.json", "w") as f:
        json.dump({"summary": summary, "images": rows, "unreadable": bad}, f)
    with open(f"{out_dir}/AUDIT.md", "w") as f:
        mb = lambda n: f"{n / 1e6:.1f}"
        f.write("# 原版图片体检（只读）\n\n")
        for k, v in summary.items():
            f.write(f"- {k}: {v}\n")
        f.write("\n## 文件超过 1MB（前 40）\n\n| 名称 | 格式 | 尺寸 | 文件 MB | 解码后显存 MB |\n|---|---|---|---|---|\n")
        for r in big[:40]:
            f.write(f"| {r['name']} | {r['fmt']} | {r['w']}x{r['h']} | {mb(r['bytes'])} | {mb(r['gpu'])} |\n")
        f.write("\n## 解码后显存最大（前 30）\n\n| 名称 | 格式 | 尺寸 | 文件 MB | 显存 MB |\n|---|---|---|---|---|\n")
        for r in gpu_top:
            f.write(f"| {r['name']} | {r['fmt']} | {r['w']}x{r['h']} | {mb(r['bytes'])} | {mb(r['gpu'])} |\n")
        f.write("\n## 完全相同的重复文件（浪费最多的前 20 组）\n\n")
        for g in sorted(dups, key=lambda g: -sum(x["bytes"] for x in g[1:]))[:20]:
            f.write(f"- {len(g)} 份，每份 {g[0]['bytes']} 字节：{', '.join(x['name'] for x in g[:4])}\n")
        if bad:
            f.write("\n## 读不出来的文件\n\n" + "\n".join(f"- {b['name']}: {b['error']}" for b in bad) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
