-- Independent oracle for check_skill_source_tables.py. Execute the recovered
-- LuaJIT bytecode, including its accessors and missing-effect resolution.
-- Arguments: partner, skill_data, skill_data1..6, battle_model bytecode paths.
for i = 1, 8 do dofile(arg[i]) end
BattleModel = {}
dofile(arg[9])

local function quote(value)
  return '"' .. value:gsub('[%z\1-\31\\"]', function(ch)
    if ch == '"' then return '\\"' end
    if ch == '\\' then return '\\\\' end
    return string.format('\\u%04x', string.byte(ch))
  end) .. '"'
end

local function json(value)
  local kind = type(value)
  if kind == 'string' then return quote(value) end
  if kind == 'number' or kind == 'boolean' then return tostring(value) end
  assert(kind == 'table', 'unsupported value: ' .. kind)
  local keys, array = {}, true
  for key in pairs(value) do
    keys[#keys + 1] = key
    if type(key) ~= 'number' then array = false end
  end
  local parts = {}
  if array then
    for i = 1, #value do parts[i] = json(value[i]) end
    assert(#keys == #value, 'sparse array')
    return '[' .. table.concat(parts, ',') .. ']'
  end
  table.sort(keys)
  for _, key in ipairs(keys) do parts[#parts + 1] = quote(key) .. ':' .. json(value[key]) end
  return '{' .. table.concat(parts, ',') .. '}'
end

local out = {stars = {}, skills = {}, skill_definitions = {}, effects = {}, effect_definitions = {}, actions = {}, lists = {}, entities = {}, resolved = {}, egghead = {}}
for key, raw in pairs(Config.PartnerData.data_partner_star_table) do
  out.stars[key] = assert(loadstring('return ' .. raw))()
end

local fields = {'bact_effect_list', 'act_effect_list', 'area_effect_list', 'hit_effect_list', 'hurt_effect_list', 'trc_effect_list'}
local skill_fields = {'bid', 'name', 'owner', 'group', 'next_id', 'level', 'is_normal_skill', 'cd', 'type', 'fit_combat_type', 'best_target', 'target', 'count', 'effect_list', 'add_attr', 'hallows_atk', 'des', 'open_desc', 'skill_desc', 'icon', 'is_play_sound', 'skill_type', 'passive_skill_show', 'buff_des', 'power', 'target_multi', 'fire_cd', 'client_lev'}
local effect_fields = {'bid', 'group', 'target_type', 'effect_type', 'action_list', 'anime_res', 'anime_user_atk', 'bact_effect_list', 'act_effect_list', 'area_effect_list', 'hit_effect_list', 'hurt_effect_list', 'trc_effect_list', 'shake_id', 'ready_sound', 'attack_sound', 'hit_sound', 'is_play_hit_sound', 'effect_desc', 'hit_action', 'act_hurt_type', 'is_move_map', 'is_must_die', 'shout_trick', 'split_hurt', 'play_stand'}
local function values(row, names)
  local result = {}
  for i, name in ipairs(names) do
    assert(row[name] ~= nil, 'missing source field: ' .. name)
    result[i] = row[name]
  end
  return result
end
for i = 1, 6 do
  local source = Config['SkillData' .. i]
  for bid in pairs(source.data_get_skill_table) do
    local key = tostring(bid)
    out.skills[key] = values(Config.SkillData.data_get_skill(bid), skill_fields)
    out.skill_definitions[key] = out.skill_definitions[key] or {}
    table.insert(out.skill_definitions[key], i)
  end
  for bid in pairs(source.data_get_effect_table) do
    local key, raw, resolved, has_raw, has_resolved = tostring(bid), {}, {}, false, false
    out.effect_definitions[key] = out.effect_definitions[key] or {}
    table.insert(out.effect_definitions[key], i)
    local row = Config.SkillData.data_get_effect(bid)
    out.effects[key] = values(row, effect_fields)
    for slot, field in ipairs(fields) do
      raw[slot] = row[field]
      resolved[slot] = {}
      for _, entity in ipairs(BattleModel.getCurEffectList({}, row[field])) do
        resolved[slot][#resolved[slot] + 1] = entity.bid
      end
      has_raw = has_raw or #raw[slot] > 0
      has_resolved = has_resolved or #resolved[slot] > 0
    end
    if has_raw then out.lists[key] = raw end
    if has_resolved then out.resolved[key] = resolved end
  end
end

for bid, row in pairs(Config.SkillData.data_get_act_data) do out.actions[tostring(bid)] = row.act_args end

local entity_fields = {'res_up', 'res_down', 'up_action_name', 'down_action_name', 'play_type', 'scale', 'h_scale', 'x_fix', 'y_fix', 'is_fornt', 'is_col_effect', 'spec_res_up'}
for bid, row in pairs(Config.SkillData.data_get_effect_data) do
  local values = {}
  for i, field in ipairs(entity_fields) do
    assert(row[field] ~= nil, 'missing entity field: ' .. field)
    values[i] = row[field]
  end
  out.entities[tostring(bid)] = values
end

for bid = 70533, 70540 do
  local base = Config.PartnerData.data_partner_base[bid]
  local star = Config.PartnerData.data_partner_star(bid .. '_' .. base.init_star)
  out.egghead[#out.egghead + 1] = {
    bid = bid, name = base.name, init_star = base.init_star,
    max_star = Config.PartnerData.data_partner_max_star[bid],
    is_show = star.is_show, is_show_pokedex = star.is_show_pokedex,
    skill_count = #star.skills,
  }
end

-- These are UI boundary stubs only; the catalog filter and skill population
-- below execute the original methods, without starting the Cocos renderer.
if arg[10] and arg[11] then
  HeroController = {getInstance = function() return {getModel = function() return {} end} end}
  HeroLibraryMainWindow, HeroLibraryInfoWindow = {}, {}
  class = function() return {} end
  cc = {size = function(w, h) return {width = w, height = h} end}
  getNorKey = function(bid, star) return bid .. '_' .. star end
  SortTools = {tableCommonSorter = function() return function(a, b) return a.bid < b.bid end end}
  dofile(arg[10])
  dofile(arg[11])
  local view = {
    list_view = {}, scrollview_size = {width = 600}, item_width = 100,
    item_height = 100, col = 6, first_title_height = 30, title_height = 30,
    updateCareerUI = function() end, reloadData = function() end,
  }
  HeroLibraryMainWindow.updateHeroList(view, 7, true)
  local visible = {}
  for _, row in ipairs(view.hero_library_list) do
    if row.config then visible[row.config.bid] = true end
  end
  for _, hero in ipairs(out.egghead) do
    local info = {
      partner_config = Config.PartnerData.data_partner_base[hero.bid],
      skill_container_size = {width = 500, height = 120}, skill_item_list = {},
      skill_container = {setInnerContainerSize = function() end},
    }
    HeroLibraryInfoWindow.initSkill(info)
    hero.library_visible = visible[hero.bid] or false
    hero.library_skill_items = #info.skill_item_list
  end
end

io.write(json(out), '\n')
