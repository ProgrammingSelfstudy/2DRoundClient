#!/usr/bin/env python3
"""The role level table for the release: [exp_max of level 1, of level 2, ...] from the restored role_data.lua (Config.RoleData.data_role_attr, a list
indexed by level). The reward window of a hook claim or a quick battle draws the exp bar from it.

  python3 pipeline/role_exp_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import json
import re
import sys


def table(lua_dir):
    src = open(f"{lua_dir}/role_data.lua", encoding="utf-8").read()
    src = src[src.index("Config.RoleData.data_role_attr = {"):]
    src = src[:src.index("\n}\n")]
    out = [int(v) for v in re.findall(r"\bexp_max = (\d+),", src)]
    assert len(out) == 200, len(out)  # data_role_attr_length
    return out


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w"), separators=(",", ":"))
    print(len(t), "levels")
