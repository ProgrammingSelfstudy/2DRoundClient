#!/usr/bin/env python3
"""The main-line stage table for the release: {id: [name, unit_id, hook_show_items, per_hook_items, lev_limit, next_id, quick_show_items]} from the restored
dungeon_data.lua (data_drama_dungeon_info_table; the field order is the one the file's own accessor assigns).

  python3 pipeline/dungeons_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import json
import re
import sys

NAME, NEXT_ID, HOOK_SHOW, UNIT_ID, PER_HOOK, LEV_LIMIT, QUICK_SHOW = 0, 5, 9, 12, 14, 18, 17  # 0-based positions in a row


def table(lua_dir):
    src = open(f"{lua_dir}/dungeon_data.lua", encoding="utf-8").read()
    src = src[src.index("data_drama_dungeon_info_table = {"):]
    src = src[:src.index("\n}\n")]
    out = {}
    for m in re.finditer(r'\[(\d+)\] = "(.*)",\n', src + "\n"):
        row = m.group(2).replace('\\"', '"')
        row = re.sub(r",\s*}", "}", row).replace("{", "[").replace("}", "]")
        r = json.loads(row)
        out[m.group(1)] = [r[NAME], r[UNIT_ID], r[HOOK_SHOW], r[PER_HOOK], r[LEV_LIMIT], r[NEXT_ID], r[QUICK_SHOW]]
    return out


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(t), "stages")
