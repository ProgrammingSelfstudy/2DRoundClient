#!/usr/bin/env python3
"""Measure compressed texture sizes on a stratified sample of the original images. Read-only on the originals.

  prepare <zip> <reports-dir> <work-dir>   pick the sample, extract just those files into <work-dir>, run cwebp on each, and write two
                                           Godot projects (astc8 = "VRAM Compressed", astc4 = "VRAM Compressed, high quality") whose
                                           .import files ask Godot for ASTC. Then run in each project:
                                             godot --headless --path <work-dir>/astc8 --import
  collect <reports-dir> <work-dir>         read the sizes Godot produced, join with the cwebp sizes, write textures.json and TEXTURES.md

Godot 4.7.2 writes ETC2 and S3TC when high quality is off and ASTC 4x4 and BPTC when it is on; every one of them is 1 byte per pixel.
It has no ASTC 8x8, so that column is the formula (0.25 byte per pixel) and is labelled so.
"""
import glob
import json
import os
import subprocess
import sys
import zipfile

sys.dont_write_bytecode = True

STRATA = [  # name, predicate, how many
    ("png over 1MB", lambda r: r["fmt"] == "png" and r["bytes"] > 1_000_000, 8),
    ("page >= 2048", lambda r: r["fmt"] == "webp" and max(r["w"], r["h"]) >= 2048, 10),
    ("medium 256-1024", lambda r: 256 <= max(r["w"], r["h"]) <= 1024, 10),
    ("small <= 128", lambda r: max(r["w"], r["h"]) <= 128, 8),
    ("jpg", lambda r: r["fmt"] == "jpg", 4),
]
IMPORT = """[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="res://s/%(n)s"

[params]

compress/mode=2
compress/high_quality=%(hq)s
compress/lossy_quality=0.7
compress/hdr_compression=1
compress/normal_map=0
compress/channel_pack=0
mipmaps/generate=false
mipmaps/limit=-1
roughness/mode=0
roughness/src_normal=""
process/fix_alpha_border=true
process/premult_alpha=false
process/normal_map_invert_y=false
process/hdr_as_srgb=false
process/hdr_clamp_exposure=false
process/size_limit=0
detect_3d/compress_to=0
"""
PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="tex"\n\n[rendering]\n\ntextures/vram_compression/import_etc2_astc=true\n'


