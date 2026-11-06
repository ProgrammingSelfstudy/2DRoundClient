#!/usr/bin/env python3
"""Plan the merge of byte-identical images. Read-only: it writes a plan, it does not touch the originals.

Identical content (same decoded sha256 from the zip's manifest) is stored once under its content hash; every virtual path that had a
copy becomes an alias in the release manifest. Run audit.py and resmap.py first.

  python3 pipeline/dedupe.py <reports-dir>
"""
import collections
import json
import sys

sys.dont_write_bytecode = True


def main(rep):
    rows = json.load(open(f"{rep}/audit.json"))["images"]
    found = json.load(open(f"{rep}/resmap.json"))["found"]
    groups = collections.defaultdict(list)
    for r in rows:
        if r["sha"]:
            groups[r["sha"]].append(r)
    plan, saved, saved_gpu, by_kind = [], 0, 0, collections.Counter()
    for sha, g in groups.items():
        if len(g) < 2:
            continue
        stem = lambda r: r["name"].rsplit(".", 1)[0]
        # keep the copy with a recovered path (the manifest will name it), else the smallest hash name
        g.sort(key=lambda r: (stem(r) not in found, stem(r)))
        keep = g[0]
        extra = g[1:]
        saved += sum(r["bytes"] for r in extra)
        saved_gpu += sum(r["gpu"] for r in extra)
        for r in extra:
            by_kind[r["fmt"]] += r["bytes"]
        plan.append({"sha": sha, "bytes": keep["bytes"], "w": keep["w"], "h": keep["h"], "keep": stem(keep),
                     "aliases": [{"hash": stem(r), "path": found.get(stem(r), "")} for r in extra],
                     "keep_path": found.get(stem(keep), "")})
    plan.sort(key=lambda p: -p["bytes"] * len(p["aliases"]))
    total = sum(r["bytes"] for r in rows)
    named_alias = sum(1 for p in plan for a in p["aliases"] if a["path"])
    summary = {"images": len(rows), "total_bytes": total, "groups": len(plan),
               "files_removed": sum(len(p["aliases"]) for p in plan), "bytes_saved": saved,
               "percent_of_total": round(saved * 100 / total, 1), "gpu_bytes_saved_if_shared": saved_gpu,
               "aliases_with_known_path": named_alias, "saved_by_format": dict(by_kind),
               "images_after": len(rows) - sum(len(p["aliases"]) for p in plan)}
    json.dump({"summary": summary, "groups": plan}, open(f"{rep}/dedupe.json", "w"))
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    for p in plan[:8]:
        print(f"{len(p['aliases']) + 1}x {p['w']}x{p['h']} {p['bytes'] / 1e6:.2f}MB keep={p['keep_path'] or p['keep']}")


if __name__ == "__main__":
    main(sys.argv[1])
