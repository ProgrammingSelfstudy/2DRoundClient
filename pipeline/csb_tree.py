#!/usr/bin/env python3
"""Dump the whole node tree of a .csb as JSON: what a UI has to be rebuilt from. Read-only. Layout of the file: see csb.py.

Per node: class, name, pos, scale, anchor, size (WidgetOptions slots 7, 8, 9, 11), resources (any ResourceData table of the options),
strings (any plain string field of the options, e.g. the text of a Text node), s9 (nine-slice: capInsets x,y,w,h = the stretchable middle
rectangle, the size it is stretched to, and whether it is on; ImageView slots 2/3/4, Button slots 9/10/11) and children. Positions are in the parent's own space with
its bottom-left as origin, as Cocos Studio writes them.

  python3 pipeline/csb_tree.py <restored-source-root> <reports-dir> <csb logical path suffix, e.g. login/user_panel.csb> [out.json]
"""
import json
import os
import struct
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fb import Buf  # noqa: E402
from csb import resource, pair  # noqa: E402


def node(b, t):
    cn = b.string(b.field(t, 0))
    n = {"class": cn, "name": "", "pos": None, "scale": None, "anchor": None, "size": None, "res": [], "strings": [], "s9": None, "children": []}
    opt = b.field(t, 2)
    if opt is not None:
        d = b.field(b.table(opt), 0)
        if d is not None:
            dt = b.table(d)
            wt = dt if cn == "Node" else (b.table(b.field(dt, 0)) if b.field(dt, 0) is not None else None)
            if wt is not None:
                p = b.field(wt, 0)
                n["name"] = b.string(p) if p else ""
                for key, slot in (("pos", 7), ("scale", 8), ("anchor", 9), ("size", 11)):
                    v = pair(b, wt, slot)
                    n[key] = [round(v[0], 2), round(v[1], 2)] if v else None
            if cn in ("ImageView", "Button"):
                cap_slot, size_slot, on_slot = (2, 3, 4) if cn == "ImageView" else (9, 10, 11)
                c, z, e = b.field(dt, cap_slot), b.field(dt, size_slot), b.field(dt, on_slot)
                if c is not None and e is not None:
                    cap = [round(struct.unpack_from("<f", b.b, c + 4 * k)[0], 2) for k in range(4)]
                    sz = [round(struct.unpack_from("<f", b.b, z + 4 * k)[0], 2) for k in range(2)] if z is not None else None
                    n["s9"] = {"cap": cap, "size": sz, "on": bool(b.b[e])}
            if cn != "Node":
                for i in range(1, b.slots(dt)):
                    o = b.field(dt, i)
                    if o is None:
                        continue
                    r = resource(b, o)
                    if r:
                        n["res"].append({"slot": i, "path": r[0], "plist": r[1]})
                        continue
                    try:  # a plain string field (the text of a Text node, a font name...)
                        s = b.string(o)
                        if s and all(c >= " " or c in "\n\t" for c in s) and len(s) < 200:
                            n["strings"].append({"slot": i, "text": s})
                    except Exception:
                        pass
    ch = b.field(t, 1)
    if ch is not None:
        base, cnt = b.vec(ch)
        n["children"] = [node(b, b.table(base + 4 * k)) for k in range(cnt)]
    return n


def tree(path):
    b = Buf(open(path, "rb").read())
    return node(b, b.table(b.field(b.root(), 3)))


def show(n, ind=0):
    res = ",".join(f"{r['path']}" for r in n["res"])
    strs = ",".join(repr(s["text"]) for s in n["strings"])
    print("  " * ind + f"{n['class']} '{n['name']}' pos={n['pos']} size={n['size']} anchor={n['anchor']}" + (f" res=[{res}]" if res else "") + (f" s9={n['s9']}" if n["s9"] else "") + (f" str=[{strs}]" if strs else ""))
    for c in n["children"]:
        show(c, ind + 1)


if __name__ == "__main__":
    root, rep, want = sys.argv[1:4]
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    hashes = [h for h, p in found.items() if p.endswith(want)]
    if not hashes:
        raise SystemExit(f"no csb ending in {want}")
    pkg = os.path.join(root, "outputs/apk-extracted/assets/HASH")
    h = hashes[0]
    t = tree(os.path.join(pkg, h[0], h + ".csb"))
    if len(sys.argv) > 4:
        json.dump({"csb": found[h], "root": t}, open(sys.argv[4], "w"), ensure_ascii=False, indent=1)
    show(t)
