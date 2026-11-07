#!/usr/bin/env python3
"""The battle statuses for the release: buff bid -> [name, positive_or_negative] from the restored skill_data.lua (Config.SkillData.data_get_buff).
positive_or_negative is 1 for a benefit and 2 for a harm. The battle scene floats the name over a unit when it gets the status and lists the
statuses under its hit-point bar.

  python3 pipeline/buffs_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import json
import re
import sys


def table(lua_dir):
    src = open(f"{lua_dir}/skill_data.lua", encoding="utf-8").read()
    src = src[src.index("Config.SkillData.data_get_buff = {"):]
    src = src[:src.index("\n}\n")]
    out = {}
    for m in re.finditer(r"\n\t\[(\d+)\] = \{\n(.*?)\n\t\},", src, re.S):
        body = m.group(2)
        name = re.search(r'\bname = "([^"]*)"', body)
        pon = re.search(r"\bpositive_or_negative = (\d+)", body)
        if name and pon:
            out[m.group(1)] = [name.group(1), int(pon.group(1))]
    assert len(out) > 2000, len(out)  # data_get_buff_length is 2097
    return out


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w"), ensure_ascii=False, separators=(",", ":"))
    print(len(t), "buffs")
