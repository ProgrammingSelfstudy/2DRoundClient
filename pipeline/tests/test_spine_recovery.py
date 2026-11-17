"""Regression probes against the supplied APK's real Spine fixtures.

Run: python3 -m unittest discover -s pipeline/tests -p 'test_spine_recovery.py'
ROUND_ASSETS can point at another copy of the sibling 2DRoundAssets directory.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recover_skill_assets import TARGETS, FOLLOWUP_TARGETS, atlas_inventory, verify_skeleton
from build_release import group_of, SPINE_BASE
from skel_to_json import convert, convert_json

ASSETS = Path(os.environ.get("ROUND_ASSETS", Path(__file__).resolve().parents[2].parent / "2DRoundAssets"))
PKG = ASSETS / "source/restored-source/outputs/apk-extracted/assets/HASH"


@unittest.skipUnless(PKG.is_dir(), "Original APK fixtures are external; set ROUND_ASSETS")
class OriginalSpineRecovery(unittest.TestCase):
    def target(self, model):
        _, _, ext, filename, digest = next(row for row in TARGETS + FOLLOWUP_TARGETS if row[0] == model)
        data = (PKG / filename[0] / (filename + "." + ext)).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
        return data, convert(data) if ext == "skel" else convert_json(data)

    def test_spine_3307_preserves_original_effect_timing(self):
        data, effect = self.target("E80027")
        self.assertEqual(effect["skeleton"]["spine"], "3.3.07")
        self.assertEqual(len(effect["bones"]), 3)
        action = effect["animations"]["action"]
        self.assertEqual(action["events"], [{"time": 0.666667, "name": "HitEvent1"}])
        frames = action["slots"]["10000"]["attachment"]
        self.assertEqual(len(frames), 20)
        self.assertEqual(frames[-1], {"time": 1.2339, "name": None})
        with self.assertRaisesRegex(ValueError, "bytes left over"):
            convert(data + b"\0")

    def test_green_bull_json_retains_five_original_hits(self):
        _, skeleton = self.target("h_lvniu")
        events = skeleton["animations"]["action1"]["events"]
        self.assertEqual([e["time"] for e in events if e["name"] == "hit"], [0.1333, 0.4333, 0.7, 0.8666, 0.9])
        pages, regions = atlas_inventory((PKG / "0/0DD6A304790DEDF4.atlas").read_text())
        self.assertEqual(len(pages), 2)
        self.assertEqual(verify_skeleton(skeleton, regions), 59)

    def test_king_json_retains_six_frames(self):
        _, skeleton = self.target("E77002")
        frames = skeleton["animations"]["action"]["slots"]["k0060"]["attachment"]
        self.assertEqual([f["name"] for f in frames], ["k0060", "k0062", "k0064", "k0066", "k0068", "k0070", None])
        self.assertEqual(frames[-1]["time"], 0.4)

    def test_egghead_rigs_retain_all_constraint_bones(self):
        for model, bones, transforms in (("h_lufeidt", 88, 5), ("h_suolongdt", 65, 7), ("h_nameidt", 121, 7)):
            with self.subTest(model=model):
                _, skeleton = self.target(model)
                self.assertEqual(len(skeleton["bones"]), bones)
                self.assertEqual(len(skeleton["transform"]), transforms)
                self.assertEqual(list(skeleton["animations"]), ["show"])
                constraints = skeleton.get("ik", []) + skeleton["transform"]
                self.assertEqual(sorted(c["order"] for c in constraints), list(range(len(constraints))))
        _, zoro = self.target("h_suolongdt")
        self.assertEqual(zoro["transform"][-1]["bones"], ["sword1", "sword5", "sword3"])
        self.assertEqual([c["name"] for c in sorted(zoro["ik"], key=lambda c: c["order"])], ["3", "1", "4", "2"])
        self.assertEqual([c["bendPositive"] for c in zoro["ik"]], [False, True, False, True])

    def test_existing_ik_rig_keeps_negative_bend_and_both_constraints(self):
        data = (PKG / "0/000B154C27667AD2.skel").read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), "ada06d04cf076f871ddaf31c3cbbc5fc20eba5b0fb360e8c69dc1f26ba9e58fd")
        skeleton = convert(data)
        self.assertEqual([(c["name"], c["order"], c["bendPositive"]) for c in skeleton["ik"]],
                         [("bone_ik", 1, True), ("bone_ik1", 0, False)])

    def test_existing_unaffected_binary_stays_byte_identical(self):
        skeleton = convert((PKG / "0/0344071759822C10.skel").read_bytes())
        encoded = json.dumps(skeleton, ensure_ascii=False, separators=(",", ":")).encode()
        self.assertEqual(hashlib.sha256(encoded).hexdigest(), "97442931c2d83ff70ea70c27b301b5e4b76b157a1c13341a2520162507aa97be")

    def test_original_ex_effect_name_is_built_as_effect(self):
        _, skeleton = self.target("EX10001")
        self.assertEqual(group_of(f"{SPINE_BASE}/EX10001/action.skel"), "fx-EX10001")
        self.assertEqual(list(skeleton["animations"]), ["action"])
        _, regions = atlas_inventory((PKG / "9/9A2F5553DCDEABF4.atlas").read_text())
        self.assertEqual(verify_skeleton(skeleton, regions), 33)


if __name__ == "__main__":
    unittest.main()
