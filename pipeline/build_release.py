#!/usr/bin/env python3
"""Build a release: images, atlas tables and layouts of the chosen groups, every output named by its content hash, plus the manifest.

  python3 pipeline/build_release.py <assets-dir> <version> <group> [group ...]

Reads <assets-dir>/source/{decrypted-images.zip,restored-source} and <assets-dir>/reports/{audit,resmap}.json (see docs/PATHS.md).
Writes <assets-dir>/build/<version>/f/<hash[:2]>/<hash>.<ext> and <assets-dir>/build/<version>/manifest.web.json.

Three kinds of file, all listed in the manifest under a logical path:
  images   resource/... -> boot/<name>.webp, ui/<dir>/<name>.webp. A png is re-encoded as lossy webp (q85, alpha lossless, see
           docs/reports/GIANTS.md and TEXTURES.md); webp and jpg stay as they are, re-encoding a lossy file gains nothing.
  atlases  resource/<dir>/<name>.plist -> ui/<dir>/<name>.json: {texture, size, frames{name: x,y,w,h,rotated,ox,oy,sw,sh}}.
  layouts  a .csb -> layouts/<dir>/<name>.json: the node tree (csb_tree.py), resource references rewritten to logical atlas paths.
A group with no naming rule stops the build instead of inventing names.
"""
import hashlib
import json
import os
import plistlib
import re
import subprocess
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from csb_tree import tree  # noqa: E402
from skel_to_json import convert  # noqa: E402

LAYOUTS = {"boot": ["login/user_panel.csb"], "mainui": ["mainui/mainui_view.csb"],
           "backpack": ["backpack/backpack_window.csb", "backpack/goods_item.csb"],
           "hero": ["hero/hero_bag_window.csb"], "battle": ["battle/battle_mvp_view.csb"], "battledrama": ["battle/battle_button_list.csb", "battledrama/battle_drama_quick_battle_windows.csb", "battledrama/battle_drama_hook_reward_windows.csb"]}  # group -> csb paths (under the recovered csb directory) shipped as layouts


def group_of(path):
    if path.startswith("resource/login/"):
        return "boot"
    if path.startswith("resource/common/"):
        return "core-base"
    if path.startswith("resource/mainui/"):
        return "mainui"
    if path.startswith("resource/backpack/"):
        return "backpack"
    if path.startswith("resource/centerscene/"):
        return "centerscene"
    if path.startswith("resource/herobag/"):
        return "herobag"
    if path.startswith("resource/hero/"):
        return "hero"
    if path.startswith("resource/headicon/"):
        return "icons-head"
    if path.startswith("resource/item/"):
        return "icons-item"
    if path.startswith("resource/functionicon/"):
        return "icons-function"
    if path in ("resource/bigbg/bigbg_2.jpg", "resource/bigbg/pattern/pattern_3.png", "resource/bigbg/bigbg_50.png"):  # the backpack window's backdrop and the strip over its paper; the girl of the quick battle window
        return "bigbg-bag"
    if path.startswith("resource/bigbg/hero/"):  # the hero bag's window pictures, set by hero_bag_window.lua over the layout's placeholders
        return "bigbg-hero"
    if path.startswith("resource/battlemvp/"):  # the win window's pictures
        return "battlemvp"
    if path.startswith("resource/levupgrade/"):  # the level-up window's pieces, which the hook reward window shares
        return "levupgrade"
    if path.startswith("resource/battledrama/"):
        return "battledrama"
    if path.startswith("resource/battle/"):
        return "battle"
    m = BATTLE_BG.match(path)  # a battle background: one group per map id, battlebg-10008
    if m:
        return "battlebg-" + m.group(1)
    m = SPINE_DIR.match(path)  # a Spine model: one group per model, named fx-E51130 / hero-H30036 as bundles.py does
    if m:
        return ("fx-" if m.group(1) == "E" else "hero-") + m.group(1) + m.group(2)
    return None


BATTLE_BG = re.compile(r"^resource/bigbg/battle_bg/(\d+)/")
SPINE_DIR = re.compile(r"^v9o8qm1Y40cbOAlh6LDp0kMDi5CzXlsO/([EH])(\d+)/")


