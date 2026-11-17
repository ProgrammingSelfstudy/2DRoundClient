#!/usr/bin/env python3
"""Compare extracted skill tables with recovered LuaJIT bytecode execution.

The oracle reads the original modules and invokes BattleModel.getCurEffectList;
it does not parse the decompiler's text. Known missing source data remains a gap,
never an invitation to substitute a nearby skill or effect number.

  python3 pipeline/check_skill_source_tables.py <lua-dir> <bytecode-dir> <luajit> <out-dir>
      [--tables-dir <dir>] [--build-dir <build/dev55>]

lua-dir is the ePoCrKQk... configuration directory. Its sibling 0zWHhln... tree
supplies source identities for the original battle and catalog methods.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hero_skill_info_table
import hero_skills_table
import skill_actions_table
import skill_fx_res_table
import skill_fx_table

BUSINESS = "0zWHhlnBORyiROK6lvI6VBn6vAbJRQqS"
SLOTS = ["bact", "act", "area", "hit", "hurt", "trc"]
REQUESTED_ENTITIES = {7002970030, 70035, 405136}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def differences(expected, actual):
    return [{"key": key, "expected": expected.get(key), "actual": actual.get(key)}
            for key in sorted(expected.keys() | actual.keys()) if expected.get(key) != actual.get(key)]


def check(name, expected, actual):
    diff = differences(expected, actual)
    return {"table": name, "equal": not diff, "expected_rows": len(expected), "actual_rows": len(actual),
            "difference_count": len(diff), "differences": diff}


def source_modules(lua_dir):
    return [lua_dir / "partner_data.lua", lua_dir / "skill_data.lua",
            *(lua_dir / f"skill_data{i}.lua" for i in range(1, 7)),
            lua_dir.parent / BUSINESS / "battle/battle_model.lua",
            lua_dir.parent / BUSINESS / "hero/view/hero_library_main_window.lua",
            lua_dir.parent / BUSINESS / "hero/view/hero_library_info_window.lua"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lua_dir", type=Path)
    parser.add_argument("bytecode_dir", type=Path)
    parser.add_argument("luajit", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--tables-dir", type=Path)
    parser.add_argument("--build-dir", type=Path)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    modules, bytecode = [], []
    for path in source_modules(args.lua_dir):
        match = re.search(r"^-- Hash: ([0-9A-F]+)$", path.read_text(), re.M)
        if not match:
            raise ValueError(f"missing recovered module identity: {path}")
        binary = args.bytecode_dir / (match[1] + ".luac")
        bytecode.append(str(binary.resolve()))
        modules.append({"source": str(path.resolve()), "source_sha256": digest(path),
                        "recovered_hash": match[1], "bytecode": str(binary.resolve()), "bytecode_sha256": digest(binary)})

    probe = Path(__file__).with_name("dump_skill_source_tables.lua")
    execution = subprocess.run([str(args.luajit.resolve()), str(probe), *bytecode],
                               check=True, capture_output=True, text=True)
    native = json.loads(execution.stdout)
    (args.out_dir / "bytecode-tables.json").write_text(execution.stdout)
    lua_dir = str(args.lua_dir)
    stars, skills = hero_skills_table.star_rows(lua_dir), hero_skills_table.skill_rows(lua_dir)
    raw_lists, entities = skill_fx_res_table.lists(lua_dir), skill_fx_res_table.entities(lua_dir)
    comparisons = [check("partner_star", native["stars"], stars), check("skill", native["skills"], skills),
                   check("effect_lists", native["lists"], raw_lists), check("effect_entities", native["entities"], entities)]

    gaps = []
    for effect, slots in native["lists"].items():
        for index, ids in enumerate(slots):
            for entity in ids:
                if str(entity) not in native["entities"]:
                    gaps.append({"effect": int(effect), "slot": SLOTS[index], "entity": entity})
    gaps.sort(key=lambda row: (row["entity"], row["effect"], row["slot"]))
    for hero in native["egghead"]:
        rows = {key: value for key, value in native["stars"].items() if key.startswith(str(hero["bid"]) + "_")}
        hero["configured_stars"] = sorted(row[1] for row in rows.values())
        hero["empty_skill_stars"] = sorted(row[1] for row in rows.values() if not row[13])

    generated = {"hero_skills": hero_skills_table.table(lua_dir), "hero_skill_info": hero_skill_info_table.table(lua_dir),
                 "skill_fx_res": skill_fx_res_table.table(lua_dir)}
    comparisons.append(check("resolved_effect_lists", native["resolved"], generated["skill_fx_res"]["l"]))
    groups = {}
    for row in native["effects"].values():
        groups.setdefault(str(row[1]), []).append((row[0], row[6]))
    actions = {}
    for group, effects in groups.items():
        named = [action for _, action in sorted(effects) if action]
        actions[group] = named[0] if named else "action2"
    generated["skill_actions"] = skill_actions_table.table(lua_dir)
    comparisons.append(check("skill_actions", actions, generated["skill_actions"]))
    comparisons.append(check("effect_rows", native["effects"], dict(skill_fx_table.effect_rows(lua_dir))))
    effect_values, effect_index = skill_fx_table.effects(lua_dir)
    comparisons.append(check("skill_fx_effects", {bid: [row[6], row[5], row[13], row[19], max(1, row[24])]
                                                 for bid, row in native["effects"].items()},
                             {bid: effect_values[index] for bid, index in effect_index.items()}))
    comparisons.append(check("skill_fx_targets", {bid: row[2] for bid, row in native["effects"].items() if row[2] != 1},
                             skill_fx_table.targets(lua_dir)))
    attack_ids = {int(bid) for bid, action in native["actions"].items() if action[0] in ("attack", "flyItem")}
    modes = {bid: "attack" if any(action in attack_ids for action in skill_fx_table.flat_actions(row[4])) else "none"
             for bid, row in native["effects"].items()}
    actual_modes, actual_hold, actual_damage = skill_fx_table.actor_actions(lua_dir)
    comparisons.append(check("skill_fx_actor_modes", modes, actual_modes))
    comparisons.append(check("skill_fx_hold_pose", {bid: 0 for bid, row in native["effects"].items() if row[25] == 0}, actual_hold))
    comparisons.append(check("skill_fx_damage_effects", {bid: True for bid, row in native["effects"].items() if row[3] == 1 and modes[bid] == "attack"},
                             {str(bid): True for bid in actual_damage}))
    comparisons.append(check("skill_fx_normals", {bid: True for bid, row in native["skills"].items() if row[8] == "active_skill" and row[6] == 1},
                             {str(bid): True for bid in skill_fx_table.normals(lua_dir)}))
    comparisons.append(check("skill_fx_names", {bid: row[1] for bid, row in native["skills"].items() if row[8] == "active_skill" and row[6] != 1 and row[1]},
                             skill_fx_table.skill_names(lua_dir)))
    comparisons.append(check("skill_fx_action_definitions", native["actions"],
                             {str(bid): [op, json.loads("[" + arguments.strip().rstrip(",") + "]")]
                              for bid, (op, arguments) in skill_fx_table.action_definitions(lua_dir).items()}))
    fly = {int(bid): action[1] for bid, action in native["actions"].items() if action[0] == "flyItem"}
    projectiles = {}
    for bid, row in native["effects"].items():
        arguments = [fly[action] for action in skill_fx_table.flat_actions(row[4]) if action in fly]
        if arguments:
            assert len(arguments) == 1, (bid, arguments)
            projectiles[bid] = arguments[0]
    comparisons.append(check("skill_fx_projectiles", projectiles, skill_fx_table.projectiles(lua_dir)))
    if args.tables_dir:
        args.tables_dir.mkdir(parents=True, exist_ok=True)
        for name, table in generated.items():
            (args.tables_dir / (name + ".json")).write_text(json.dumps(table, ensure_ascii=False, separators=(",", ":")))

    release_comparisons = []
    if args.build_dir:
        files = json.loads((args.build_dir / "manifest.web.json").read_text())["files"]
        for name, table in generated.items():
            entry = files[f"tables/{name}.json"]
            old = json.loads((args.build_dir / "f" / entry["hash"][:2] / (entry["hash"] + "." + entry["ext"])).read_text())
            if name == "skill_actions":
                release_comparisons.append(check(name, table, old))
                continue
            for section, values in table.items():
                release_comparisons.append(check(name + "." + section, values, old.get(section, {})))

    identifiers = [b"data_get_effect_data", b"data_partner_star_table", b"70533_5", b"7002970030"]
    references = {term.decode(): [] for term in identifiers}
    binaries = sorted(args.bytecode_dir.glob("*.luac"))
    for binary in binaries:
        data = binary.read_bytes()
        for term in identifiers:
            if term in data:
                references[term.decode()].append(binary.name)

    report = {
        "scope": "Recovered local package only; no server hot-update or native rendering observation.",
        "oracle": {"luajit": str(args.luajit.resolve()), "luajit_sha256": digest(args.luajit),
                   "probe": str(probe.resolve()), "probe_sha256": digest(probe), "modules": modules},
        "comparisons": comparisons, "unparsed_rows": hero_skills_table.UNPARSED,
        "duplicate_skill_definitions": [{"skill": int(bid), "modules_in_lookup_order": modules, "selected_name": native["skills"][bid][1],
                                         "selected_owner": native["skills"][bid][2], "selected_type": native["skills"][bid][8]}
                                        for bid, modules in native["skill_definitions"].items() if len(modules) > 1],
        "duplicate_effect_definitions": [{"effect": int(bid), "modules_in_lookup_order": modules, "selected_group": native["effects"][bid][1],
                                          "selected_action": native["effects"][bid][6]}
                                         for bid, modules in native["effect_definitions"].items() if len(modules) > 1],
        "egghead": native["egghead"], "missing_entity_references": gaps,
        "requested_missing_entities": [row for row in gaps if row["entity"] in REQUESTED_ENTITIES],
        "original_runtime_resolution": {effect: native["resolved"].get(effect, [[], [], [], [], [], []])
                                        for effect in sorted({str(row["effect"]) for row in gaps if row["entity"] in REQUESTED_ENTITIES})},
        "bytecode_identifier_scan": {"modules_scanned": len(binaries), "matches": references},
        "release_comparisons": release_comparisons,
    }
    (args.out_dir / "source-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    failures = [row["table"] for row in comparisons if not row["equal"]]
    print(json.dumps({"verified": not failures, "mismatches": failures,
                      "rows": {row["table"]: row["actual_rows"] for row in comparisons},
                      "empty_skill_heroes": [hero["bid"] for hero in native["egghead"]],
                      "missing_entities": len({row["entity"] for row in gaps}),
                      "missing_entity_references": len(gaps), "report": str(args.out_dir / "source-verification.json")}, ensure_ascii=False))
    return 1 if failures or hero_skills_table.UNPARSED else 0


if __name__ == "__main__":
    sys.exit(main())
