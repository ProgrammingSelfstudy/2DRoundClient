#!/usr/bin/env python3
"""Put the atlas pages of some Spine models next to the progress page so they can be looked at in a browser. Read-only on the originals.

Only the pages (the packed sheets) are shown, not the animation: that needs a Spine 3.4 runtime.

  python3 pipeline/preview.py <decrypted-images.zip> <restored-source-root> <reports-dir> MODEL [MODEL ...]
"""
import json
import os
import re
import sys
import zipfile

sys.dont_write_bytecode = True


def main(zpath, root, rep, models):
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    audit = {r["name"].rsplit(".", 1)[0]: r for r in json.load(open(f"{rep}/audit.json"))["images"]}
    pkg = os.path.join(root, "outputs/apk-extracted/assets/HASH")
    on_disk = {f.rsplit(".", 1)[0]: os.path.join(d, f) for d in os.listdir(pkg) for f in os.listdir(os.path.join(pkg, d))}
    z = zipfile.ZipFile(zpath)
    out = []
    for model in models:
        entry = {"model": model, "pages": [], "bytes_skel": 0}
        for h, p in sorted(found.items(), key=lambda kv: kv[1]):
            parts = p.split("/")
            if len(parts) < 3 or parts[1] != model:
                continue
            action = parts[2].rsplit(".", 1)[0]
            if p.endswith(".png") and h in audit:
                r = audit[h]
                d = f"{rep}/preview/{model}"
                os.makedirs(d, exist_ok=True)
                ext = "png" if r["fmt"] == "png" else r["fmt"]
                with open(f"{d}/{action}.{ext}", "wb") as f:
                    f.write(z.read("decoded/" + r["name"]))
                entry["pages"].append({"action": action, "file": f"preview/{model}/{action}.{ext}", "w": r["w"], "h": r["h"], "bytes": r["bytes"], "alpha": r["alpha"]})
            elif p.endswith(".atlas") and h in on_disk:
                text = open(os.path.join(pkg, on_disk[h]), errors="replace").read()
                entry.setdefault("regions", {})[action] = len(re.findall(r"^\S.*\n\s+rotate:", text, re.M))
            elif p.endswith(".skel") and h in on_disk:
                entry["bytes_skel"] += os.path.getsize(os.path.join(pkg, on_disk[h]))
        out.append(entry)
    json.dump(out, open(f"{rep}/preview/models.json", "w"), ensure_ascii=False)
    for e in out:
        print(e["model"], [(p["action"], f"{p['w']}x{p['h']}", p["bytes"]) for p in e["pages"]], e.get("regions"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
