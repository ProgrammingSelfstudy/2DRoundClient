#!/usr/bin/env python3
"""Spine 3.3/3.4 binary skeleton (.skel) -> the JSON Creator 3.8 loads.

The original ships 3.4.02 binaries and one 3.3.07 region-animation skeleton (E80027/action).
Creator 3.8.8 cannot read those binaries, but it reads their 3.x JSON.
The reader follows SkeletonBinary of spine-libgdx 3.4 field by field. A file that does not end exactly where the reader ends is an error,
so a wrong guess about the format shows up as a failure and not as a broken animation.

  python3 pipeline/skel_to_json.py <in.skel> [out.json]
"""
import json
import struct
import sys

BLEND = ["normal", "additive", "multiply", "screen"]
POS_MODE = ["fixed", "percent"]
SPACING_MODE = ["length", "fixed", "percent"]
ROTATE_MODE = ["tangent", "chain", "chainScale"]


class Reader:
    def __init__(self, data):
        self.d, self.p = data, 0

    def byte(self):
        b = self.d[self.p]
        self.p += 1
        return b

    def signed_byte(self):
        b = self.byte()
        return b if b < 128 else b - 256

    def bool(self):
        return self.byte() != 0

    def float(self):
        v = struct.unpack_from(">f", self.d, self.p)[0]
        self.p += 4
        return v

    def int(self, positive):
        r, shift = 0, 0
        while True:
            b = self.byte()
            r |= (b & 0x7F) << shift
            if not b & 0x80:
                break
            shift += 7
        r &= 0xFFFFFFFF
        if not positive:
            r = (r >> 1) ^ -(r & 1)
        elif r >= 0x80000000:  # a negative number written as an optimised-positive varint
            r -= 1 << 32
        return r

    def string(self):
        n = self.int(True)
        if n == 0:
            return None
        if n == 1:
            return ""
        s = self.d[self.p:self.p + n - 1].decode("utf-8")
        self.p += n - 1
        return s

    def color(self):
        c = self.d[self.p:self.p + 4]
        self.p += 4
        return c.hex()

    def floats(self, n):
        return [self.float() for _ in range(n)]

    def shorts(self):
        n = self.int(True)
        v = list(struct.unpack_from(f">{n}H", self.d, self.p))
        self.p += 2 * n
        return v


def num(v):
    return int(v) if v == int(v) and abs(v) < 1e9 else round(v, 6)


def constraint_order(out):
    """Encode the order Spine 3.4 computes in Skeleton.updateCache for 3.8.

    IK runs by increasing first-bone depth (equal depths reverse their input
    order), then paths, then transforms. 3.8 defaults every omitted order to
    zero, which would skip all but the first constraint of these restored rigs.
    """
    parents = {bone["name"]: bone.get("parent") for bone in out["bones"]}

    def depth(constraint):
        level, name = 0, parents[constraint["bones"][0]]
        while name is not None:
            level += 1
            name = parents[name]
        return level

    ik = out.get("ik", [])
    ordered = [c for _, c in sorted(enumerate(ik), key=lambda pair: (depth(pair[1]), -pair[0]))]
    ordered += out.get("path", []) + out.get("transform", [])
    for index, constraint in enumerate(ordered):
        constraint["order"] = index


def curve(r, frame, last):
    """A frame's curve goes with the frame, but the last frame has none."""
    if last:
        return
    t = r.byte()
    if t == 1:
        frame["curve"] = "stepped"
    elif t == 2:
        c = [num(r.float()) for _ in range(4)]
        frame["curve"], frame["c2"], frame["c3"], frame["c4"] = c


def vertices(r, count):
    if not r.bool():
        return [num(v) for v in r.floats(count * 2)]
    out = []
    for _ in range(count):
        n = r.int(True)
        out.append(n)
        for _ in range(n):
            out.append(r.int(True))
            out += [num(r.float()), num(r.float()), num(r.float())]
    return out


