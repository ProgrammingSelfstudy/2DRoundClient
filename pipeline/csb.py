#!/usr/bin/env python3
"""Read the image references and on-screen sizes out of the original Cocos Studio .csb layouts. Read-only.

A .csb is a FlatBuffers file (CSParseBinary). Layout learned from the files themselves (fb.py reads it without a schema):
  root: 0 version, 1 textures, 2 texturePngs, 3 nodeTree
  NodeTree: 0 classname, 1 children, 2 options, 3 customClassName
  Options: 0 data. For the plain "Node" classes data is the WidgetOptions itself; for every widget (Panel, ImageView, Button ...) data
  is that widget's own options table whose slot 0 is the WidgetOptions.
  WidgetOptions: 0 name, 7 position (x,y), 8 scale (x,y), 9 anchor (x,y), 10 colour, 11 size (w,h); each pair is an inline struct.
  ResourceData: 0 path, 1 plistFile, 2 resourceType. Its slot in each widget differs, so any table with that shape is taken.
The on-screen size of a node is its size times the scale of all its ancestors (rotation and anchors are ignored).

  python3 pipeline/csb.py <restored-source-root> <reports-dir> [csb-virtual-path ...]
"""
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fb import Buf  # noqa: E402

IMG = (".png", ".jpg", ".jpeg", ".webp")


def pair(b, t, slot):
    o = b.field(t, slot)
    if o is None:
        return None
    return b.f32(o), b.f32(o + 4)


def resource(b, o):
    """A field that points at a ResourceData table -> (path, plist), else None."""
    try:
        t = b.table(o)
        if not (0 < t < len(b.b) - 8) or b.slots(t) < 1:
            return None
        p = b.field(t, 0)
        if p is None:
            return None
        path = b.string(p)
        if not path.lower().endswith(IMG):
            return None
        pl = b.field(t, 1)
        plist = b.string(pl) if pl else ""
        return path, plist
    except Exception:
        return None


def walk(b, t, parent_scale, out, csb):
    cn = b.string(b.field(t, 0))
    sx = sy = 1.0
    size = None
    opt = b.field(t, 2)
    if opt is not None:
        ot = b.table(opt)
        d = b.field(ot, 0)
        if d is not None:
            dt = b.table(d)
            w = b.field(dt, 0) if cn != "Node" and b.slots(dt) > 0 else None
            # a "Node" has the WidgetOptions in data; a widget has it in data's slot 0
            wt = b.table(w) if w is not None and cn != "Node" else dt
            try:
                sc = pair(b, wt, 8)
                if sc:
                    sx, sy = sc
                sz = pair(b, wt, 11)
                if sz and sz[0] == sz[0] and sz[1] == sz[1] and 0 <= sz[0] < 20000 and 0 <= sz[1] < 20000:
                    size = sz
            except Exception:
                pass
            if cn != "Node":
                for i in range(1, b.slots(dt)):
                    o = b.field(dt, i)
                    if o is None:
                        continue
                    r = resource(b, o)
                    if r:
                        out.append({"csb": csb, "class": cn, "slot": i, "path": r[0], "plist": r[1],
                                    "w": size[0] * parent_scale[0] * abs(sx) if size else None,
                                    "h": size[1] * parent_scale[1] * abs(sy) if size else None})
    ps = (parent_scale[0] * sx, parent_scale[1] * sy)
    ch = b.field(t, 1)
    if ch is not None:
        base, n = b.vec(ch)
        for k in range(n):
            walk(b, b.table(base + 4 * k), ps, out, csb)


def parse(path, label):
    b = Buf(open(path, "rb").read())
    out = []
    walk(b, b.table(b.field(b.root(), 3)), (1.0, 1.0), out, label)
    return out


def main(root, rep, only):
    pkg = os.path.join(root, "outputs/apk-extracted/assets/HASH")
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    refs, bad = [], []
    for d in sorted(os.listdir(pkg)):
        for f in sorted(os.listdir(os.path.join(pkg, d))):
            if not f.endswith(".csb"):
                continue
            h = f[:-4]
            label = found.get(h, h)
            if only and label not in only:
                continue
            try:
                refs += parse(os.path.join(pkg, d, f), label)
            except Exception as e:
                bad.append({"csb": label, "error": repr(e)})
    if only:
        for r in refs:
            print(r)
        return
    json.dump({"refs": refs, "unreadable": bad}, open(f"{rep}/csb_refs.json", "w"))
    sized = sum(r["w"] is not None for r in refs)
    print(f"{len(refs)} image references ({sized} with a size) in {len(set(r['csb'] for r in refs))} csb; {len(bad)} csb unreadable")
    for b_ in bad[:5]:
        print(b_)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], set(sys.argv[3:]))
