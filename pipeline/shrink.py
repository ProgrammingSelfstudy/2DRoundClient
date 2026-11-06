#!/usr/bin/env python3
"""Estimate how much the images shrink when drawn at the size the layouts show them. Read-only.

Needs audit.json (real sizes), resmap.json (paths), csb_refs.json (on-screen sizes). The estimate assumes file bytes scale with pixel
count, and that the game is drawn at its 720x1280 design size times `scale` (1.0 = exactly that, 1.5 = headroom for denser screens).
Only layout references are counted: an image used by Lua code at another size keeps its own size (it is listed as "no layout use").

  python3 pipeline/shrink.py <restored-source-root> <reports-dir>
"""
import collections
import json
import os
import plistlib
import re
import sys

sys.dont_write_bytecode = True
SCALES = (1.0, 1.5)


def main(root, rep):
    audit = {r["name"].rsplit(".", 1)[0]: r for r in json.load(open(f"{rep}/audit.json"))["images"]}
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    inv = {p: h for h, p in found.items()}
    refs = json.load(open(f"{rep}/csb_refs.json"))["refs"]
    pkg = os.path.join(root, "outputs/apk-extracted/assets/HASH")
    on_disk = {f.rsplit(".", 1)[0]: os.path.join(d, f) for d in os.listdir(pkg) for f in os.listdir(os.path.join(pkg, d))}

    disp = collections.defaultdict(lambda: [0.0, 0.0])  # key -> biggest on-screen w,h

    def note(key, w, h):
        if w and h:
            disp[key][0], disp[key][1] = max(disp[key][0], w), max(disp[key][1], h)

    for r in refs:
        key = (r["plist"], r["path"]) if r["plist"] else (None, r["path"])
        note(key, r["w"], r["h"])

    def ratio(nw, nh, dw, dh, s):
        return min(1.0, (dw * s * dh * s) / max(nw * nh, 1))

    # standalone images
    stand = []
    for (plist, path), (dw, dh) in disp.items():
        if plist:
            continue
        h = inv.get(path)
        r = audit.get(h) if h else None
        if r:
            stand.append((path, r, dw, dh))
    # atlases
    atlases = []
    for plist_path in sorted({k[0] for k in disp if k[0]}):
        h = inv.get(plist_path)
        if h is None or h not in on_disk:
            continue
        try:
            pl = plistlib.load(open(os.path.join(pkg, on_disk[h]), "rb"))
        except Exception:
            continue
        meta = pl.get("metadata", {})
        tex = meta.get("textureFileName") or meta.get("realTextureFileName") or os.path.basename(plist_path).replace(".plist", ".png")
        tpath = os.path.join(os.path.dirname(plist_path), tex)
        page = audit.get(inv.get(tpath, ""))
        if not page:
            continue
        frames = []
        for name, fr in pl.get("frames", {}).items():
            m = re.findall(r"-?\d+", fr.get("sourceSize") or fr.get("spriteSourceSize") or fr.get("frame") or "")
            if len(m) >= 2:
                w, hh = (int(m[0]), int(m[1])) if "sourceSize" in fr or len(m) == 2 else (int(m[2]), int(m[3]))
                frames.append((name, w, hh))
        atlases.append((plist_path, page, frames))

    lines = ["# 按实际显示尺寸估算的缩小空间（只读估算）\n",
             "假设文件体积与像素数成正比；设计分辨率 720x1280，scale=1.0 即刚好按显示尺寸，1.5 留给高密度屏幕。只统计 CSB 布局里的引用。\n"]
    tot = {}
    for s in SCALES:
        # standalone
        before = sum(r["bytes"] for _, r, _, _ in stand)
        after = sum(r["bytes"] * ratio(r["w"], r["h"], dw, dh, s) for _, r, dw, dh in stand)
        # atlas pages: weight each referenced frame by area; frames the layouts never use keep full size (unknown)
        ab = aa = 0.0
        for plist_path, page, frames in atlases:
            area = sum(w * h for _, w, h in frames) or 1
            kept = 0.0
            for name, w, h in frames:
                d = disp.get((plist_path, name))
                kept += w * h * (ratio(w, h, d[0], d[1], s) if d else 1.0)
            ab += page["bytes"]
            aa += page["bytes"] * kept / area
        tot[s] = (before, after, ab, aa)
        lines.append(f"## scale {s}\n")
        lines.append(f"- 单独的图：{len(stand)} 张，{before / 1e6:.1f} MB → {after / 1e6:.1f} MB（省 {(before - after) / 1e6:.1f} MB）")
        lines.append(f"- 图集页：{len(atlases)} 个，{ab / 1e6:.1f} MB → {aa / 1e6:.1f} MB（省 {(ab - aa) / 1e6:.1f} MB）\n")

    s = SCALES[0]
    lines.append("## 单独的图里缩小空间最大的 30 张（scale 1.0）\n")
    lines.append("| 路径 | 原尺寸 | 显示尺寸 | 原 MB | 估算 MB |\n|---|---|---|---|---|")
    for path, r, dw, dh in sorted(stand, key=lambda x: -(x[1]["bytes"] * (1 - ratio(x[1]["w"], x[1]["h"], x[2], x[3], s))))[:30]:
        lines.append(f"| {path} | {r['w']}x{r['h']} | {dw:.0f}x{dh:.0f} | {r['bytes'] / 1e6:.2f} | {r['bytes'] * ratio(r['w'], r['h'], dw, dh, s) / 1e6:.2f} |")
    used_paths = {p for (pl, p) in disp if not pl}
    unused = [(h, audit[h]) for h in audit if h in found and found[h].startswith("resource/") and found[h] not in used_paths]
    lines.append(f"\n## 图片在 resource/ 下有名字，但没有出现在任何 CSB 布局里（可能由代码加载）：{len(unused)} 张，"
                 f"{sum(r['bytes'] for _, r in unused) / 1e6:.1f} MB，见 no_layout_use.json\n")
    json.dump([found[k] for k, _ in unused], open(f"{rep}/no_layout_use.json", "w"))
    open(f"{rep}/SHRINK.md", "w").write("\n".join(lines) + "\n")
    print("\n".join(lines[:12]))


if __name__ == "__main__":
    main(*sys.argv[1:3])
