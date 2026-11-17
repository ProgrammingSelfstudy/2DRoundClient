#!/usr/bin/env python3
"""Create a new immutable release from a verified base, recovered assets and regenerated tables.

Usage: apply_release_overlay.py BASE FRAGMENT TABLES OUTPUT
The original release is never edited; existing content-addressed blobs are hard-linked.
"""
import hashlib
import json
import os
from pathlib import Path
import sys


def build(base, fragment, tables, output):
    assert not output.exists(), f"Release already exists: {output}"
    manifest = json.loads((base / "manifest.web.json").read_text())
    overlay = json.loads((fragment / "manifest.web.json").read_text())
    output.mkdir(parents=True)

    def install(source, entry):
        blob = source / "f" / entry["hash"][:2] / (entry["hash"] + "." + entry["ext"])
        data = blob.read_bytes()
        assert len(entry["hash"]) in (20, 64) and len(data) == entry["bytes"] and hashlib.sha256(data).hexdigest().startswith(entry["hash"]), blob
        dest = output / blob.relative_to(source)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            os.link(blob, dest)

    for entry in manifest["files"].values():
        install(base, entry)
    for logical, entry in overlay["files"].items():
        install(fragment, entry)
        manifest["files"][logical] = entry
    for path in sorted(tables.glob("*.json")):
        logical = "tables/" + path.name
        assert logical in manifest["files"], logical
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        dest = output / "f" / digest[:2] / (digest + ".json")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            dest.write_bytes(data)
        manifest["files"][logical] = {**manifest["files"][logical], "hash": digest, "bytes": len(data)}
    manifest["version"] = output.name
    body = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode()
    (output / "manifest.web.json").write_bytes(body)
    print(json.dumps({"version": output.name, "logicalFiles": len(manifest["files"]), "recoveredOrCorrectedFiles": len(overlay["files"]), "manifestHash": hashlib.sha256(body).hexdigest()}))


if __name__ == "__main__":
    build(*(Path(arg).resolve() for arg in sys.argv[1:5]))
