#!/usr/bin/env python3
"""The client's hero table for the release, from the restored partner_data.lua:
  {"base": {bid: [name, camp_type, init_star, type, show_order, rare_flag, has_draw_res]}, "head": {"<bid>_<star>": head_id}}
The hero list draws a hero's head from resource/headicon/<head_id> where head_id depends on the star (data_partner_star, column 4).

  python3 pipeline/partners_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import json
import re
import sys

BASE = re.compile(r"^\t\[(\d+)\] = \{\n(?:\t\t.*\n)*?\t\tbid = (\d+),\n(?:\t\t.*\n)*?\t\},?$", re.M)
STAR = re.compile(r'^\t\["(\d+_\d+)"\] = "\{(\d+), (\d+), \\"[^"]*\\", (\d+),', re.M)


def table(lua_dir):
    src = open(f"{lua_dir}/partner_data.lua", encoding="utf-8").read()
    start = src.index("Config.PartnerData.data_partner_base = {")
    block = src[start:src.index("\n}\n", start)]
    base = {}
    for m in BASE.finditer(block):
        b = m.group(0)
        field = lambda k, d=None: (re.search(rf"\t\t{k} = (.*),\n", b) or [None, d])[1]
        base[m.group(2)] = [json.loads(field("name", '""')), int(field("camp_type", 0)), int(field("init_star", 1)),
                     int(field("type", 4)), int(field("show_order", 0)), int(field("rare_flag", 0)), 1 if json.loads(field("draw_res", '""')) else 0]
    head = {k: int(h) for k, _, _, h in STAR.findall(src)}
    assert base and head, "partner_data.lua did not parse"
    return {"base": base, "head": head}


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(t["base"]), "heroes,", len(t["head"]), "star heads")
