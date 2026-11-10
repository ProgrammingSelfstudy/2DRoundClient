#!/usr/bin/env python3
"""What the battle scene needs to play a skill, from the restored Lua tables (readable-source/lua/ePoCrKQk.../):

  t  unique effect rows [anime_user_atk, anime_res, shake_id, hit_action, split_hurt] of skill_data*.lua's effect table (data_get_effect_table;
     hit_action is "hurt" or "no-hurt"; split_hurt is into how many hits the effect's damage is split, 1 for most)
  e  effect bid -> index into t (the server sends the effect bid in 20004's effect_play)
  g  effect group (skill number // 10) -> the attack animation (skill_actions_table.py), for an effect the server sent without a bid
  s  shake id -> [strength, time, rate] (skill_data.lua, data_get_shake_data)
  k  effect bid -> [delay in 1/30 s, opacity 0..255, hides the others 0|1]: the effect's black screen (action_list acts blackScreen2/3/4 of
     skill_data.lua's act table; plain blackScreen does nothing in battle_model.lua, blackScreen6 is not done). Opacity is the act's third
     argument, 255 without one; blackScreen2 (only the attacker and its targets stay shown) also hides the others
  y  effect bid -> target_type, only for the rows whose target_type is not 1 (the enemy): 4 is the caster itself (the 炼狱鬼斩's own 15% hit point cost,
     seen in the original's fight record); the other values are not worked out, so a reader treats anything but 4 as the enemy
  n  [skill bid] of the active skills that are a hero's normal attack (skill row field 6 is 1): the skill-name banner is not shown for them
  nm skill bid -> name of every active skill that is not a normal attack, so the banner finds the form variants (541314 is 阿修罗·亡者戏 again) that no hero's skill list has
  m  model -> anime_res -> animation name -> [move_time, move_model_x, move_model_y, back_delay_time, back_move_time, back_model_x,
     move_delay_time, is_reverse, is_move_area, is_col_act, is_move_map] (battle_act_data.lua, data_info); "0" is the default row

  python3 pipeline/skill_fx_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I leaves the script's folder off the path
from skill_actions_table import lua_row, table as group_actions

ACT_FIELDS = ["move_time", "move_model_x", "move_model_y", "back_delay_time", "back_move_time", "back_model_x",
              "move_delay_time", "is_reverse", "is_move_area", "is_col_act", "is_move_map"]


def effects(lua_dir):
    rows, index = [], {}
    by_bid = {}
    for path in sorted(glob.glob(f"{lua_dir}/skill_data*.lua")):
        src = open(path, encoding="utf-8").read()
        if "data_get_effect_table = {" not in src:
            continue
        src = src[src.index("data_get_effect_table = {"):]
        src = src[:src.index("\n}\n")]
        for m in re.finditer(r'\[(\d+)\] = "(\{.*\})",?\n', src):
            row = lua_row(m.group(2))
            # indexes of the effect row: 5 anime_res, 6 anime_user_atk, 13 shake_id, 19 hit_action, 24 split_hurt
            item = (row[6], row[5], int(row[13]), row[19], max(1, int(row[24])))
            by_bid[m.group(1)] = index.setdefault(item, len(index))
            if len(rows) < len(index):
                rows.append(list(item))
    assert len(by_bid) > 7000, len(by_bid)  # 7665 effect rows
    return rows, by_bid


def targets(lua_dir):
    out = {}
    for path in sorted(glob.glob(f"{lua_dir}/skill_data*.lua")):
        src = open(path, encoding="utf-8").read()
        if "data_get_effect_table = {" not in src:
            continue
        src = src[src.index("data_get_effect_table = {"):]
        src = src[:src.index("\n}\n")]
        for m in re.finditer(r'\[(\d+)\] = "(\{.*\})",?\n', src):
            ty = int(lua_row(m.group(2))[2])
            if ty != 1:
                out[m.group(1)] = ty
    return out


def blacks(lua_dir):
    """effect bid -> [delay, opacity, hide]; the first black act of the effect's action list sets the opacity (the scene's layer is shown once)"""
    src = open(f"{lua_dir}/skill_data.lua", encoding="utf-8").read()
    acts = {}
    for m in re.finditer(r'\[(\d+)\] = \{\s*act_type = \d+,\s*bid = \d+,\s*name = "[^"]*",\s*act_args = \{\s*"(\w+)",\s*\{([^}]*)\},?\s*\},?\s*\}', src):
        if m.group(2) in ("blackScreen2", "blackScreen3", "blackScreen4"):
            acts[int(m.group(1))] = (m.group(2), [a.strip().strip('"') for a in m.group(3).split(",") if a.strip()])
    assert len(acts) == 7, acts  # 10008, 10026, 10027, 10040 to 10043 (no act uses blackScreen4)

    def flat(x):
        for i in x:
            if isinstance(i, list):
                yield from flat(i)
            else:
                yield i

    out = {}
    for path in sorted(glob.glob(f"{lua_dir}/skill_data*.lua")):
        text = open(path, encoding="utf-8").read()
        if "data_get_effect_table = {" not in text:
            continue
        text = text[text.index("data_get_effect_table = {"):]
        text = text[:text.index("\n}\n")]
        for m in re.finditer(r'\[(\d+)\] = "(\{.*\})",?\n', text):
            hit = [acts[a] for a in flat(lua_row(m.group(2))[4]) if a in acts]
            if not hit:
                continue
            first = hit[0][1]
            delay = int(first[0]) if first and first[0].lstrip("-").isdigit() else 0
            opacity = int(first[2]) if len(first) > 2 and first[2].isdigit() else 255
            out[m.group(1)] = [delay, min(255, opacity), 1 if any(h[0] == "blackScreen2" for h in hit) else 0]
    assert len(out) > 1000, len(out)  # 1128 effects
    return out


def normals(lua_dir):
    """the skills that are normal attacks: skill rows (the quoted literals of skill_data*.lua) {bid, "name", "kind", n, n, n, normal, n, "active_skill", ...}
    with the normal field 1; read with a pattern because some rows' texts do not parse as JSON"""
    out = set()
    pat = re.compile(r'\[(\d+)\] = "\{\d+, \\"[^\n]*?\\", \\"[^\n]*?\\", -?\d+, -?\d+, -?\d+, (\d+), -?\d+, \\"active_skill\\"')
    for path in sorted(glob.glob(f"{lua_dir}/skill_data*.lua")):
        for m in pat.finditer(open(path, encoding="utf-8").read()):
            if m.group(2) == "1":
                out.add(int(m.group(1)))
    assert 100 < len(out) < 3000, len(out)
    return sorted(out)


