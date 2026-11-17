#!/usr/bin/env python3
"""Rebuild six original Spine actions into a reviewable, unpublished fragment.

    python3 pipeline/recover_skill_assets.py ../2DRoundAssets

Only <assets>/work/skill-repair is written. The source APK, source assets,
published releases and mini build remain untouched. The fragment manifest can
be merged into a new release together with its content-addressed f/ files.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import sys
import zipfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_release import main as build_release, SPINE_BASE
from skel_to_json import convert


TARGETS = (
    ("h_lvniu", "action1", "json", "167A7ABA3909365A", "5b946beebe864924319b0c56ded81b941b48f2775331f986313d73fc2b41f833"),
    ("E80027", "action", "skel", "8452E9B4CDD961D0", "0623a7215874dad1e1b54f8e2660e0afd7bf8892699187a69572e72e3e1e7a77"),
    ("E77002", "action", "json", "F8C474A90E6E9455", "21b3e1bbf1ed4cf3391b95ebfe78f6af588f32b6da4075d1a24baca5637151c4"),
    ("h_lufeidt", "show", "skel", "E46864B5157E7862", "855172b597433a9ff5fc3fa720be82dcdeba35a59c3bf1ca630fcb94868f4dbd"),
    ("h_suolongdt", "show", "skel", "E91657E89F4B2801", "558b799e0ea23916db316d5e0cbc12d6713d9f7cd33be475dd1807fc619a6a72"),
    ("h_nameidt", "show", "skel", "2E3F12763B9431D1", "cff36ab99a17b0e608eba609753fc0372b578f3b0517a711c7194042425f93fd"),
)
FOLLOWUP_TARGETS = (
    ("EX10001", "action", "skel", "BF1D1DCC1427E1F2", "39d70495964e73148bfd63c6a57f90d939d50680cc43aa5dd96afc8a27811ec6"),
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def payload(root, row):
    path = root / "f" / row["hash"][:2] / f"{row['hash']}.{row['ext']}"
    data = path.read_bytes()
    if len(data) != row["bytes"] or sha256(data)[:len(row["hash"])] != row["hash"]:
        raise ValueError(f"Content hash or byte count mismatch: {path}")
    return data


def atlas_inventory(text):
    pages, regions = [], set()
    for line in text.splitlines():
        if not line or line[0].isspace() or ":" in line:
            continue
        if line.lower().endswith((".png", ".jpg")):
            pages.append(line)
        else:
            regions.add(line)
    return pages, regions


def verify_skeleton(skeleton, regions):
    attachments, attachment_names = set(), {}
    for skin in skeleton["skins"].values():
        for slot, entries in skin.items():
            attachment_names.setdefault(slot, set()).update(entries)
            for name, value in entries.items():
                if value.get("type", "region") in ("region", "mesh", "linkedmesh"):
                    attachments.add(value.get("path") or value.get("name") or name)
    missing = attachments - regions
    if missing:
        raise ValueError(f"Skeleton regions absent from its original atlas: {sorted(missing)}")
    for name, animation in skeleton["animations"].items():
        for slot, timelines in animation.get("slots", {}).items():
            for frame in timelines.get("attachment", []):
                attachment = frame.get("name")
                if attachment is not None and attachment not in attachment_names.get(slot, set()):
                    raise ValueError(f"Undefined attachment {name}/{slot}/{attachment}")

    def finite(value):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Nonfinite skeleton number")
        if isinstance(value, dict):
            for child in value.values():
                finite(child)
        elif isinstance(value, list):
            for child in value:
                finite(child)
    finite(skeleton)
    return len(attachments)


def symlink_input(destination, source):
    if destination.is_symlink():
        if destination.resolve() != source.resolve():
            raise ValueError(f"Unexpected existing link: {destination}")
    elif destination.exists():
        raise ValueError(f"Refusing to replace existing input: {destination}")
    else:
        destination.symlink_to(source, target_is_directory=source.is_dir())


def changes(old, new, path=""):
    if type(old) is not type(new) and not isinstance(old, (int, float)):
        return [path]
    if isinstance(old, dict) and isinstance(new, dict):
        result = []
        for key in sorted(old.keys() | new.keys()):
            here = path + "/" + key
            result += [here] if key not in old or key not in new else changes(old[key], new[key], here)
        return result
    if isinstance(old, list) and isinstance(new, list):
        if len(old) != len(new):
            return [path]
        return [item for index, pair in enumerate(zip(old, new)) for item in changes(*pair, path + "/" + str(index))]
    return [] if old == new else [path]


def update_published_constraints(base_manifest, built, pkg, resource_hash, apk):
    """Stage only changed skeleton JSON already present in the base release.

    Their atlases/pages stay dependencies of the base release; the six recovered
    actions below include their own complete dependencies. No archived animation
    or unrelated previously unconverted model is republished by this function.
    """
    base = json.loads(base_manifest.read_text())
    files, updates = {}, []
    with zipfile.ZipFile(apk) as archive:
        for logical, row in base["files"].items():
            source = row.get("src", "")
            if not logical.startswith("spine/") or not logical.endswith(".json") or not source.endswith(".skel"):
                continue
            source_hash = resource_hash(source)
            source_file = pkg / source_hash[0] / (source_hash + ".skel")
            data = source_file.read_bytes()
            skeleton = convert(data)
            encoded = json.dumps(skeleton, separators=(",", ":")).encode()
            digest = sha256(encoded)[:20]
            if digest == row["hash"]:
                continue
            before = json.loads(payload(base_manifest.parent, row))
            changed = changes(before, skeleton)
            unexpected = [path for path in changed if not path.endswith(("/order", "/bendPositive"))]
            if unexpected:
                raise ValueError(f"Unrelated existing-skeleton changes at {logical}: {unexpected}")
            member = "assets/HASH/" + str(source_file.relative_to(pkg))
            if archive.read(member) != data:
                raise ValueError(f"Original APK/extracted source mismatch: {source}")
            base_path = logical.removesuffix(".json")
            atlas_logical = base_path + ".atlas"
            atlas = payload(base_manifest.parent, base["files"][atlas_logical]).decode()
            pages, regions = atlas_inventory(atlas)
            validation_issue = None
            try:
                verify_skeleton(skeleton, regions)
            except ValueError as exc:
                # Some existing actions already contain regions missing from their
                # own shipped atlas. Preserve and report that bounded defect;
                # constraint-only changes must not introduce a new one.
                try:
                    verify_skeleton(before, regions)
                except ValueError as previous:
                    if str(previous) != str(exc):
                        raise ValueError(f"New atlas validation error: {logical}") from exc
                    validation_issue = str(exc)
                else:
                    raise
            dependencies = [atlas_logical] + [base_path.rsplit("/", 1)[0] + "/" + page.rsplit(".", 1)[0] + ".webp" for page in pages]
            for dependency in dependencies:
                payload(base_manifest.parent, base["files"][dependency])
            entry = dict(row, hash=digest, bytes=len(encoded), sourceFormat="skel",
                         sourceSpine=skeleton["skeleton"]["spine"], sourceBytes=len(data), sourceSha256=sha256(data))
            destination = built / "f" / digest[:2] / (digest + ".json")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(encoded)
            files[logical] = entry
            updates.append({"logicalPath": logical, "sourcePath": source, "sourceSha256": sha256(data),
                            "previousHash": row["hash"], "hash": digest, "changedFields": changed,
                            "baseDependencies": dependencies, "preexistingAtlasIssue": validation_issue})
    return files, updates


def recover(assets, out, base_manifest, targets=TARGETS):
    original = (assets / "source/restored-source").resolve()
    pkg = original / "outputs/apk-extracted/assets/HASH"
    sys.path.insert(0, str(original / "outputs/recovery-tools"))
    from resource_hash import resource_hash

    # Check the selected inputs before rebuilding. These are exact original
    # virtual paths, not matching regions borrowed from another hero.
    sources = {}
    apk = original / "work/unpacked/航海冒险.apk"
    with zipfile.ZipFile(apk) as archive:
        for model, action, ext, expected_hash, expected_sha in targets:
            virtual = f"{SPINE_BASE}/{model}/{action}.{ext}"
            if resource_hash(virtual) != expected_hash:
                raise ValueError(f"Resource-name hash changed: {virtual}")
            file = pkg / expected_hash[0] / f"{expected_hash}.{ext}"
            data = file.read_bytes()
            member = "assets/HASH/" + str(file.relative_to(pkg))
            if sha256(data) != expected_sha or archive.read(member) != data:
                raise ValueError(f"Original APK/extracted source mismatch: {virtual}")
            sources[(model, action)] = {"virtualPath": virtual, "path": str(file),
                                        "apkMember": member, "sha256": expected_sha, "bytes": len(data)}

    # A tiny input tree is enough: build_release resolves model/action paths
    # directly. This also works when the broad resmap report is unavailable.
    inputs = out / "inputs"
    (inputs / "reports").mkdir(parents=True, exist_ok=True)
    symlink_input(inputs / "source", assets / "source")
    symlink_input(inputs / "reports/audit.json", assets / "reports/audit.json")
    (inputs / "reports/resmap.json").write_text('{"found":{},"why":{}}\n')
    groups = [("fx-" if model.startswith("E") else "hero-") + model for model, *_ in targets]
    built = out / "group-build"
    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        build_release(str(inputs), "skill-recovery", groups, out_dir=built)
    (out / "build.log").write_text(log.getvalue())
    manifest = json.loads((built / "manifest.web.json").read_text())

    selected, published_updates = update_published_constraints(base_manifest, built, pkg, resource_hash, apk)
    recovered = []
    for model, action, *_ in targets:
        kind = "fx" if model.startswith("E") else "hero"
        base = f"spine/{kind}/{model}/{action}"
        skeleton = json.loads(payload(built, manifest["files"][base + ".json"]))
        if action not in skeleton["animations"]:
            raise ValueError(f"Expected animation absent: {base}")
        atlas = payload(built, manifest["files"][base + ".atlas"]).decode()
        pages, regions = atlas_inventory(atlas)
        region_count = verify_skeleton(skeleton, regions)
        logical = [base + ".json", base + ".atlas"]
        logical += [base.rsplit("/", 1)[0] + "/" + page.rsplit(".", 1)[0] + ".webp" for page in pages]
        for name in logical:
            row = manifest["files"][name]
            payload(built, row)
            selected[name] = row
        recovered.append({"model": model, "action": action, "source": sources[(model, action)],
                          "spineVersion": skeleton["skeleton"]["spine"],
                          "bones": len(skeleton["bones"]), "transformConstraints": len(skeleton.get("transform", [])),
                          "regionsVerified": region_count, "pages": pages,
                          "events": skeleton["animations"][action].get("events", []), "files": logical,
                          "evidenceType": "original-package bytes and format-aware static validation"})

    fragment = out / "fragment"
    for row in selected.values():
        relative = Path("f") / row["hash"][:2] / f"{row['hash']}.{row['ext']}"
        destination = fragment / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(built / relative, destination)
    fragment_manifest = {"version": "skill-recovery", "platform": "web", "files": selected}
    (fragment / "manifest.web.json").write_text(json.dumps(fragment_manifest, ensure_ascii=False, indent=1) + "\n")

    absent_stands = []
    for model, action, *_ in targets:
        if action != "show":
            continue
        candidates = []
        for ext in ("skel", "json", "atlas", "png"):
            virtual = f"{SPINE_BASE}/{model}/stand2.{ext}"
            h = resource_hash(virtual)
            exists = (pkg / h[0] / f"{h}.{ext}").exists()
            candidates.append({"virtualPath": virtual, "resourceHash": h, "present": exists})
        absent_stands.append({"model": model, "candidates": candidates,
                             "resolution": "Restore its own show animation; the existing compendium preview already falls back to show."})
    report = {"evidenceType": "ordinary-file/package static analysis; no live original-client observation",
              "sourceApk": str(apk),
              "recordedApkSha256": json.loads((original / "outputs/inventory.json").read_text())["apk_sha256"],
              "apkMembersVerified": len(targets) + len(published_updates), "recovered": recovered,
              "baseManifest": str(base_manifest), "baseManifestSha256": sha256(base_manifest.read_bytes()),
              "updatedPublishedSkeletons": published_updates,
              "fragment": str(fragment), "files": len(selected), "bytes": sum(row["bytes"] for row in selected.values()),
              "eggheadStand2Search": absent_stands,
              "limitations": ["The original Lua's default-spine fallback is not proof that it selected the JSON-only actions at runtime.",
                              "The three Egghead stand2 files are absent at the exact original paths; show is a display pose, not a restored battle idle.",
                              "Seven other .skel files have unrecognized binary headers and remain outside these six targets."]}
    (out / "recovery-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--base-manifest", type=Path, help="Base release for additional IK/constraint corrections (default: build/dev55/manifest.web.json)")
    choices = {f"{row[0]}/{row[1]}": row for row in TARGETS + FOLLOWUP_TARGETS}
    parser.add_argument("--target", choices=choices, action="append", help="Select specific verified original actions; repeat for several")
    args = parser.parse_args()
    assets = args.assets.resolve()
    out = (args.out or assets / "work/skill-repair").resolve()
    if not out.is_relative_to(assets / "work"):
        parser.error("--out must remain under the assets work directory")
    out.mkdir(parents=True, exist_ok=True)
    base_manifest = (args.base_manifest or assets / "build/dev55/manifest.web.json").resolve()
    report = recover(assets, out, base_manifest, tuple(choices[name] for name in args.target) if args.target else TARGETS)
    print(f"Recovered {len(report['recovered'])} original actions and corrected {len(report['updatedPublishedSkeletons'])} published skeletons; {report['files']} files, {report['bytes']} bytes -> {report['fragment']}")
