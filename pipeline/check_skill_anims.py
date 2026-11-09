#!/usr/bin/env python3
"""Check, for every hero and every one of its skills, that a built release can play the skill's animation the way the battle scene does.

For a hero (partner_data.lua's data_partner_star_table: bid_star -> model, skills) and each skill (skill_data*.lua: effect_list), the scene plays
the animation of the first effect row naming one (else of the effect group, else "action2"; skill_fx_table.py / skillplan.ts attackOf) from the
model's file of that name, else action1's, else any other action file of the model (some animations live inside another file), and
lands the damage on the animation's "hit" event, or on its "attack" event when it has none (skillplan.ts hitEvent). A skill passes when
  - the release carries the model (spine/hero/<model>/stand2 and hurt),
  - the animation exists in one of its files, and that file's atlas pages are in the release (a skeleton whose picture the original lacks cannot be drawn),
  - and, if it hurts someone, the animation has an event to land the damage on.
Passive skills and the skills with no effect that hurts or heals are listed apart: the scene plays no animation for them.
Legendary heroes (init_star 5, rare_flag 1) come first.

  python3 pipeline/check_skill_anims.py <assets-dir> <version> [--all]      (--all also lists the passing skills)
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hero_skills_table import UNPARSED, skill_rows, star_rows  # noqa: E402

LUA = "source/restored-source/outputs/readable-source/lua/ePoCrKQkWA3vpiOwu2oNfOh02MOeNheW"
HIT_EVENTS = ["hit", "hit_big", "hit_none", "hitevent1", "attack"]  # skillplan.ts hitEvent, in its order


def load(assets, version):
    base = f"{assets}/build/{version}"
    man = json.load(open(f"{base}/manifest.web.json"))["files"]

    def read(logical):
        f = man[logical]
        return json.load(open(f"{base}/f/{f['hash'][:2]}/{f['hash']}.{f['ext']}"))

    return man, read


def main(assets, version, show_all):
    man, read = load(assets, version)
    fx = read("tables/skill_fx.json")
    lua = f"{assets}/{LUA}"
    skills, stars = skill_rows(lua), star_rows(lua)
    partner = open(f"{lua}/partner_data.lua", encoding="utf-8").read()
    legendary = {b for b, body in re.findall(r"\[(\d+)\] = \{\n\t\tbid = \d+,(.*?)\n\t\},", partner, re.S) if "init_star = 5" in body and "rare_flag = 1" in body}
    names = {b: re.search(r'name = "([^"]*)"', body).group(1) for b, body in re.findall(r"\[(\d+)\] = \{\n\t\tbid = \d+,(.*?)\n\t\},", partner, re.S)}

    cache = {}

    def pages_ok(model, name):  # every page the file's atlas lists is in the release as a webp
        logical = f"spine/hero/{model}/{name}.atlas"
        if logical not in man:
            return False
        f = man[logical]
        text = open(f"{assets}/build/{version}/f/{f['hash'][:2]}/{f['hash']}.atlas", encoding="utf-8", errors="replace").read()
        pages = [ln.strip() for ln in text.splitlines() if ln.strip().lower().endswith(".png")]
        return bool(pages) and all(f"spine/hero/{model}/{p[:-4]}.webp" in man for p in pages)

    def skeleton(model, name):  # the animations of one file of a model in the release: {name: [(event, time)]}, or None when the file is not in it or cannot be drawn
        key = (model, name)
        if key not in cache:
            logical = f"spine/hero/{model}/{name}.json"
            ok = logical in man and pages_ok(model, name)
            cache[key] = None if not ok else {a: sorted((e["name"].lower(), e["time"]) for e in v.get("events", [])) for a, v in read(logical)["animations"].items()}
        return cache[key]

    def attack(sid, effects):  # (animation, anime_res) as skillplan.ts attackOf
        for e in effects:
            i = fx["e"].get(str(e))
            if i is not None and fx["t"][i][0]:
                return fx["t"][i][0], fx["t"][i][1]
        return fx["g"].get(str(sid // 10), "action2"), ""

    def play(model, anim):  # what the scene finds (battlescene.ts skeletonFor): the animation's own file, else action1's, else another action file
        for name in [anim, "action1", "action"] + [f"action{i}" for i in range(2, 10)]:
            sk = skeleton(model, name)
            if sk and anim in sk:
                return sk[anim], None
        sk = skeleton(model, "action1")
        return (sk.get("action1") if sk else None), f"no animation {anim} in any file of the model"

    order = sorted(stars, key=lambda k: (k.split("_")[0] not in legendary, int(k.split("_")[0]), int(k.split("_")[1])))
    seen_model_skill = set()
    report, tot = [], {"heroes": 0, "ok": 0, "bad": 0, "nomodel": 0, "passive": 0, "stars": 0}
    heroes = {}
    for key in order:
        row = stars[key]
        bid, star, model, sk_list = key.split("_")[0], int(key.split("_")[1]), row[2], row[13]
        has_model = skeleton(model, "stand2") is not None and skeleton(model, "hurt") is not None
        entry = heroes.setdefault(bid, {"name": names.get(bid, "?"), "legendary": bid in legendary, "stars": [], "problems": [], "ok": 0, "skills": 0, "passive": 0})
        entry["stars"].append(star)
        for _slot, sid in sk_list:
            tag = (model, sid)
            if tag in seen_model_skill:
                continue  # the same model and skill at another star: the animation is the same
            seen_model_skill.add(tag)
            sk = skills.get(str(sid))
            if not sk:
                entry["problems"].append(f"star {star} skill {sid}: not in the skill table")
                continue
            effects = sk[13]
            if sk[8] != "active_skill":
                entry["passive"] += 1
                continue
            entry["skills"] += 1
            if not has_model:
                entry["problems"].append(f"star {star} skill {sid} {sk[1]}: model {model} is not in the release")
                continue
            anim, _res = attack(sid, effects)
            events, err = play(model, anim)
            hurts = any(fx["t"][fx["e"][str(e)]][3] == "hurt" for e in effects if str(e) in fx["e"]) if effects else False
            ev_names = [n for n, _t in (events or [])]
            land = next((n for n in HIT_EVENTS if n in ev_names), None)
            at = next((t for n, t in events if n == land), None) if land else None
            if err:
                entry["problems"].append(f"star {star} skill {sid} {sk[1]}: {err}")
            elif hurts and not land:
                entry["problems"].append(f"star {star} skill {sid} {sk[1]}: {anim} has no hit or attack event to land the damage on")
            else:
                entry["ok"] += 1
                if show_all:
                    report.append(f"  ok  {bid}_{star} {entry['name']} skill {sid} {sk[1]}: {anim}, {land} at {at:.2f} s" if land else f"  ok  {bid}_{star} {entry['name']} skill {sid} {sk[1]}: {anim}, no damage")

    for bid, e in heroes.items():
        tot["heroes"] += 1
        tot["ok"] += e["ok"]
        tot["bad"] += len(e["problems"])
        tot["passive"] += e["passive"]
    lines = []
    for bid, e in heroes.items():
        mark = "传奇" if e["legendary"] else "    "
        state = "PASS" if not e["problems"] and e["skills"] else ("NO-SKILLS" if not e["skills"] else "FAIL")
        lines.append(f"{state:9s} {mark} {bid} {e['name']}: {e['ok']}/{e['skills']} active skills play, {e['passive']} passive, stars {e['stars'][0]}-{e['stars'][-1]}")
        lines += [f"            {p}" for p in e["problems"][:6]]
        if len(e["problems"]) > 6:
            lines.append(f"            ... and {len(e['problems']) - 6} more")
    print("\n".join(lines))
    if show_all:
        print("\n".join(report))
    leg = [e for e in heroes.values() if e["legendary"]]
    print(f"\nlegendary heroes: {sum(1 for e in leg if not e['problems'] and e['skills'])}/{len(leg)} fully pass; all heroes: {sum(1 for e in heroes.values() if not e['problems'] and e['skills'])}/{len(heroes)}; "
          f"{tot['ok']} active skills play, {tot['bad']} problems, {tot['passive']} passive skipped")
    if UNPARSED:
        print(f"{len(UNPARSED)} table rows could not be read: {UNPARSED[:8]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], "--all" in sys.argv)
