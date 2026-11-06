#!/usr/bin/env python3
"""Build a release: re-encode the images of the chosen groups, name every output by its content hash, write the manifest.

  python3 pipeline/build_release.py <assets-dir> <version> <group> [group ...]

Reads <assets-dir>/source/decrypted-images.zip and <assets-dir>/reports/{audit,resmap}.json (see docs/PATHS.md). Writes
<assets-dir>/build/<version>/f/<hash[:2]>/<hash>.<ext> and <assets-dir>/build/<version>/manifest.web.json. A logical path is only made for
groups that have a naming rule below; an unknown group stops the build instead of inventing names.

Images that are png are re-encoded as lossy webp (q85, alpha kept lossless: measured in docs/reports/GIANTS.md and TEXTURES.md);
webp and jpg stay as they are, since re-encoding a lossy file gains nothing.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import zipfile


def logical(path, group):
    """original path -> logical path (docs/PATHS.md)."""
    if group == "boot":  # resource/login/**
        return "boot/" + path.rsplit("/", 1)[-1].rsplit(".", 1)[0] + ".webp"
    raise SystemExit(f"no naming rule for group {group!r}; add one to logical() first")


def group_of(path):
    if path.startswith("resource/login/"):
        return "boot"
    raise SystemExit(f"no group rule for {path!r}")


def main(assets, version, groups):
    rep = f"{assets}/reports"
    audit = {r["name"].rsplit(".", 1)[0]: r for r in json.load(open(f"{rep}/audit.json"))["images"]}
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    z = zipfile.ZipFile(f"{assets}/source/decrypted-images.zip")
    out = f"{assets}/build/{version}"
    os.makedirs(f"{out}/f", exist_ok=True)
    files = {}
    tmp = tempfile.mkdtemp()
    for h, p in sorted(found.items(), key=lambda kv: kv[1]):
        if h not in audit:
            continue
        try:
            g = group_of(p)
        except SystemExit:
            continue
        if g not in groups:
            continue
        r = audit[h]
        data = z.read("decoded/" + r["name"])
        if r["fmt"] == "png":
            src = f"{tmp}/{h}.png"
            open(src, "wb").write(data)
            dst = f"{tmp}/{h}.webp"
            subprocess.run(["cwebp", "-quiet", "-q", "85", "-m", "6", "-alpha_q", "100", "-exact", src, "-o", dst], check=True)
            data = open(dst, "rb").read()
            ext = "webp"
        else:
            ext = r["fmt"]
        digest = hashlib.sha256(data).hexdigest()[:20]
        os.makedirs(f"{out}/f/{digest[:2]}", exist_ok=True)
        open(f"{out}/f/{digest[:2]}/{digest}.{ext}", "wb").write(data)
        files[logical(p, g)] = {"hash": digest, "ext": ext, "bytes": len(data), "w": r["w"], "h": r["h"], "group": g, "src": p}
    manifest = {"version": version, "platform": "web", "files": files}
    json.dump(manifest, open(f"{out}/manifest.web.json", "w"), ensure_ascii=False, indent=1)
    total = sum(f["bytes"] for f in files.values())
    print(f"{version}: {len(files)} files, {total / 1e6:.2f} MB -> {out}")
    for k, f in files.items():
        print(f"  {k:28s} {f['w']}x{f['h']} {f['bytes']:>8} B  {f['hash']}.{f['ext']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
