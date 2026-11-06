#!/usr/bin/env python3
"""The client's item table for the release: {id: [name, icon, type, quality]} from the restored item_data*.lua files.
Same row format as the server's tools/extract_items.py (id, name, icon, type, sub_type, quality, ...); only what the UI shows is kept.

  python3 pipeline/items_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import glob
import json
import re
import sys

ROW = re.compile(r'^\t\[(\d+)\] = "\{(\d+), \\"((?:[^"\\]|\\.)*?)\\", (\d+), (\d+), (\d+), (\d+)', re.M)


def table(lua_dir):
    items = {}
    for path in sorted(glob.glob(f"{lua_dir}/item_data*.lua")):
        for key, id_, name, icon, typ, sub, quality in ROW.findall(open(path, encoding="utf-8").read()):
            assert key == id_ and id_ not in items, (path, id_)
            items[id_] = [name.replace('\\"', '"'), int(icon), int(typ), int(quality)]
    return items


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(t), "items")