def spine_logical(path, group, ext):  # v9o8.../E51130/action.skel -> spine/fx/E51130/action.<ext>
    kind = "fx" if group.startswith("fx-") else "hero"
    return f"spine/{kind}/{group.split('-', 1)[1]}/{path.rsplit('/', 1)[-1].rsplit('.', 1)[0]}.{ext}"


def logical_image(path, group):
    name = path.rsplit("/", 1)[-1].rsplit(".", 1)[0] + ".webp"
    if group == "boot":
        return "boot/" + name
    if group == "core-base":
        return "ui/common/" + name
    if group == "mainui":
        return "ui/mainui/" + name
    if group == "backpack":
        return "ui/backpack/" + name
    if group == "centerscene":
        return "bg/" + name
    if group == "herobag":
        return "ui/herobag/" + name
    if group == "hero":
        return "ui/hero/" + name
    if group == "bigbg-bag":
        return "bg/" + name
    if group == "bigbg-hero":
        return "bg/hero/" + name
    if group == "levupgrade":
        return "ui/levupgrade/" + name
    if group == "battlemvp":
        return "ui/battlemvp/" + name
    if group == "battledrama":
        return "ui/battledrama/" + name
    if group == "battle":
        return "ui/battle/" + name
    if group == "icons-head":
        return "icons/head/" + name
    if group == "icons-item":
        return "icons/item/" + name
    if group == "icons-function":
        return "icons/function/" + name
    if group.startswith("battlebg-"):
        return f"bg/battle/{group.split('-', 1)[1]}/{name}"
    if group.startswith(("fx-", "hero-")):
        return spine_logical(path, group, "webp")
    raise SystemExit(f"no naming rule for group {group!r}; add one to logical_image() first")


def logical_atlas(plist_path):  # resource/common/common.plist -> ui/common/common.json
    return "ui/" + plist_path.split("/", 1)[1].rsplit(".", 1)[0] + ".json"


def ints(s):
    return [int(x) for x in re.findall(r"-?\d+", s)]


def atlas_json(pl, texture_logical, size):
    frames = {}
    for name, f in pl["frames"].items():
        x, y, w, h = ints(f["frame"])
        ox, oy = ints(f.get("offset", "{0,0}"))
        sw, sh = ints(f["sourceSize"])
        frames[name] = {"x": x, "y": y, "w": w, "h": h, "rotated": bool(f.get("rotated")), "ox": ox, "oy": oy, "sw": sw, "sh": sh}
    return {"texture": texture_logical, "size": size, "frames": frames}


