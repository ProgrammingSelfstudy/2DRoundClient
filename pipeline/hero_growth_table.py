#!/usr/bin/env python3
"""What the hero info window's train panel needs to show a hero's levelling, from the restored partner_data.lua:
  lev    [per level, index lev-1] the items a level costs: [[item bid, quantity], ...]   (data_partner_lev, expend)
  brach  "<type>_<break_id>_<break>" -> [lev_max, 1 when the step has an extra condition, skill_num: skill slots open]   (data_partner_brach)
  base   "<bid>" -> [type, break_id, introduce_str]                                       (data_partner_base)
  star   "<bid>_<star>" -> lev_max of that star                                           (data_partner_star_table, column 14)

  python3 pipeline/hero_growth_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I leaves the script's folder off the path


def top_fields(row):
    """the top-level fields of a Lua table literal's text ({...} stripped): split on commas outside braces and quotes"""
    out, depth, quote, cur = [], 0, False, ""
    text = row[1:-1].replace('\\"', "\x00")
    for ch in text:
        if ch == "\x00":
            cur += ch
            quote = not quote
        elif quote:
            cur += ch
        elif ch == "{":
            depth += 1
            cur += ch
        elif ch == "}":
            depth -= 1
            cur += ch
        elif ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    out.append(cur.strip())
    return out


def block(src, name):
    i = src.index(f"Config.PartnerData.{name} = {{")
    return src[i:src.index("\n}\n", i)]


def table(lua_dir):
    src = open(f"{lua_dir}/partner_data.lua", encoding="utf-8").read()
    lev = []
    for m in re.finditer(r"\n\t\{\n\t\tlev = (\d+),\n\t\texpend = \{((?:\n\t\t\t\{\n\t\t\t\t\d+,\n\t\t\t\t\d+,\n\t\t\t\},?)*)\n\t\t\},", block(src, "data_partner_lev")):
        nums = [int(x) for x in re.findall(r"\d+", m.group(2))]
        assert int(m.group(1)) == len(lev) + 1, m.group(1)
        lev.append([[nums[i], nums[i + 1]] for i in range(0, len(nums), 2)])
    brach = {}
    for m in re.finditer(r'\n\t\["(\d+_\d+_\d+)"\] = \{(.*?)\n\t\},?', block(src, "data_partner_brach"), re.S):
        body = m.group(2)
        brach[m.group(1)] = [int(re.search(r"lev_max = (\d+)", body).group(1)), 0 if re.search(r"\n\t\tlimit = \{\},", body) else 1,
                              int(re.search(r"skill_num = (\d+)", body).group(1))]
    base = {}
    for m in re.finditer(r"\n\t\[(\d+)\] = \{(.*?)\n\t\},?", block(src, "data_partner_base"), re.S):
        body = m.group(2)
        field = lambda k, d: (re.search(rf"\n\t\t{k} = (.*),", "\n" + body) or [None, d])[1]
        base[m.group(1)] = [int(field("type", 4)), int(field("break_id", 0)), json.loads(field("introduce_str", '""'))]
    star = {}
    for m in re.finditer(r'\n\t\["(\d+_\d+)"\] = "(\{.*\})",?', block(src, "data_partner_star_table")):
        star[m.group(1)] = int(top_fields(m.group(2))[14])
    assert len(lev) > 300 and len(brach) > 20 and len(base) > 150 and len(star) > 400, (len(lev), len(brach), len(base), len(star))
    return {"lev": lev, "brach": brach, "base": base, "star": star}


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(t["lev"]), "levels,", len(t["brach"]), "break steps,", len(t["base"]), "heroes,", len(t["star"]), "stars")
