#!/usr/bin/env python3
"""Build a release: images, atlas tables and layouts of the chosen groups, every output named by its content hash, plus the manifest.

  python3 pipeline/build_release.py <assets-dir> <version> <group> [group ...]

Reads <assets-dir>/source/{decrypted-images.zip,restored-source} and <assets-dir>/reports/{audit,resmap}.json (see docs/PATHS.md).
Writes <assets-dir>/build/<version>/f/<hash[:2]>/<hash>.<ext> and <assets-dir>/build/<version>/manifest.web.json.

Three kinds of file, all listed in the manifest under a logical path:
  images   resource/... -> boot/<name>.webp, ui/<dir>/<name>.webp. A png is re-encoded as lossy webp (q85, alpha lossless, see
           docs/reports/GIANTS.md and TEXTURES.md); webp and jpg stay as they are, re-encoding a lossy file gains nothing.
  atlases  resource/<dir>/<name>.plist -> ui/<dir>/<name>.json: {texture, size, frames{name: x,y,w,h,rotated,ox,oy,sw,sh}}.
  layouts  a .csb -> layouts/<dir>/<name>.json: the node tree (csb_tree.py), resource references rewritten to logical atlas paths.
A group with no naming rule stops the build instead of inventing names.
"""
import hashlib
import json
import os
import plistlib
import re
import subprocess
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from csb_tree import tree  # noqa: E402

LAYOUTS = {"boot": ["login/user_panel.csb"], "mainui": ["mainui/mainui_view.csb"]}  # group -> csb paths (under the recovered csb directory) shipped as layouts


def group_of(path):
    if path.startswith("resource/login/"):
        return "boot"
    if path.startswith("resource/common/"):
        return "core-base"
    if path.startswith("resource/mainui/"):
        return "mainui"
    if path.startswith("resource/item/"):
        return "icons-item"
    return None


def logical_image(path, group):
    name = path.rsplit("/", 1)[-1].rsplit(".", 1)[0] + ".webp"
    if group == "boot":
        return "boot/" + name
    if group == "core-base":
        return "ui/common/" + name
    if group == "mainui":
        return "ui/mainui/" + name
    if group == "icons-item":
        return "icons/item/" + name
    raise SystemExit(f"no naming rule for group {group!r}; add one to logical_image() first")


def logical_atlas(plist_path):  # resource/common/common.plist -> ui/common/common.json
    return "ui/" + plist_path.split("/", 1)[1].rsplit(".", 1)[0] + ".json"


def ints(s):
    return [int(x) for x in re.findall(r"-?\d+", s)]


def atlas_json(pl, texture_logical, size):
    frames = {}
    for name, f in pl["frames"].items():
        x, y, w, h = ints(f["frame"])
        ox, oy = ints(f.get("offset", "{0,0}"))
        sw, sh = ints(f["sourceSize"])
        frames[name] = {"x": x, "y": y, "w": w, "h": h, "rotated": bool(f.get("rotated")), "ox": ox, "oy": oy, "sw": sw, "sh": sh}
    return {"texture": texture_logical, "size": size, "frames": frames}


def main(assets, version, groups):
    rep = f"{assets}/reports"
    audit = {r["name"].rsplit(".", 1)[0]: r for r in json.load(open(f"{rep}/audit.json"))["images"]}
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    inv = {p: h for h, p in found.items()}
    z = zipfile.ZipFile(f"{assets}/source/decrypted-images.zip")
    pkg = f"{assets}/source/restored-source/outputs/apk-extracted/assets/HASH"
    out = f"{assets}/build/{version}"
    os.makedirs(f"{out}/f", exist_ok=True)
    files, tmp = {}, tempfile.mkdtemp()

    def put(logical, data, ext, group, src, **extra):
        digest = hashlib.sha256(data).hexdigest()[:20]
        os.makedirs(f"{out}/f/{digest[:2]}", exist_ok=True)
        open(f"{out}/f/{digest[:2]}/{digest}.{ext}", "wb").write(data)
        files[logical] = {"hash": digest, "ext": ext, "bytes": len(data), "group": group, "src": src, **extra}

    for h, p in sorted(found.items(), key=lambda kv: kv[1]):
        g = group_of(p)
        if g not in groups:
            continue
        if p.endswith(".plist"):  # atlas table
            pl = plistlib.load(open(f"{pkg}/{h[0]}/{h}.plist", "rb"))
            tex = p.rsplit("/", 1)[0] + "/" + pl["metadata"]["textureFileName"]
            page = audit[inv[tex]]
            put(logical_atlas(p), json.dumps(atlas_json(pl, logical_image(tex, g), [page["w"], page["h"]]), separators=(",", ":")).encode(), "json", g, p)
            continue
        if h not in audit:
            continue
        r = audit[h]
        data = z.read("decoded/" + r["name"])
        if r["fmt"] == "png":
            src = f"{tmp}/{h}.png"
            open(src, "wb").write(data)
            subprocess.run(["cwebp", "-quiet", "-q", "85", "-m", "6", "-alpha_q", "100", "-exact", src, "-o", f"{tmp}/{h}.webp"], check=True)
            data, ext = open(f"{tmp}/{h}.webp", "rb").read(), "webp"
        else:
            ext = r["fmt"]
        put(logical_image(p, g), data, ext, g, p, w=r["w"], h=r["h"])

    for g in groups:
        for csb in LAYOUTS.get(g, []):
            cp = next((p for p in found.values() if p.endswith("/" + csb)), None)
            if not cp:
                raise SystemExit(f"layout {csb} not found")
            h = inv[cp]
            t = tree(f"{pkg}/{h[0]}/{h}.csb")

            def rewrite(n):
                for r in n["res"]:
                    # a frame inside an atlas is addressed as <logical atlas json>#<frame name>; a loose image by its original path
                    r["atlas"] = logical_atlas(r["plist"]) if r["plist"] else ""
                    # a loose image (an item icon) is addressed by its own logical path
                    r["image"] = "" if r["plist"] or not group_of(r["path"]) else logical_image(r["path"], group_of(r["path"]))
                for c in n["children"]:
                    rewrite(c)
            rewrite(t)
            put("layouts/" + csb.rsplit(".", 1)[0] + ".json", json.dumps(t, ensure_ascii=False, separators=(",", ":")).encode(), "json", g, cp)

    manifest = {"version": version, "platform": "web", "files": files}
    json.dump(manifest, open(f"{out}/manifest.web.json", "w"), ensure_ascii=False, indent=1)
    print(f"{version}: {len(files)} files, {sum(f['bytes'] for f in files.values()) / 1e6:.2f} MB -> {out}")
    for k, f in files.items():
        print(f"  {k:34s} {f['ext']:5s} {f['bytes']:>8} B  {f['hash']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
