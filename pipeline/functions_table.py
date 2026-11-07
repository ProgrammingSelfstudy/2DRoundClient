#!/usr/bin/env python3
"""The client's main-city function icon table for the release: {id: [icon, type, index, name, lev]} from the restored function_data.lua.
Only the icons the original opens by player level (open_type 1, shown, with a "lev" condition) are kept: the others are pushed by the server
(activities) and are not built yet. type is FunctionIconVo.type: 1 top row, 2 right column, 3 bottom row, 4 the folded bottom column, 5 left.

  python3 pipeline/functions_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import json
import re
import sys


def table(lua_dir):
    src = open(f"{lua_dir}/function_data.lua", encoding="utf-8").read()
    src = src[src.index("Config.FunctionData.data_info = {"):src.index("Config.FunctionData.data_base")]
    out = {}
    for row in re.split(r"\n\t(?:\[\d+\] = )?\{\n", src)[1:]:
        field = lambda k: re.search(rf'\t\t{k} = "?([^\n",]*)"?,?\n', row).group(1)
        lev = re.search(r'activate = \{\s*\{\s*"lev",\s*(\d+)', row)
        if field("open_type") != "1" or field("is_show") != "1" or not lev:
            continue
        out[field("id")] = [field("icon_res"), int(field("type")), int(field("index")), field("icon_name"), int(lev.group(1))]
    return out


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(t), "function icons")
