#!/usr/bin/env python3
"""Plan the download groups for the new clients. Read-only: it writes a plan from the reports, it moves nothing.

A group is a set of files the client prefetches together; every file is addressed by its content hash on the CDN, so a group is a list
in the manifest, not an archive. Identical content is counted once; groups that need the same content merge into one family group.
Sizes are projected: a png counts 0.21 of its bytes (the ratio measured on 8 samples when converted to webp q80), everything else
counts as it is. Images whose path could not be recovered are listed under "unassigned" and are not placed anywhere.

  python3 pipeline/bundles.py <restored-source-root> <reports-dir>
"""
import collections
import json
import os
import sys

sys.dont_write_bytecode = True
PNG_RATIO = 0.21
BOOT_DIRS = {"login", "common"}                          # what the first screen needs
CORE_DIRS = {"item", "headicon", "headcircle", "functionicon", "skillicon", "common"}  # small icons used on every screen
MISC_LIMIT = 200_000                                      # module dirs smaller than this share "ui-misc"
BIG_GROUP = 4_000_000                                     # a group above this is flagged for a closer look
BOOT_BUDGET = 1_000_000                                   # images in the first package; the 4 MB also holds engine and code


def group_of(path):
    parts = path.split("/")
    if parts[0].startswith("v9o8"):                        # spine: <dir>/<model>/<action>.<ext>
        m = parts[1]
        return ("hero-" if m[0] == "H" else "fx-") + m
    if parts[0] == "resource" and len(parts) >= 3:
        d = parts[1]
        if d in BOOT_DIRS and d == "login":
            return "boot"
        if d in CORE_DIRS:
            return "ui-core"
        if d == "bigbg":
            return "bg-" + (parts[2] if len(parts) > 3 else "main")
        return "ui-" + d
    if parts[0] in ("scene", "sound"):
        return parts[0]
    return "other-" + parts[0]


