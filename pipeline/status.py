#!/usr/bin/env python3
"""Write reports/status.json for the live page (reports/index.html). Run after any pipeline step; the page polls it.

  python3 pipeline/status.py <reports-dir> [step-name=done|doing|todo ...]
"""
import collections
import json
import os
import sys
import time

sys.dont_write_bytecode = True
STEPS = ["体检（尺寸、格式、重复）", "还原真实路径", "引用扫描", "解析 CSB 显示尺寸", "合并重复文件方案", "压缩纹理体积实测", "分包方案", "抓包录制确认"]


def load(p):
    try:
        return json.load(open(p))
    except Exception:
        return None


def main(rep, marks):
    a, rm, dd, cs = (load(f"{rep}/{n}") for n in ("audit.json", "resmap.json", "dedupe.json", "csb_refs.json"))
    st = load(f"{rep}/status.json") or {}
    steps = st.get("steps") or {s: "todo" for s in STEPS}
    for m in marks:
        k, v = m.rsplit("=", 1)
        steps[k] = v
    out = {"updated": time.strftime("%H:%M:%S"), "steps": steps, "notes": st.get("notes", [])}
    if a:
        out["audit"] = a["summary"]
    if a and rm:
        c, b = collections.Counter(), collections.Counter()
        for r in a["images"]:
            k = rm["why"].get(r["name"].rsplit(".", 1)[0], "unnamed")
            c[k] += 1
            b[k] += r["bytes"]
        out["classes"] = {k: [c[k], b[k]] for k in c}
    if dd:
        out["dedupe"] = dd["summary"]
    if cs:
        out["csb"] = {"refs": len(cs["refs"]), "csb": len({r["csb"] for r in cs["refs"]})}
    for f in ("textures.json",):
        t = load(f"{rep}/{f}")
        if t:
            out["textures"] = t
    json.dump(out, open(f"{rep}/status.json", "w"), ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
