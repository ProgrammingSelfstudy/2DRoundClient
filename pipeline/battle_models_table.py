#!/usr/bin/env python3
"""The battle model table for the release, read by running the restored Lua data files in LuaJIT (their row layouts differ by file, so the
files' own accessors are the reliable reader):
  p: "<bid>_<star>" -> Spine model of a hero (Config.PartnerData.data_partner_star res_id)
  u: "<unit id>" -> [body model, model_size in thousandths] for the monsters of the main-line stages (the stage's unit and its monster1..5, boss)

  python3 pipeline/battle_models_table.py <lua dir ePoCrKQk.../> <out.json>
"""
import json
import subprocess
import sys
import tempfile

LUA = r'''
local dir = arg[1]
Config = {}
function TI18N(s) return s end
for _, f in ipairs({"unit_data1", "unit_data2", "unit_data3", "unit_data", "partner_data", "dungeon_data"}) do
  dofile(dir .. "/" .. f .. ".lua")
end
local out, seen = {p = {}, u = {}}, {}
local function unit(id)
  if not id or id == 0 or seen[id] then return end
  seen[id] = true
  local u = Config.UnitData.data_unit(id)
  if not u then return end
  out.u[tostring(id)] = {u.body_id, u.model_size or 1000}
  for _, k in ipairs({"monster1", "monster2", "monster3", "monster4", "monster5", "boss_id"}) do unit(u[k]) end
end
for id, _ in pairs(Config.DungeonData.data_drama_dungeon_info_table) do
  local d = Config.DungeonData.data_drama_dungeon_info(id)
  if d then unit(d.unit_id) end
end
for key, _ in pairs(Config.PartnerData.data_partner_star_table) do
  local s = Config.PartnerData.data_partner_star(key)
  if s then out.p[key] = s.res_id end
end
local function enc(v)
  if type(v) == "table" then
    if #v > 0 then local t = {}; for i, x in ipairs(v) do t[i] = enc(x) end; return "[" .. table.concat(t, ",") .. "]" end
    local t = {}; for k, x in pairs(v) do t[#t + 1] = string.format("%q:%s", tostring(k), enc(x)) end; return "{" .. table.concat(t, ",") .. "}"
  elseif type(v) == "string" then return '"' .. v:gsub('"', '\\"') .. '"' end
  return tostring(v)
end
io.write(enc(out))
'''


def table(lua_dir):
    with tempfile.NamedTemporaryFile("w", suffix=".lua") as f:
        f.write(LUA)
        f.flush()
        r = subprocess.run(["luajit", f.name, lua_dir], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr)
    return json.loads(r.stdout)


if __name__ == "__main__":
    t = table(sys.argv[1])
    json.dump(t, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(t["p"]), "hero models,", len(t["u"]), "units")
