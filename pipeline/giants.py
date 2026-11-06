#!/usr/bin/env python3
"""Re-encode the atlas pages of the giant Spine effects as lossy webp and measure size and PSNR. Read-only on the originals.

Pages are kept at their stored size: the atlas shows frames at the size they are drawn on the 720x1280 design canvas (E77901's 570x1012
cut-in frames), so scaling would blur them. Only the encoding changes, so the .atlas file stays valid. Pages that already are lossy
webp are skipped: re-encoding them gains nothing (measured earlier, +-3%).

  python3 pipeline/giants.py <decrypted-images.zip> <reports-dir> <out-dir> [min-raw-MB]
"""
import json
import os
import re
import subprocess
import sys
import zipfile

sys.dont_write_bytecode = True
QUALITIES = (75, 85, 92)


def psnr(out):
    m = re.search(r"PSNR.*?:\s*([\d.]+)|(\d+\.\d+)\s+\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+\s+(\d+\.\d+)", out)
    nums = re.findall(r"(\d+\.\d+)", out)
    return float(nums[-1]) if nums else None


def main(zpath, rep, work, min_mb):
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    audit = {r["name"].rsplit(".", 1)[0]: r for r in json.load(open(f"{rep}/audit.json"))["images"]}
    z = zipfile.ZipFile(zpath)
    models = {}
    for h, p in found.items():
        parts = p.split("/")
        if p.startswith("v9o8") and p.endswith(".png") and h in audit:
            models.setdefault(parts[1], []).append((parts[2].rsplit(".", 1)[0], audit[h]))
    giants = {m: v for m, v in models.items() if sum(r["bytes"] for _, r in v) >= min_mb * 1e6}
    results = []
    for model, pages in sorted(giants.items(), key=lambda kv: -sum(r["bytes"] for _, r in kv[1])):
        for action, r in pages:
            if r["fmt"] != "png":
                results.append({"model": model, "action": action, "fmt": r["fmt"], "w": r["w"], "h": r["h"], "orig": r["bytes"], "skipped": "already webp"})
                continue
            src = f"{work}/src/{model}-{action}.png"
            os.makedirs(os.path.dirname(src), exist_ok=True)
            open(src, "wb").write(z.read("decoded/" + r["name"]))
            row = {"model": model, "action": action, "fmt": "png", "w": r["w"], "h": r["h"], "alpha": r["alpha"], "orig": r["bytes"], "q": {}}
            for q in QUALITIES:
                out = f"{work}/out/{model}/{action}.q{q}.webp"
                os.makedirs(os.path.dirname(out), exist_ok=True)
                p = subprocess.run(["cwebp", "-q", str(q), "-m", "6", "-alpha_q", "100", "-exact", "-print_psnr", src, "-o", out], capture_output=True, text=True)
                row["q"][q] = {"bytes": os.path.getsize(out) if os.path.exists(out) else None, "psnr": psnr(p.stderr)}
            results.append(row)
        print(model, "done", flush=True)
    json.dump(results, open(f"{rep}/giants.json", "w"))
    mb = lambda n: f"{n / 1e6:.2f}"
    md = ["# 巨型特效图集页：转有损 WebP 的实测（页面尺寸不变）\n",
          "原图是 PNG 的页面用 cwebp 重新编码（alpha 无损，`-exact` 保留透明区域颜色）。PSNR 是 cwebp 对编码结果和原图算出的数值，**只是客观数字，不等于肉眼看不出差别**，需要用预览页对比确认。\n",
          "| 模型 | 页 | 尺寸 | 原 MB | q75 MB (PSNR) | q85 MB (PSNR) | q92 MB (PSNR) |", "|---|---|---|---|---|---|---|"]
    tot = {"orig": 0, 75: 0, 85: 0, 92: 0}
    for r in results:
        if r.get("skipped"):
            md.append(f"| {r['model']} | {r['action']} | {r['w']}x{r['h']} | {mb(r['orig'])} | 已是 WebP，跳过 | | |")
            continue
        cells = [f"{mb(r['q'][q]['bytes'])} ({r['q'][q]['psnr']})" for q in QUALITIES]
        md.append(f"| {r['model']} | {r['action']} | {r['w']}x{r['h']} | {mb(r['orig'])} | " + " | ".join(cells) + " |")
        tot["orig"] += r["orig"]
        for q in QUALITIES:
            tot[q] += r["q"][q]["bytes"] or 0
    md.append(f"\n**PNG 页合计**：原 {mb(tot['orig'])} MB → q75 {mb(tot[75])} / q85 {mb(tot[85])} / q92 {mb(tot[92])} MB")
    open(f"{rep}/GIANTS.md", "w").write("\n".join(md) + "\n")
    print("\n".join(md[-14:]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else 8.0)
