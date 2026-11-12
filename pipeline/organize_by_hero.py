#!/usr/bin/env python3
"""Lay a release out as one folder per hero, so an artist can open a hero and find its pieces:

  <out>/<阵营>/<bid>_<名字>/
      模型_<Hxxxxx>/<动作>.json|atlas|webp   the hero's Spine actions (spine/hero/<model>/)
      技能_<技能号>_<名字>/图标.webp          the skill icon
      技能_<技能号>_<名字>/特效_<Exxxxx>/...  the effect models the skill's effect rows play (spine/fx/<model>/)
      头像_<星>.webp                          the head icon of each star
      信息.txt                                 model per star, skills per star, anything the tables name but the release lacks

Files are hard links into build/<version>/f (no copy; editing one in place changes the release, so replace, don't edit).
Pass --copy for real copies.

  python3 -I pipeline/organize_by_hero.py <build/dev54> <out dir> [--copy] [--only 索隆]
"""
import json
import os
import re
import shutil
import sys

CAMP = {1: "1_水", 2: "2_火", 3: "3_风", 4: "4_地", 5: "5_光", 6: "6_暗", 7: "7_传说"}  # camp_type of partner_data; names are a guess, only for sorting


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    copy = "--copy" in sys.argv
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    if only:
        args = [a for a in args if a != only]
    build, out = args[:2]
    man = json.load(open(f"{build}/manifest.web.json"))["files"]

    def load(p):
        e = man[p]
        return json.load(open(f"{build}/f/{e['hash'][:2]}/{e['hash']}.{e['ext']}"))

    P, HS, SI, FR = (load(f"tables/{n}.json") for n in ("partners", "hero_skills", "hero_skill_info", "skill_fx_res"))
    by_prefix = {}
    for k in man:
        by_prefix.setdefault(k.rsplit("/", 1)[0], []).append(k)
    missing = []

    def put(logical, dest):
        e = man[logical]
        src = f"{build}/f/{e['hash'][:2]}/{e['hash']}.{e['ext']}"
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest):
            os.remove(dest)
        (shutil.copy2 if copy else os.link)(src, dest)

    def put_dir(prefix, dest):  # every file of a logical folder
        files = by_prefix.get(prefix, [])
        for k in files:
            put(k, f"{dest}/{os.path.basename(k)}")
        return len(files)

    safe = lambda s: re.sub(r'[\\/:*?"<>|\s]+', "_", s)
    total = 0
    for bid, row in sorted(P["base"].items(), key=lambda kv: int(kv[0])):
        name, camp = row[0], row[1]
        if only and only not in name:
            continue
        stars = sorted((int(k.split("_")[1]), k) for k in HS["h"] if k.split("_")[0] == bid)
        if not stars:
            continue
        hdir = f"{out}/{CAMP.get(camp, str(camp))}/{bid}_{safe(name)}"
        info = [f"{name}  bid {bid}  阵营 {camp}  初始星 {row[2]}"]
        models, seen_skill, heads = {}, set(), set()
        for star, key in stars:
            model, skills = HS["h"][key]
            models.setdefault(model, []).append(star)
            info.append(f"{star}星: 模型 {model}  技能 {skills}")
            hid = P["head"].get(key)
            if hid is not None and hid not in heads and f"icons/head/{hid}.webp" in man:  # one file per head id, named by the first star that uses it
                heads.add(hid)
                put(f"icons/head/{hid}.webp", f"{hdir}/头像_{star}星起_{hid}.webp")
            for s in skills:
                if s in seen_skill:
                    continue
                seen_skill.add(s)
                sname, effs = HS["k"].get(str(s), ["?", []])
                sdir = f"{hdir}/技能_{s}_{safe(sname)}"
                icon = (SI["k"].get(str(s)) or [None, None, None])[2]
                if icon and f"icons/skill/{icon}.webp" in man:
                    put(f"icons/skill/{icon}.webp", f"{sdir}/图标_{icon}.webp")
                else:
                    missing.append(f"{name} 技能{s} {sname}: 图标 {icon} 不在发布包")
                fxs = []
                for e in effs:
                    ents = (FR["l"].get(str(e)) or [[]] * 6)[3]  # the entities the effect row plays
                    for ent in ents:
                        m = (FR["r"].get(str(ent)) or [""])[0]
                        if m and m not in fxs:
                            fxs.append(m)
                for m in fxs:
                    if not put_dir(f"spine/fx/{m}", f"{sdir}/特效_{m}"):
                        missing.append(f"{name} 技能{s} {sname}: 特效 {m} 不在发布包")
        for model, ss in models.items():
            n = put_dir(f"spine/hero/{model}", f"{hdir}/模型_{model}")
            if not n:
                missing.append(f"{name}: 模型 {model} 不在发布包（星 {ss}）")
        os.makedirs(hdir, exist_ok=True)
        open(f"{hdir}/信息.txt", "w", encoding="utf-8").write("\n".join(info) + "\n")
        total += 1
    if missing:
        open(f"{out}/缺失清单.txt", "w", encoding="utf-8").write("\n".join(missing) + "\n")
    print(total, "heroes,", len(missing), "missing pieces ->", out)


if __name__ == "__main__":
    main()