def main(assets, version, groups):
    rep = f"{assets}/reports"
    audit = {r["name"].rsplit(".", 1)[0]: r for r in json.load(open(f"{rep}/audit.json"))["images"]}
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    for g in groups:  # a battle background's layers have no entry in resmap (their names are built by the Lua), so look them up by hash
        if g.startswith("battlebg-"):
            sys.path.insert(0, f"{assets}/source/restored-source/outputs/recovery-tools")
            from resource_hash import resource_hash
            for name in ("b_bg.jpg", "map_bg.png", "m_bg.jpg"):
                p = f"resource/bigbg/battle_bg/{g.split('-', 1)[1]}/{name}"
                if resource_hash(p) in audit:
                    found[resource_hash(p)] = p
    inv = {p: h for h, p in found.items()}
    z = zipfile.ZipFile(f"{assets}/source/decrypted-images.zip")
    pkg = f"{assets}/source/restored-source/outputs/apk-extracted/assets/HASH"
    out = f"{assets}/build/{version}"
    os.makedirs(f"{out}/f", exist_ok=True)
    files, tmp = {}, tempfile.mkdtemp()

    def put(logical, data, ext, group, src, **extra):
        digest = hashlib.sha256(data).hexdigest()[:20]
        os.makedirs(f"{out}/f/{digest[:2]}", exist_ok=True)
        open(f"{out}/f/{digest[:2]}/{digest}.{ext}", "wb").write(data)
        files[logical] = {"hash": digest, "ext": ext, "bytes": len(data), "group": group, "src": src, **extra}

    for h, p in sorted(found.items(), key=lambda kv: kv[1]):
        g = group_of(p)
        if g not in groups:
            continue
        if p.endswith(".plist"):  # atlas table
            pl = plistlib.load(open(f"{pkg}/{h[0]}/{h}.plist", "rb"))
            tex = p.rsplit("/", 1)[0] + "/" + pl["metadata"]["textureFileName"]
            page = audit[inv[tex]]
            put(logical_atlas(p), json.dumps(atlas_json(pl, logical_image(tex, g), [page["w"], page["h"]]), separators=(",", ":")).encode(), "json", g, p)
            continue
        if g and g.startswith(("fx-", "hero-")) and p.endswith((".skel", ".atlas")):
            data = open(f"{pkg}/{h[0]}/{h}.{p.rsplit('.', 1)[1]}", "rb").read()
            if p.endswith(".skel"):  # Spine 3.4 binary -> the JSON Creator's 3.8 runtime reads
                put(spine_logical(p, g, "json"), json.dumps(convert(data), separators=(",", ":")).encode(), "json", g, p)
            else:
                put(spine_logical(p, g, "atlas"), data, "atlas", g, p)
            continue
        if h not in audit:
            continue
        r = audit[h]
        data = z.read("decoded/" + r["name"])
        if r["fmt"] == "png":
            src = f"{tmp}/{h}.png"
            open(src, "wb").write(data)
            subprocess.run(["cwebp", "-quiet", "-q", "85", "-m", "6", "-alpha_q", "100", "-exact", src, "-o", f"{tmp}/{h}.webp"], check=True)
            data, ext = open(f"{tmp}/{h}.webp", "rb").read(), "webp"
        else:
            ext = r["fmt"]
        put(logical_image(p, g), data, ext, g, p, w=r["w"], h=r["h"])

    for g in groups:
        for csb in LAYOUTS.get(g, []):
            cp = next((p for p in found.values() if p.endswith("/" + csb)), None)
            if not cp:
                raise SystemExit(f"layout {csb} not found")
            h = inv[cp]
            t = tree(f"{pkg}/{h[0]}/{h}.csb")

            def rewrite(n):
                for r in n["res"]:
                    # a frame inside an atlas is addressed as <logical atlas json>#<frame name>; a loose image by its original path
                    r["atlas"] = logical_atlas(r["plist"]) if r["plist"] else ""
                    # a loose image (an item icon) is addressed by its own logical path
                    r["image"] = "" if r["plist"] or not group_of(r["path"]) else logical_image(r["path"], group_of(r["path"]))
                for c in n["children"]:
                    rewrite(c)
            rewrite(t)
            put("layouts/" + csb.rsplit(".", 1)[0] + ".json", json.dumps(t, ensure_ascii=False, separators=(",", ":")).encode(), "json", g, cp)

    if "centerscene" in groups:  # the atlas of the building plates; its plist has no name in resmap, the hash is of resource/centerscene/centerscene.plist
        pl = plistlib.load(open(f"{pkg}/1/14DB545CBFF36DD3.plist", "rb"))
        assert pl["metadata"]["textureFileName"] == "centerscene.png"
        put("ui/centerscene/centerscene.json", json.dumps(atlas_json(pl, "bg/centerscene.webp", [256, 512]), separators=(",", ":")).encode(), "json", "centerscene", "resource/centerscene/centerscene.plist")
        lua = f"{assets}/source/restored-source/outputs/readable-source/lua/ePoCrKQkWA3vpiOwu2oNfOh02MOeNheW/main_scene_data.lua"
        src = open(lua, encoding="utf-8").read()
        block = src[src.index("id = 1,") - 120:src.index("id = 2,")]  # Config.city_data[1], the main city (the next city's id comes before its own building list)
        b = re.compile(r'bid = (\d+),\n\t+dir = (\d+),\n\t+dun_id = (\d+),\n\t+layer = (\d+),\n\t+name = "([^"]*)",\n\t+name_x = (-?\d+),\n\t+name_y = (-?\d+),\n\t+res = "([^"]*)",\n\t+type = (\d+),\n\t+x = (\d+),\n\t+y = (\d+)')
        city = {"width": 1350, "height": 1280, "buildings": [dict(zip(("bid", "dir", "dun_id", "layer", "name", "name_x", "name_y", "res", "type", "x", "y"), [int(v) if v.lstrip("-").isdigit() else v for v in m.groups()])) for m in b.finditer(block)]}
        assert len(city["buildings"]) == 7, len(city["buildings"])
        put("tables/city.json", json.dumps(city, ensure_ascii=False, separators=(",", ":")).encode(), "json", "centerscene", "main_scene_data.lua")

    if "scene" in groups:  # the main-city scene layers named by scene_names.py (day and night are the same pictures in the package: time 1 only)
        for n in ("1", "2", "3", "4"):
            src = next(f for f in os.listdir(f"{assets}/scene/centercity/1") if f.startswith(n + "."))
            put(f"scene/centercity/{n}.webp", open(f"{assets}/scene/centercity/1/{src}", "rb").read(), "webp", "scene", f"resource/centerscene/centercity/1/{src}")

    if "icons-item" in groups:  # the item table the icons are looked up with (name, icon number, type, quality)
        from items_table import table
        lua = f"{assets}/source/restored-source/outputs/readable-source/lua/ePoCrKQkWA3vpiOwu2oNfOh02MOeNheW"
        put("tables/items.json", json.dumps(table(lua), ensure_ascii=False, separators=(",", ":")).encode(), "json", "icons-item", "item_data*.lua")

    if "icons-head" in groups:  # bid and star -> head picture, name, camp
        from partners_table import table as partners
        lua = f"{assets}/source/restored-source/outputs/readable-source/lua/ePoCrKQkWA3vpiOwu2oNfOh02MOeNheW"
        put("tables/partners.json", json.dumps(partners(lua), ensure_ascii=False, separators=(",", ":")).encode(), "json", "icons-head", "partner_data.lua")

    if "icons-function" in groups:  # the level-opened function icons: id -> icon picture, row, order, name, level
        from functions_table import table as functions
        lua = f"{assets}/source/restored-source/outputs/readable-source/lua/ePoCrKQkWA3vpiOwu2oNfOh02MOeNheW"
        put("tables/functions.json", json.dumps(functions(lua), ensure_ascii=False, separators=(",", ":")).encode(), "json", "icons-function", "function_data.lua")

    if "battledrama" in groups:  # the main-line stage table: id -> name, unit, shown rewards, per-minute rewards, level limit, next stage
        from dungeons_table import table as dungeons
        lua = f"{assets}/source/restored-source/outputs/readable-source/lua/ePoCrKQkWA3vpiOwu2oNfOh02MOeNheW"
        put("tables/dungeons.json", json.dumps(dungeons(lua), ensure_ascii=False, separators=(",", ":")).encode(), "json", "battledrama", "dungeon_data.lua")
        from role_exp_table import table as role_exp  # the exp bar of the hook and quick battle reward window
        put("tables/role_exp.json", json.dumps(role_exp(lua), separators=(",", ":")).encode(), "json", "battledrama", "role_data.lua")

    if "battle" in groups:  # which Spine model a hero (bid_star) or a main-line monster (unit id) is drawn with
        from battle_models_table import table as battle_models
        lua = f"{assets}/source/restored-source/outputs/readable-source/lua/ePoCrKQkWA3vpiOwu2oNfOh02MOeNheW"
        put("tables/battle_models.json", json.dumps(battle_models(lua), ensure_ascii=False, separators=(",", ":")).encode(), "json", "battle", "partner_data.lua, unit_data*.lua")

    manifest = {"version": version, "platform": "web", "files": files}
    json.dump(manifest, open(f"{out}/manifest.web.json", "w"), ensure_ascii=False, indent=1)
    print(f"{version}: {len(files)} files, {sum(f['bytes'] for f in files.values()) / 1e6:.2f} MB -> {out}")
    for k, f in files.items():
        print(f"  {k:34s} {f['ext']:5s} {f['bytes']:>8} B  {f['hash']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
