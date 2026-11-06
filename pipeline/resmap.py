#!/usr/bin/env python3
"""Give the hashed original resources their real paths. Read-only.

The client names every file HASH/<first hex>/<resource_hash(virtual path)>.<ext>, so a name can only be recovered by hashing a path
that is known. Paths are collected from what the client itself mentions: the strings of every .csb, the Lua sources, the verified
name map, then followed outwards (a plist names its texture, an atlas its pages, a .skel sits beside its .atlas and .png). A
candidate counts only when its hash exists in the package.

  python3 pipeline/resmap.py <restored-source-root> <audit.json> <out-dir>
"""
import json
import os
import re
import sys
import plistlib

sys.dont_write_bytecode = True

SPINE_DIR = "v9o8qm1Y40cbOAlh6LDp0kMDi5CzXlsO"  # util/pathtool.lua PathTool.getSpineByName
PATH_RE = re.compile(rb'["\']([A-Za-z0-9_\-./ ]{3,160}\.(?:png|jpg|plist|csb|atlas|skel|json|mp3|ttf|fnt|fsh|db))["\']')
STR_RE = re.compile(rb'[A-Za-z0-9_\-./]{3,160}\.(?:png|jpg|plist|csb|atlas|skel|json|mp3|ttf|fnt)')


def load_hash(root):
    sys.path.insert(0, os.path.join(root, "outputs/recovery-tools"))
    from resource_hash import resource_hash
    return resource_hash


def main(root, audit_path, out_dir):
    resource_hash = load_hash(root)
    pkg = os.path.join(root, "outputs/apk-extracted/assets/HASH")
    on_disk = {}  # hash -> file name in the package
    for d in os.listdir(pkg):
        for f in os.listdir(os.path.join(pkg, d)):
            on_disk[f.rsplit(".", 1)[0]] = os.path.join(d, f)

    cands = set()
    for p in json.load(open(os.path.join(root, "outputs/resource-name-map.json"))):
        cands.add(p)
    for dirpath, _, files in os.walk(os.path.join(root, "outputs")):
        if "apk-extracted" in dirpath or "node_modules" in dirpath:
            continue
        for f in files:
            if f.endswith((".lua", ".luac", ".txt", ".json")) and "lua" in dirpath:
                try:
                    data = open(os.path.join(dirpath, f), "rb").read()
                except OSError:
                    continue
                cands.update(m.group(1).decode("latin1") for m in PATH_RE.finditer(data))
    for h, rel in on_disk.items():
        if rel.endswith(".csb"):
            data = open(os.path.join(pkg, rel), "rb").read()
            cands.update(m.group(0).decode("latin1") for m in STR_RE.finditer(data))

    found = {}  # hash -> virtual path

    def try_path(p):
        p = p.lstrip("./")
        for q in (p, p.replace("//", "/")):
            h = resource_hash(q)
            if h in on_disk and h not in found:
                found[h] = q
                return True
        return False

    work = list(cands)
    seen = set(work)
    while work:
        p = work.pop()
        if not try_path(p):
            continue
        base, ext = os.path.splitext(p)
        d = os.path.dirname(p)
        more = []
        h = resource_hash(p)
        rel = on_disk[h]
        if ext == ".plist":
            try:
                pl = plistlib.load(open(os.path.join(pkg, rel), "rb"))
                tex = pl.get("metadata", {}).get("textureFileName") or pl.get("metadata", {}).get("realTextureFileName")
                if tex:
                    more.append(os.path.join(d, tex))
                more.append(base + ".png")
            except Exception:
                pass
        elif ext == ".atlas":
            try:
                for line in open(os.path.join(pkg, rel), errors="replace").read().splitlines():
                    if re.search(r"\.(png|jpg)$", line.strip()):
                        more.append(os.path.join(d, line.strip()))
            except OSError:
                pass
            more += [base + ".skel", base + ".png"]
        elif ext == ".skel":
            more += [base + ".atlas", base + ".png"]
        for m in more:
            if m not in seen:
                seen.add(m)
                work.append(m)

    # Spine models: pathtool.lua builds <SPINE_DIR>/<model>/<action>.{skel,atlas,png}. The action is the page name in the atlas's first
    # line; the model is one of the H12345 / E12345 tokens that appear in the Lua and in the server's data tables.
    actions = set()
    for rel in on_disk.values():
        if rel.endswith(".atlas"):
            for line in open(os.path.join(pkg, rel), errors="replace").read().splitlines():
                if line.strip().endswith(".png"):
                    actions.add(line.strip()[:-4])
                    break
    model_re = re.compile(rb"\b[A-Za-z]\d{4,6}\b")
    models = set()
    for src in (os.path.join(root, "outputs/lua-restored-paths"), os.path.join(root, "outputs/lua-decompiled-raw"),
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../2DRoundServer/internal/game/data")):
        for dirpath, _, files in os.walk(src):
            for f in files:
                if f.endswith((".lua", ".json")):
                    models.update(m.decode() for m in model_re.findall(open(os.path.join(dirpath, f), "rb").read()))
    spine_before = len(found)
    for model in models:
        for act in actions:
            for ext in (".skel", ".atlas", ".png"):
                try_path(f"{SPINE_DIR}/{model}/{act}{ext}")
    print(f"spine: {len(actions)} actions x {len(models)} models resolved {len(found) - spine_before} files")

    audit = json.load(open(audit_path))
    imgs = audit["images"]
    named = [r for r in imgs if r["name"].rsplit(".", 1)[0] in found]
    by_dir = {}
    for r in named:
        top = "/".join(found[r["name"].rsplit(".", 1)[0]].split("/")[:2])
        by_dir.setdefault(top, [0, 0])
        by_dir[top][0] += 1
        by_dir[top][1] += r["bytes"]
    json.dump({"found": found}, open(os.path.join(out_dir, "resmap.json"), "w"), indent=0)
    kinds = {}
    for p in found.values():
        e = os.path.splitext(p)[1]
        kinds[e] = kinds.get(e, 0) + 1
    unnamed = [r for r in imgs if r["name"].rsplit(".", 1)[0] not in found]
    print(json.dumps({"candidates": len(seen), "resolved_total": len(found), "by_ext": kinds,
                      "images_named": len(named), "images_total": len(imgs),
                      "named_bytes": sum(r["bytes"] for r in named), "unnamed_bytes": sum(r["bytes"] for r in unnamed),
                      "unnamed_over_1mb": sum(r["bytes"] > 1_000_000 for r in unnamed)}, indent=1))
    for k, (n, b) in sorted(by_dir.items(), key=lambda kv: -kv[1][1])[:25]:
        print(f"{k:40s} {n:5d} {b / 1e6:8.1f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:4])