def skill_names(lua_dir):
    """skill bid -> name of the active skills that are not normal attacks (every skill row of skill_data*.lua, read with the pattern of normals())"""
    out = {}
    pat = re.compile(r'\[(\d+)\] = "\{\d+, \\"([^\n]*?)\\", \\"[^\n]*?\\", -?\d+, -?\d+, -?\d+, (\d+), -?\d+, \\"active_skill\\"')
    for path in sorted(glob.glob(f"{lua_dir}/skill_data*.lua")):
        for m in pat.finditer(open(path, encoding="utf-8").read()):
            if m.group(3) != "1" and m.group(2):
                out[m.group(1)] = m.group(2)
    assert len(out) > 1000 and out.get("541314") == "阿修罗·亡者戏", len(out)
    return out


def shakes(lua_dir):
    src = open(f"{lua_dir}/skill_data.lua", encoding="utf-8").read()
    src = src[src.index("Config.SkillData.data_get_shake_data = {"):]
    src = src[:src.index("\n}\n") + 3]  # keep the newline after the last entry
    out = {}
    for m in re.finditer(r"\{(.*?)\},?\n", src, re.S):
        body = m.group(1)
        f = {k: int(v) for k, v in re.findall(r"\b(bid|shake_rate|shake_strength|shake_time) = (\d+)", body)}
        if "bid" in f:
            out[str(f["bid"])] = [f["shake_strength"], f["shake_time"], f["shake_rate"]]
    assert len(out) == 16, len(out)  # data_get_shake_data_length
    return out


class Lua:  # the table literals of battle_act_data.lua: { key = number | "string" | { ... }, [n] = ..., }
    def __init__(self, text):
        self.t = re.findall(r'"[^"]*"|-?\d+(?:\.\d+)?|[A-Za-z_]\w*|[{}=,\[\]]', text)
        self.i = 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def take(self):
        self.i += 1
        return self.t[self.i - 1]

    def value(self):
        tok = self.take()
        if tok == "{":
            out = {}
            while self.peek() != "}":
                if self.peek() == "[":
                    self.take()
                    key = self.take()
                    self.take()  # ]
                else:
                    key = self.take()
                assert self.take() == "="
                out[key.strip('"')] = self.value()
                if self.peek() == ",":
                    self.take()
            self.take()
            return out
        if tok.startswith('"'):
            return tok[1:-1]
        return float(tok) if "." in tok else int(tok)


def acts(lua_dir):
    src = open(f"{lua_dir}/battle_act_data.lua", encoding="utf-8").read()
    src = src[src.index("Config.BattleActData.data_info = ") + len("Config.BattleActData.data_info = "):]
    data = Lua(src[:src.index("\n}\n") + 2]).value()
    out = {}
    for model, by_res in data.items():
        for res, by_anim in by_res.items():
            for anim, p in by_anim.items():
                out.setdefault(model, {}).setdefault(res, {})[anim] = [int(p.get(k, 0)) for k in ACT_FIELDS]
    assert "0" in out and len(out) > 80, len(out)  # 85 distinct models; the file lists some of them twice, identically
    return out


def table(lua_dir):
    t, e = effects(lua_dir)
    return {"t": t, "e": e, "g": group_actions(lua_dir), "s": shakes(lua_dir), "k": blacks(lua_dir), "y": targets(lua_dir), "n": normals(lua_dir), "nm": skill_names(lua_dir), "m": acts(lua_dir)}


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w"), separators=(",", ":"))
    print(len(t["t"]), "unique effect rows,", len(t["e"]), "effects,", len(t["g"]), "groups,", len(t["s"]), "shakes,", len(t["m"]), "models")