def attachment(r, placeholder, nonessential):
    name = r.string() or placeholder
    t = r.byte()
    a = {}
    if name != placeholder:
        a["name"] = name
    if t == 0:
        a["type"] = "region"
        path = r.string() or name
        if path != placeholder:
            a["path"] = path
        for k in ("rotation", "x", "y", "scaleX", "scaleY", "width", "height"):
            a[k] = num(r.float())
        a["color"] = r.color()
    elif t == 1:
        a["type"] = "boundingbox"
        n = r.int(True)
        a["vertexCount"] = n
        a["vertices"] = vertices(r, n)
        if nonessential:
            r.color()
    elif t in (2, 3):
        a["type"] = "mesh" if t == 2 else "linkedmesh"
        path = r.string() or name
        if path != placeholder:
            a["path"] = path
        a["color"] = r.color()
        if t == 2:
            n = r.int(True)
            a["uvs"] = [num(v) for v in r.floats(n * 2)]
            a["triangles"] = r.shorts()
            a["vertices"] = vertices(r, n)
            a["hull"] = r.int(True)
            if nonessential:
                a["edges"] = r.shorts()
                a["width"], a["height"] = num(r.float()), num(r.float())
        else:
            a["skin"] = r.string()
            a["parent"] = r.string()
            a["deform"] = r.bool()
            if nonessential:
                a["width"], a["height"] = num(r.float()), num(r.float())
    elif t == 4:
        a["type"] = "path"
        a["closed"] = r.bool()
        a["constantSpeed"] = r.bool()
        n = r.int(True)
        a["vertexCount"] = n
        a["vertices"] = vertices(r, n)
        a["lengths"] = [num(v) for v in r.floats(n // 3)]
        if nonessential:
            r.color()
    else:
        raise ValueError(f"attachment type {t} at {r.p}")
    return a


def skin(r, nonessential, slots):
    out = {}
    for _ in range(r.int(True)):
        slot = slots[r.int(True)]
        for _ in range(r.int(True)):
            key = r.string()
            out.setdefault(slot, {})[key] = attachment(r, key, nonessential)
    return out


def animation(r, bones, slots, iks, transforms, paths, skins, events):
    anim = {}
    for _ in range(r.int(True)):  # slots
        slot = slots[r.int(True)]
        for _ in range(r.int(True)):
            t = r.byte()
            n = r.int(True)
            frames = []
            for i in range(n):
                f = {"time": num(r.float())}
                if t == 0:
                    f["name"] = r.string()
                else:
                    f["color"] = r.color()
                    curve(r, f, i == n - 1)
                frames.append(f)
            anim.setdefault("slots", {}).setdefault(slot, {})["attachment" if t == 0 else "color"] = frames
    for _ in range(r.int(True)):  # bones
        bone = bones[r.int(True)]
        for _ in range(r.int(True)):
            t = r.byte()
            n = r.int(True)
            frames = []
            for i in range(n):
                f = {"time": num(r.float())}
                if t == 0:
                    f["angle"] = num(r.float())
                else:
                    f["x"], f["y"] = num(r.float()), num(r.float())
                curve(r, f, i == n - 1)
                frames.append(f)
            anim.setdefault("bones", {}).setdefault(bone, {})[["rotate", "translate", "scale", "shear"][t]] = frames
    for _ in range(r.int(True)):  # ik
        name = iks[r.int(True)]
        frames = []
        n = r.int(True)
        for i in range(n):
            f = {"time": num(r.float()), "mix": num(r.float()), "bendPositive": r.signed_byte() > 0}
            curve(r, f, i == n - 1)
            frames.append(f)
        anim.setdefault("ik", {})[name] = frames
    for _ in range(r.int(True)):  # transform constraints
        name = transforms[r.int(True)]
        frames = []
        n = r.int(True)
        for i in range(n):
            f = {"time": num(r.float())}
            for k in ("rotateMix", "translateMix", "scaleMix", "shearMix"):
                f[k] = num(r.float())
            curve(r, f, i == n - 1)
            frames.append(f)
        anim.setdefault("transform", {})[name] = frames
    for _ in range(r.int(True)):  # path constraints
        name = paths[r.int(True)]
        for _ in range(r.int(True)):
            t = r.byte()
            n = r.int(True)
            frames = []
            for i in range(n):
                f = {"time": num(r.float())}
                if t == 2:
                    f["rotateMix"], f["translateMix"] = num(r.float()), num(r.float())
                else:
                    f["position" if t == 0 else "spacing"] = num(r.float())
                curve(r, f, i == n - 1)
                frames.append(f)
            anim.setdefault("paths", {}).setdefault(name, {})[["position", "spacing", "mix"][t]] = frames
    for _ in range(r.int(True)):  # deform
        sk = skins[r.int(True)]
        for _ in range(r.int(True)):
            slot = slots[r.int(True)]
            for _ in range(r.int(True)):
                att = r.string()
                n = r.int(True)
                frames = []
                for i in range(n):
                    f = {"time": num(r.float())}
                    end = r.int(True)
                    if end:
                        start = r.int(True)
                        f["offset"] = start
                        f["vertices"] = [num(r.float()) for _ in range(end)]
                    curve(r, f, i == n - 1)
                    frames.append(f)
                anim.setdefault("deform", {}).setdefault(sk, {}).setdefault(slot, {})[att] = frames
    n = r.int(True)  # draw order
    if n:
        order = []
        for _ in range(n):
            f = {"time": num(r.float())}
            offs = []
            for _ in range(r.int(True)):
                slot = slots[r.int(True)]
                offs.append({"slot": slot, "offset": r.int(True)})
            if offs:
                f["offsets"] = offs
            order.append(f)
        anim["drawOrder"] = order
    n = r.int(True)  # events
    if n:
        evs = []
        for _ in range(n):
            f = {"time": num(r.float())}
            name = events[r.int(True)]
            f["name"] = name
            i, fl = r.int(False), num(r.float())
            if i:
                f["int"] = i
            if fl:
                f["float"] = fl
            if r.bool():
                f["string"] = r.string()
            evs.append(f)
        anim["events"] = evs
    return anim


def convert(data):
    r = Reader(data)
    out = {"skeleton": {"hash": r.string(), "spine": r.string()}}
    version = out["skeleton"]["spine"]
    if version not in ("3.3.07", "3.4.02"):
        raise ValueError(f"Spine version {version}, this reader supports 3.3.07 and 3.4.02")
    out["skeleton"]["width"], out["skeleton"]["height"] = num(r.float()), num(r.float())
    nonessential = r.bool()
    if nonessential:
        out["skeleton"]["images"] = r.string()  # 3.4 has no fps here
    bones = []
    out["bones"] = []
    for i in range(r.int(True)):
        b = {"name": r.string()}
        if i:
            b["parent"] = bones[r.int(True)]
        for k, d in (("rotation", 0), ("x", 0), ("y", 0), ("scaleX", 1), ("scaleY", 1), ("shearX", 0), ("shearY", 0), ("length", 0)):
            v = num(r.float())
            if v != d:
                b[k] = v
        rot, scale = r.bool(), r.bool()
        mode = {(True, True): "normal", (True, False): "noScale", (False, True): "noRotationOrReflection", (False, False): "onlyTranslation"}[(rot, scale)]
        if mode != "normal":
            b["transform"] = mode
        if nonessential:
            r.color()
        bones.append(b["name"])
        out["bones"].append(b)
    slots = []
    out["slots"] = []
    for _ in range(r.int(True)):
        s = {"name": r.string(), "bone": bones[r.int(True)], "color": r.color()}
        att = r.string()
        if att:
            s["attachment"] = att
        bm = BLEND[r.int(True)]
        if bm != "normal":
            s["blend"] = bm
        slots.append(s["name"])
        out["slots"].append(s)
    iks, transforms, paths = [], [], []
    for _ in range(r.int(True)):
        c = {"name": r.string()}
        c["bones"] = [bones[r.int(True)] for _ in range(r.int(True))]
        c["target"] = bones[r.int(True)]
        c["mix"] = num(r.float())
        c["bendPositive"] = r.signed_byte() > 0
        iks.append(c["name"])
        out.setdefault("ik", []).append(c)
    for _ in range(r.int(True)):
        c = {"name": r.string()}
        # 3.4 stores a count followed by every constrained bone; reading only one
        # index desynchronizes the rest of the file (including Egghead show poses).
        # Official 3.4.02 SkeletonBinary.java, "Transform constraints".
        c["bones"] = [bones[r.int(True)] for _ in range(r.int(True))] if version == "3.4.02" else [bones[r.int(True)]]
        c["target"] = bones[r.int(True)]
        for k in ("rotation", "x", "y", "scaleX", "scaleY", "shearY", "rotateMix", "translateMix", "scaleMix", "shearMix"):
            c[k] = num(r.float())
        transforms.append(c["name"])
        out.setdefault("transform", []).append(c)
    for _ in range(r.int(True)):
        c = {"name": r.string()}
        c["bones"] = [bones[r.int(True)] for _ in range(r.int(True))]
        c["target"] = slots[r.int(True)]
        c["positionMode"], c["spacingMode"], c["rotateMode"] = POS_MODE[r.int(True)], SPACING_MODE[r.int(True)], ROTATE_MODE[r.int(True)]
        for k in ("rotation", "position", "spacing", "rotateMix", "translateMix"):
            c[k] = num(r.float())
        paths.append(c["name"])
        out.setdefault("path", []).append(c)
    skins = ["default"]
    out["skins"] = {"default": skin(r, nonessential, slots)}
    for _ in range(r.int(True)):
        name = r.string()
        skins.append(name)
        out["skins"][name] = skin(r, nonessential, slots)
    events = []
    for _ in range(r.int(True)):
        name = r.string()
        e = {"int": r.int(False), "float": num(r.float())}
        s = r.string()
        if s:
            e["string"] = s
        events.append(name)
        out.setdefault("events", {})[name] = e
    out["animations"] = {}
    for _ in range(r.int(True)):
        name = r.string()
        out["animations"][name] = animation(r, bones, slots, iks, transforms, paths, skins, events)
    if r.p != len(data):
        raise ValueError(f"{len(data) - r.p} bytes left over at {r.p}")
    if len(iks) + len(paths) + len(transforms) > 1:
        constraint_order(out)
    return out


def convert_json(data):
    """Adapt the original 3.x JSON dialect without changing animation values.

    Some shipped actions have JSON instead of binary skeletons. Creator's 3.8
    reader takes four separate Bezier fields; 3.3/3.4 JSON stores an array.
    Bone inheritance uses the same mapping as the binary reader above.
    """
    out = json.loads(data)
    version = out.get("skeleton", {}).get("spine")
    if version not in ("3.3.07", "3.4.02"):
        raise ValueError(f"Spine JSON version {version}, this reader supports 3.3.07 and 3.4.02")
    for key in ("bones", "slots", "skins", "animations"):
        if key not in out:
            raise ValueError(f"Spine JSON is missing {key}")
    for bone in out["bones"]:
        rot, scale = bone.pop("inheritRotation", True), bone.pop("inheritScale", True)
        mode = {(True, True): "normal", (True, False): "noScale", (False, True): "noRotationOrReflection", (False, False): "onlyTranslation"}[(rot, scale)]
        if mode != "normal":
            bone["transform"] = mode

    def curves(value):
        if isinstance(value, dict):
            c = value.get("curve")
            if isinstance(c, list):
                if len(c) != 4 or not all(isinstance(n, (int, float)) for n in c):
                    raise ValueError(f"Invalid Bezier curve: {c}")
                value["curve"], value["c2"], value["c3"], value["c4"] = c
            for child in value.values():
                curves(child)
        elif isinstance(value, list):
            for child in value:
                curves(child)

    curves(out["animations"])
    if sum(len(out.get(key, [])) for key in ("ik", "path", "transform")) > 1:
        constraint_order(out)
    return out


if __name__ == "__main__":
    j = convert(open(sys.argv[1], "rb").read())
    text = json.dumps(j, ensure_ascii=False, separators=(",", ":"))
    if len(sys.argv) > 2:
        open(sys.argv[2], "w", encoding="utf-8").write(text)
    print(len(j["bones"]), "bones,", len(j["animations"]), "animations:", ", ".join(j["animations"]))
