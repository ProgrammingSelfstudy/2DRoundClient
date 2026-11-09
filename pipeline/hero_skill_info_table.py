#!/usr/bin/env python3
"""What the hero info window's skill page shows, from the restored Lua tables (the heroes this client lists: initial star 5 or more):

  h  "<bid>_<star>" -> [skill bid, ...]   (partner_data.lua, data_partner_star_table, column 13, in the table's slot order)
  k  skill bid -> [name, description, icon, passive (0 or 1), open note]
       (skill_data*.lua, data_get_skill_table: 1 name, 8 type, 16 des, 17 open_desc, 19 icon)

The icon is the file name under resource/skillicon (icons/skill/<icon>.webp in the release).

  python3 pipeline/hero_skill_info_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hero_skills_table import skill_rows, star_rows  # noqa: E402
from partners_table import table as partners  # noqa: E402

MIN_STAR = 5  # herofilter.ts MIN_HERO_STAR
TAG = re.compile(r"<[^>]*>")  # the descriptions carry colour tags like <div fontcolor=45a536>..</div>


def table(lua_dir):
    skills, stars, base = skill_rows(lua_dir), star_rows(lua_dir), partners(lua_dir)["base"]
    h, k = {}, {}
    for key, row in stars.items():
        bid = key.split("_")[0]
        if bid not in base or base[bid][2] < MIN_STAR:
            continue
        ids = []
        for _slot, sid in row[13]:
            sk = skills.get(str(sid))
            if not sk:
                continue
            ids.append(sid)
            k[str(sid)] = [sk[1], TAG.sub("", sk[16]), str(sk[19]), 1 if sk[8] == "passive_skill" else 0, TAG.sub("", sk[17])]
        h[key] = ids
    assert len(h) > 500 and len(k) > 500, (len(h), len(k))
    return {"h": h, "k": k}


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(t["h"]), "hero stars,", len(t["k"]), "skills")
