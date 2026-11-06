#!/usr/bin/env python3
"""Find images and atlas frames the client never mentions. Read-only. Run resmap.py first.

Two lists, both only candidates (the client may build a name at run time in a way the scan cannot see):
  1. images whose name could not be recovered: no csb, Lua, plist or atlas links to them and no known format template produces them;
  2. frames inside plist atlases whose name appears in no csb string, no Lua string literal and fits no Lua format template.

  python3 pipeline/refs.py <restored-source-root> <reports-dir>
"""
import json
import os
import plistlib
import re
import sys
import collections

sys.dont_write_bytecode = True


def main(root, rep):
    resmap = json.load(open(f"{rep}/resmap.json"))
    found, why = resmap["found"], resmap["why"]
    imgs = {r["name"].rsplit(".", 1)[0]: r for r in json.load(open(f"{rep}/audit.json"))["images"]}
    pkg = os.path.join(root, "outputs/apk-extracted/assets/HASH")
    on_disk = {f.rsplit(".", 1)[0]: os.path.join(d, f) for d in os.listdir(pkg) for f in os.listdir(os.path.join(pkg, d))}

    # every string the client can mention a frame with
    mentioned = set()
    str_re = re.compile(rb"[A-Za-z0-9_\-./ ]{3,120}")
    for h, rel in on_disk.items():
        if rel.endswith(".csb"):
            mentioned.update(m.group(0).decode("latin1") for m in str_re.finditer(open(os.path.join(pkg, rel), "rb").read()))
    lit_re = re.compile(r'["\']([^"\'\n]{2,120})["\']')
    patterns = []
    for dirpath, _, files in os.walk(os.path.join(root, "outputs/lua-restored-paths")):
        for f in files:
            if f.endswith(".lua"):
                for s in lit_re.findall(open(os.path.join(dirpath, f), errors="replace").read()):
                    if "%" in s and re.search(r"%[sd]", s):
                        if len(re.sub(r"%[sd]", "", s)) < 6:  # "%s.png" would match every frame
                            continue
                        patterns.append(re.compile("^" + re.escape(s).replace("%s", ".+").replace("%d", r"\d+").replace(r"\%s", ".+") + "$"))
                    else:
                        mentioned.add(s)
    mentioned_base = {m.rsplit("/", 1)[-1] for m in mentioned}

    def used(frame):
        base = frame.rsplit("/", 1)[-1]
        stem = base.rsplit(".", 1)[0]
        return frame in mentioned or base in mentioned_base or stem in mentioned_base or any(p.match(frame) or p.match(base) for p in patterns)

    frames_total = frames_dead = 0
    dead_area = tot_area = 0
    per_atlas = []
    for h, p in found.items():
        if not p.endswith(".plist"):
            continue
        try:
            pl = plistlib.load(open(os.path.join(pkg, on_disk[h]), "rb"))
        except Exception:
            continue
        dead = n = area = dead_a = 0
        for name, fr in pl.get("frames", {}).items():
            m = re.findall(r"-?\d+", fr.get("frame") or fr.get("textureRect") or "")
            a = int(m[2]) * int(m[3]) if len(m) >= 4 else 0
            n += 1
            area += a
            if not used(name):
                dead += 1
                dead_a += a
        frames_total += n
        frames_dead += dead
        tot_area += area
        dead_area += dead_a
        per_atlas.append((p, n, dead, area, dead_a))

    unnamed = sorted((r for k, r in imgs.items() if k not in found), key=lambda r: -r["bytes"])
    by_bucket = collections.Counter()
    for r in unnamed:
        s = max(r["w"], r["h"])
        by_bucket["<=128" if s <= 128 else "<=512" if s <= 512 else "<=1024" if s <= 1024 else "<=2048" if s <= 2048 else ">2048"] += r["bytes"]
    classes = collections.Counter(why.get(k, "unnamed") for k in imgs)
    class_bytes = collections.Counter()
    for k, r in imgs.items():
        class_bytes[why.get(k, "unnamed")] += r["bytes"]

    out = ["# 引用扫描（候选，只读）\n", "## 图片按「怎么找到的」分类\n", "| 类别 | 张数 | MB |", "|---|---|---|"]
    for k in classes:
        out.append(f"| {k} | {classes[k]} | {class_bytes[k] / 1e6:.1f} |")
    out += ["\n- literal：路径直接写在 CSB 或 Lua 里。linked：被 plist、atlas 或 skel 间接引用。template：由 Lua 的 string.format 模板和已知编号拼出。",
            "- spine-data / spine-lua：Spine 模型编号出现在服务器数据表 / 只出现在 Lua 里（多数在配置表目录，可视为被数据引用）。",
            "- unnamed：没有任何引用能指到它。要么路径是运行时按别的方式拼的，要么没人用。\n",
            f"## 1. 没有引用的图片候选（unnamed）：{len(unnamed)} 张，{sum(r['bytes'] for r in unnamed) / 1e6:.1f} MB\n",
            "按最长边分桶的体积：" + "，".join(f"{k} {v / 1e6:.1f}MB" for k, v in by_bucket.items()) + "\n",
            "| 名称 | 格式 | 尺寸 | 文件 MB |", "|---|---|---|---|"]
    for r in unnamed[:60]:
        out.append(f"| {r['name']} | {r['fmt']} | {r['w']}x{r['h']} | {r['bytes'] / 1e6:.2f} |")
    out += [f"\n## 2. plist 图集里没有被引用的小图帧\n",
            f"- {len(per_atlas)} 个图集，{frames_total} 帧，其中 {frames_dead} 帧（{frames_dead * 100 // max(frames_total, 1)}%）没被引用，"
            f"占图集像素面积的 {dead_area * 100 // max(tot_area, 1)}%。\n",
            "| 图集 | 帧数 | 未引用帧 | 未引用面积占比 |", "|---|---|---|---|"]
    for p, n, dead, area, dead_a in sorted(per_atlas, key=lambda x: -x[4])[:30]:
        out.append(f"| {p} | {n} | {dead} | {dead_a * 100 // max(area, 1)}% |")
    open(f"{rep}/REFS.md", "w").write("\n".join(out) + "\n")
    json.dump({"unnamed": [r["name"] for r in unnamed]}, open(f"{rep}/unreferenced.json", "w"))
    print("\n".join(out[:12]))
    print(f"unnamed {len(unnamed)}; frames {frames_dead}/{frames_total}; area {dead_area * 100 // max(tot_area, 1)}% dead")


if __name__ == "__main__":
    main(*sys.argv[1:3])
