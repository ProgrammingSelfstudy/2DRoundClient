#!/usr/bin/env python3
"""Name the main-city scene pictures that resmap.py could not reach, and save them to a new folder. Read-only on the sources.

The client builds a city scene from resource/centerscene/<res_id>/<time 1|2>/{1.png,2.png,3.png,4.jpg} (scene/view/center_city_scene.lua,
renderMapPic) where res_id comes from Config.city_data (main_scene_data.lua: centercity, centercity_2, business). Nothing in a .csb or in a
string table mentions these paths, so the hashed package names stayed unmapped. The paths are built from the Lua source here and hashed with the
client's own resource_hash; a path counts only when its hash exists in the package (audit.json).

Layer placement from renderMapPic: 1 at (0,0) hidden, 2 at (0,60), 3 at (0,502) (anchor bottom-left), 4 anchored top-left at (0, scene height).

  python3 pipeline/scene_names.py <restored-source-root> <assets-dir>
Writes <assets-dir>/scene/<res_id>/<time>/<layer> (the decoded pictures) and <assets-dir>/reports/scene_map.json.
"""
import json
import os
import sys
import zipfile

sys.dont_write_bytecode = True
LAYERS = ["1.png", "2.png", "3.png", "4.jpg"]
RES_IDS = ["centercity", "centercity_2", "business"]  # Config.city_data[*].res_id


def main(root, assets):
    sys.path.insert(0, os.path.join(root, "outputs/recovery-tools"))
    from resource_hash import resource_hash
    audit = {r["name"].rsplit(".", 1)[0]: r for r in json.load(open(f"{assets}/reports/audit.json"))["images"]}
    z = zipfile.ZipFile(f"{assets}/source/decrypted-images.zip")
    out, tried = {}, 0
    for rid in RES_IDS:
        cands = [f"resource/centerscene/{rid}/{t}/{n}" for t in (1, 2) for n in LAYERS]
        cands += [f"resource/centerscene/preview/{rid}_{t}.jpg" for t in (1, 2)] + [f"resource/centerscene/{rid}.jpg"]
        for p in cands:
            tried += 1
            h = resource_hash(p)
            if h not in audit:
                continue
            r = audit[h]
            dest = f"{assets}/scene/{p.split('centerscene/', 1)[1]}"
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(z.read("decoded/" + r["name"]))
            out[p] = {"hash": h, "w": r["w"], "h": r["h"], "bytes": r["bytes"], "fmt": r["fmt"]}
    json.dump(out, open(f"{assets}/reports/scene_map.json", "w"), indent=1)
    print(f"{len(out)} of {tried} candidate paths exist in the package")
    for p, v in out.items():
        print(f"  {p:52s} {v['w']}x{v['h']}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
