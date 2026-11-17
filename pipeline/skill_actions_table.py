#!/usr/bin/env python3
"""The attack animation of each skill for the release: effect group -> the Spine action the attacker plays, from the restored skill_data*.lua
(Config.SkillData*.data_get_effect_table, field anime_user_atk). battle_model.lua falls back to "action2" when the field is empty. An effect's group is
its bid without the last two digits and a skill's group is the skill number // 10 (skill 150101 -> group 15010, effects 1501001...). Of a group the
effect with the lowest bid that names an action decides; a group whose effects name none plays "action2".

  python3 pipeline/skill_actions_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import glob
import json
import re
import sys


def lua_row(text):  # one quoted Lua table literal of the effect table -> list (strings contain no braces)
    out, inside = [], False
    for ch in text.replace('\\"', "\x00"):
        if ch == "\x00":
            inside = not inside
            out.append('"')
            continue
        if not inside and ch in "{}":
            ch = "[" if ch == "{" else "]"
        out.append(ch)
    return json.loads("".join(out))


def table(lua_dir):
    groups, seen = {}, set()
    for path in sorted(glob.glob(f"{lua_dir}/skill_data*.lua")):
        src = open(path, encoding="utf-8").read()
        if "data_get_effect_table = {" not in src:
            continue
        src = src[src.index("data_get_effect_table = {"):]
        src = src[:src.index("\n}\n") + 1]  # retain the last row's newline; the skill tables follow
        for m in re.finditer(r'\[(\d+)\] = "(\{.*\})",?\n', src):
            if m.group(1) in seen:
                continue  # data_get_effect keeps the first matching SkillData module
            seen.add(m.group(1))
            row = lua_row(m.group(2))
            groups.setdefault(str(row[1]), []).append((row[0], row[6]))
    out = {}
    for g, effects in groups.items():
        named = [a for _, a in sorted(effects) if a]
        out[g] = named[0] if named else "action2"
    assert len(out) > 1500, len(out)  # 1609 groups; they cover 1761 of the server's 2052 skills
    return out


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w"), separators=(",", ":"))
    print(len(t), "effect groups")