def pick(rows):
    chosen, seen = [], set()
    for name, pred, n in STRATA:
        pool = sorted((r for r in rows if pred(r) and r["name"] not in seen), key=lambda r: r["name"])
        step = max(len(pool) // n, 1)
        for r in pool[::step][:n]:
            seen.add(r["name"])
            chosen.append((name, r))
    return chosen


def prepare(zpath, rep, work):
    rows = json.load(open(f"{rep}/audit.json"))["images"]
    chosen = pick(rows)
    z = zipfile.ZipFile(zpath)
    for mode in ("astc8", "astc4"):
        os.makedirs(f"{work}/{mode}/s", exist_ok=True)
        open(f"{work}/{mode}/project.godot", "w").write(PROJECT)
    os.makedirs(f"{work}/webp", exist_ok=True)
    meta = []
    for stratum, r in chosen:
        data = z.read("decoded/" + r["name"])
        n = r["name"]
        # Godot decides the importer by extension: the png-named files that hold webp are saved as .webp
        ext = {"png": "png", "webp": "webp", "jpg": "jpg"}[r["fmt"]]
        fn = n.rsplit(".", 1)[0] + "." + ext
        for mode, hq in (("astc8", "false"), ("astc4", "true")):
            open(f"{work}/{mode}/s/{fn}", "wb").write(data)
            open(f"{work}/{mode}/s/{fn}.import", "w").write(IMPORT % {"n": fn, "hq": hq})
        src = f"{work}/astc8/s/{fn}"
        sizes = {}
        for tag, args in (("webp_q80", ["-q", "80", "-m", "4"]), ("webp_lossless", ["-lossless", "-z", "6"])):
            out = f"{work}/webp/{fn}.{tag}.webp"
            subprocess.run(["cwebp", "-quiet", *args, src, "-o", out], check=False, capture_output=True)
            sizes[tag] = os.path.getsize(out) if os.path.exists(out) else None
        meta.append({"stratum": stratum, "file": fn, "w": r["w"], "h": r["h"], "alpha": r["alpha"], "orig_bytes": r["bytes"],
                     "orig_fmt": r["fmt"], **sizes})
    json.dump(meta, open(f"{work}/samples.json", "w"))
    print(f"{len(meta)} samples prepared in {work}")


def ctex_size(project, fn, kind):
    hits = glob.glob(f"{project}/.godot/imported/{fn}-*.{kind}.ctex")
    return os.path.getsize(hits[0]) if hits else None


def collect(rep, work):
    meta = json.load(open(f"{work}/samples.json"))
    for m in meta:
        m["etc2"] = ctex_size(f"{work}/astc8", m["file"], "etc2")
        m["astc4"] = ctex_size(f"{work}/astc4", m["file"], "astc")
        m["astc8"] = int(m["w"] * m["h"] * 0.25)  # formula, not measured
    done = [m for m in meta if m["etc2"] and m["astc4"] and m["webp_q80"]]
    agg = {}
    for key in ("orig_bytes", "webp_q80", "webp_lossless", "etc2", "astc4", "astc8"):
        agg[key] = sum(m[key] for m in done if m[key])
    agg["gpu_rgba8"] = sum(m["w"] * m["h"] * 4 for m in done)
    strata = {}
    for m in done:
        s = strata.setdefault(m["stratum"], {"n": 0, "px": 0, "orig_bytes": 0, "webp_q80": 0, "webp_lossless": 0, "etc2": 0, "astc4": 0, "astc8": 0})
        s["n"] += 1
        s["px"] += m["w"] * m["h"]
        for key in ("orig_bytes", "webp_q80", "webp_lossless", "etc2", "astc4", "astc8"):
            s[key] += m[key] or 0
    json.dump({"samples": meta, "total": agg, "strata": strata, "measured": len(done)}, open(f"{rep}/textures_raw.json", "w"))
    mb = lambda n: f"{n / 1e6:.2f}"
    md = ["# 压缩纹理体积实测（抽样）\n", f"抽样 {len(meta)} 张，其中 {len(done)} 张完成全部编码。WebP 用 cwebp 1.6.0 实测，ETC2 和 ASTC 4x4 用 Godot 4.7.2 的导入器实测（都是 1 字节/像素）。"
          "ASTC 8x8 Godot 不提供，该列是按 0.25 字节/像素的公式算的，没有实测，也没评估画质。\n",
          "| 抽样层 | 张数 | 原文件 MB | WebP q80 MB | WebP 无损 MB | ETC2 MB（实测） | ASTC 4x4 MB（实测） | ASTC 8x8 MB（公式） | 解码为 RGBA8 的显存 MB |", "|---|---|---|---|---|---|---|---|---|"]
    for k, s in strata.items():
        md.append(f"| {k} | {s['n']} | {mb(s['orig_bytes'])} | {mb(s['webp_q80'])} | {mb(s['webp_lossless'])} | {mb(s['etc2'])} | {mb(s['astc4'])} | {mb(s['astc8'])} | {mb(s['px'] * 4)} |")
    md.append(f"| **合计** | {len(done)} | {mb(agg['orig_bytes'])} | {mb(agg['webp_q80'])} | {mb(agg['webp_lossless'])} | {mb(agg['etc2'])} | {mb(agg['astc4'])} | {mb(agg['astc8'])} | {mb(agg['gpu_rgba8'])} |")
    open(f"{rep}/TEXTURES.md", "w").write("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    if sys.argv[1] == "prepare":
        prepare(*sys.argv[2:5])
    else:
        collect(*sys.argv[2:4])
