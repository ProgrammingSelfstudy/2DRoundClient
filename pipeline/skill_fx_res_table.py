#!/usr/bin/env python3
"""Which effect models a skill's effect row plays, and where, from the restored Lua tables (readable-source/lua/ePoCrKQk.../):

  l  effect row bid -> [bact, act, area, hit, hurt, trc]: the lists of effect entity bids an effect row names (skill_data*.lua data_get_effect_table,
     fields 8 to 13: bact before the attack, act at the attack point, area on the scene, hit on the target at the hit, hurt on the target when hurt,
     trc the trace); rows with no list at all are left out
  r  effect entity bid -> [res_up, res_down, up_action, down_action, play_type, scale, h_scale, x_fix, y_fix, is_front, is_col_effect, spec_res_up]
     (skill_data.lua data_get_effect_data): the Spine model drawn over and under the fighter, the animation each plays, where it goes
     (play_type: 1 on the caster, 2 scene, 3 caster side of the field, 4 enemy side, 5 target), size in thousandths, and the offset

  python3 pipeline/skill_fx_res_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I leaves the script's folder off the path
from skill_actions_table import lua_row

NAMES = ["res_up", "res_down", "up_action_name", "down_action_name", "play_type", "scale", "h_scale", "x_fix", "y_fix", "is_fornt", "is_col_effect", "spec_res_up"]


def entities(lua_dir):
    src = open(f"{lua_dir}/skill_data.lua", encoding="utf-8").read()
    src = src[src.index("Config.SkillData.data_get_effect_data = {"):]
    src = src[:src.index("\n}\n")]
    out = {}
    for m in re.finditer(r"\[(\d+)\] = \{(.*?)\n\t\},", src, re.S):
        f = dict(re.findall(r'(\w+) = ("[^"]*"|-?\d+(?:\.\d+)?)', m.group(2)))
        out[m.group(1)] = [json.loads(f[k]) if k in f else ("" if k.endswith(("name", "up", "down")) or k == "spec_res_up" else 0) for k in NAMES]
    assert len(out) == 945, len(out)  # data_get_effect_data_length
    return out


def lists(lua_dir):
    out = {}
    for path in sorted(glob.glob(f"{lua_dir}/skill_data*.lua")):
        src = open(path, encoding="utf-8").read()
        if "data_get_effect_table = {" not in src:
            continue
        src = src[src.index("data_get_effect_table = {"):]
        src = src[:src.index("\n}\n")]
        for m in re.finditer(r'\[(\d+)\] = "(\{.*\})",?\n', src):
            row = lua_row(m.group(2))
            # 0-based: 7 bact, 8 act, 9 area, 10 hit, 11 hurt, 12 trc
            ls = [[int(x) for x in row[i]] for i in range(7, 13)]
            if any(ls):
                out[m.group(1)] = ls
    return out


def table(lua_dir):
    return {"l": lists(lua_dir), "r": entities(lua_dir)}


if __name__ == "__main__":
    json.dump(table(sys.argv[1]), open(sys.argv[2], "w"), separators=(",", ":"))