def main(root, rep):
    audit = {r["name"].rsplit(".", 1)[0]: r for r in json.load(open(f"{rep}/audit.json"))["images"]}
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    pkg = os.path.join(root, "outputs/apk-extracted/assets/HASH")
    on_disk = {f.rsplit(".", 1)[0]: os.path.join(d, f) for d in os.listdir(pkg) for f in os.listdir(os.path.join(pkg, d))}

    def proj(r):
        return r["bytes"] * (PNG_RATIO if r["fmt"] == "png" else 1.0)

    content = collections.defaultdict(lambda: {"groups": set(), "paths": [], "bytes": 0, "proj": 0})
    for h, r in audit.items():
        p = found.get(h)
        key = r["sha"] or h
        c = content[key]
        c["bytes"], c["proj"] = r["bytes"], proj(r)
        if p:
            c["groups"].add(group_of(p))
            c["paths"].append(p)
        else:
            c["groups"].add("unassigned")
    # Groups that need the same content are loaded together anyway (the forms of one hero share atlas pages), so they merge into one
    # family group instead of a "shared" bucket every group would depend on. An unnamed copy of content that has a named copy is placed.
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for c in content.values():
        if len(c["groups"]) > 1:
            c["groups"].discard("unassigned")
        for always in ("boot", "ui-core"):  # always loaded: content any other group also needs simply lives there
            if always in c["groups"]:
                c["groups"] = {always}
                break
        gs = sorted(c["groups"])
        for other in gs[1:]:
            parent[find(other)] = find(gs[0])
    members = collections.defaultdict(set)
    for c in content.values():
        for g in c["groups"]:
            members[find(g)].add(g)
    name_of = {}
    for root, ms in members.items():
        ms = sorted(ms)
        for g in ms:
            name_of[g] = ms[0] if len(ms) == 1 else f"{ms[0]}+{len(ms) - 1}"
    families = {name_of[ms[0]]: ms for ms in (sorted(v) for v in members.values()) if len(ms) > 1}
    groups = collections.defaultdict(lambda: {"files": 0, "bytes": 0, "proj": 0.0, "paths": []})
    for key, c in content.items():
        g = name_of[next(iter(c["groups"]))]
        x = groups[g]
        x["files"] += 1
        x["bytes"] += c["bytes"]
        x["proj"] += c["proj"]
        if g != "unassigned":
            x["paths"].append(c["paths"][0])
    # skeleton and atlas files travel with their model
    extra = 0
    for h, p in found.items():
        if p.endswith((".skel", ".atlas")) and h in on_disk:
            n = os.path.getsize(os.path.join(pkg, on_disk[h]))
            g = groups[name_of.get(group_of(p), group_of(p))]
            g["files"] += 1
            g["bytes"] += n
            g["proj"] += n
            extra += n
    # small module dirs share one group
    small = [k for k, v in groups.items() if k.startswith(("ui-", "bg-")) and k != "ui-core" and v["bytes"] < MISC_LIMIT]
    misc = groups["ui-misc"]
    for k in small:
        v = groups.pop(k)
        for f in ("files", "bytes", "proj"):
            misc[f] += v[f]
        misc["paths"] += v["paths"]
    boot = groups.get("boot", {"proj": 0})
    out = {"png_ratio": PNG_RATIO, "families": families, "groups": {k: {"files": v["files"], "bytes": v["bytes"], "proj": round(v["proj"])} for k, v in groups.items()}}
    json.dump(out, open(f"{rep}/bundles.json", "w"))
    json.dump({k: v["paths"] for k, v in groups.items() if k != "unassigned"}, open(f"{rep}/bundle_files.json", "w"))
    kinds = collections.Counter()
    for k, v in groups.items():
        kinds["family" if "+" in k else "hero" if k.startswith("hero-") else "fx" if k.startswith("fx-") else k if k in ("boot", "ui-core", "unassigned", "ui-misc") else
              "bg" if k.startswith("bg-") else "ui-module" if k.startswith("ui-") else "other"] += 1
    mb = lambda n: f"{n / 1e6:.1f}"
    placed = {k: v for k, v in groups.items() if k != "unassigned"}
    tot_b, tot_p = sum(v["bytes"] for v in placed.values()), sum(v["proj"] for v in placed.values())
    big = sorted(((k, v) for k, v in placed.items() if v["proj"] > BIG_GROUP), key=lambda kv: -kv[1]["proj"])
    md = ["# 分包方案（计划，不改任何文件）\n",
          f"- 分组：{len(placed)} 个已放置的组 + 1 个未归属组。按内容 hash 去重，相同内容只算一次，共用同一内容的组合并成家族组（名字带 +N），共 {len(families)} 个家族。",
          f"- 体积口径：PNG 按样本实测比例 {PNG_RATIO} 折算成 WebP（只测了 8 张），其余按原样。skel 和 atlas 文件随模型计入。",
          f"- 已放置：原 {mb(tot_b)} MB → 预计 {mb(tot_p)} MB。",
          f"- 未归属（路径没还原，不知道该放哪里）：{groups['unassigned']['files']} 个文件，{mb(groups['unassigned']['bytes'])} MB。",
          f"- 首包 boot：{mb(boot['proj'])} MB 图片（预算 {mb(BOOT_BUDGET)} MB，4MB 首包还要装下引擎和代码）。",
          f"- 各类组数：{dict(kinds)}\n",
          "## 体积最大的 25 个组\n", "| 组 | 文件数 | 原 MB | 预计 MB |", "|---|---|---|---|"]
    for k, v in sorted(groups.items(), key=lambda kv: -kv[1]["proj"])[:25]:
        md.append(f"| {k} | {v['files']} | {mb(v['bytes'])} | {mb(v['proj'])} |")
    md += [f"\n## 单组超过 {mb(BIG_GROUP)} MB 的（{len(big)} 个）：要单独处理，不能整组预载\n"]
    for k, v in big:
        md.append(f"- {k}：{mb(v['proj'])} MB（{v['files']} 个文件）")
    open(f"{rep}/BUNDLES.md", "w").write("\n".join(md) + "\n")
    print("\n".join(md[:12]))
    print(f"groups over {mb(BIG_GROUP)}MB: {len(big)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
