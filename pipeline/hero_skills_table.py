#!/usr/bin/env python3
"""The skills of each hero, for the skill demo page and check_skill_anims.py: from the restored Lua tables

  h  "<bid>_<star>" -> [model, [skill bid, ...]]   (partner_data.lua, data_partner_star_table; only the active skills)
  k  skill bid -> [name, [effect bid, ...]]        (skill_data*.lua, data_get_skill_table: name, effect_list) of the heroes' active skills
  a  the same for every skill row that has an effect list, whoever has it (the form variants like 541314 that no hero lists, monsters' skills):
     what a skill does is the skill's own row, never a hero's, so a preview can play any skill number

The battle never reads this table; the demo page (?skilldemo=10401_4) plays every skill of a hero in turn so each can be looked at.

  python3 pipeline/hero_skills_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skill_actions_table import lua_row  # noqa: E402

UNPARSED = []  # rows that could not be read


def rows(path, marker, pat):  # the quoted Lua rows of one table of a file
    src = open(path, encoding="utf-8").read()
    if marker not in src:
        return {}
    src = src[src.index(marker):]
    src = src[:src.index("\n}\n")]
    out = {}
    for m in re.finditer(pat, src):
        try:
            out[m.group(1)] = lua_row(re.sub(r"'([^']*)'", r'"\1"', m.group(2)))  # some rows hold 'single quoted' strings
        except ValueError:
            UNPARSED.append(m.group(1))
    return out


def skill_rows(lua_dir):  # skill bid -> the row of data_get_skill_table (1 name, 8 type, 13 effect_list)
    out = {}
    for path in sorted(glob.glob(f"{lua_dir}/skill_data*.lua")):
        out.update(rows(path, "data_get_skill_table = {", r'\[(\d+)\] = "(\{.*\})",?\n'))
    return out


def star_rows(lua_dir):  # "<bid>_<star>" -> the row of data_partner_star_table (2 model, 13 skills [[slot, skill], ...])
    return rows(f"{lua_dir}/partner_data.lua", "Config.PartnerData.data_partner_star_table = {", r'\["(\d+_\d+)"\] = "(\{.*\})",?\n')


def table(lua_dir):
    skills, stars = skill_rows(lua_dir), star_rows(lua_dir)
    h, k = {}, {}
    for key, row in stars.items():
        active = []
        for _slot, sid in row[13]:
            sk = skills.get(str(sid))
            if sk and sk[8] == "active_skill":
                active.append(sid)
                k[str(sid)] = [sk[1], sk[13]]
        h[key] = [row[2], active]
    assert len(h) > 2000, len(h)  # 2216 hero stars
    a = {sid: [sk[1], sk[13]] for sid, sk in skills.items() if isinstance(sk[13], list) and sk[13]}
    return {"h": h, "k": k, "a": a}


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w"), ensure_ascii=False, separators=(",", ":"))
    print(len(t["h"]), "hero stars,", len(t["k"]), "active skills,", len(t["a"]), "skills with effects,", len(UNPARSED), "rows unread")
