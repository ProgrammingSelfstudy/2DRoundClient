// How a skill is played (mini/assets/scripts/skillplan.ts) against the real table of a built release: the rules are the original's, so the
// expected values below are read off the original's Lua (battle_act_data.lua, skill_data*.lua) and the original's moveTo / shakeScreen code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { attackOf, backTarget, effectInfo, hitEvent, hitShare, movePlan, moveTarget, shakeSteps } from "../../mini/assets/scripts/skillplan.ts";
import type { Fx } from "../../mini/assets/scripts/skillplan.ts";

const ASSETS = process.env.ASSETS ?? join(import.meta.dirname, "../../../2DRoundAssets");
const versions = existsSync(join(ASSETS, "build")) ? readdirSync(join(ASSETS, "build")).filter(v => /^dev\d+$/.test(v)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))) : [];
const dir = versions.length ? join(ASSETS, "build", versions[versions.length - 1]) : "";
const have = dir !== "" && existsSync(join(dir, "manifest.web.json")) && "tables/skill_fx.json" in JSON.parse(readFileSync(join(dir, "manifest.web.json"), "utf8")).files;
const fx: Fx = have ? (() => {
  const f = JSON.parse(readFileSync(join(dir, "manifest.web.json"), "utf8")).files["tables/skill_fx.json"] as { hash: string };
  return JSON.parse(readFileSync(join(dir, "f", f.hash.slice(0, 2), `${f.hash}.json`), "utf8"));
})() : ({} as Fx);
const opts = { skip: have ? false : "no built release with tables/skill_fx.json" };

test("an effect row says its animation, its shake and whether the target is hurt", opts, () => {
  assert.deepEqual(effectInfo(fx, 2513001), { anim: "action2", animeRes: "action1", shakeId: 13, noHurt: false, splitHurt: 1 });
  assert.equal(effectInfo(fx, 2001001)?.splitHurt, 3); // the first hero's second skill: its damage is split into three hits
  assert.equal(effectInfo(fx, 5221002)?.noHurt, true); // a heal
  assert.equal(effectInfo(fx, 1), null);
});

test("the attacker plays the animation of the first effect that names one, else of its group", opts, () => {
  assert.equal(attackOf(fx, 251301, [2513001]).anim, "action2"); // skill 251301 -> effect 2513001 (the server's skillEffect), group 25130
  assert.equal(attackOf(fx, 522102, [5221002]).anim, fx.g["52210"] ?? "action2"); // a heal row names none: its group's
  assert.equal(attackOf(fx, 150301, []).anim, fx.g["15030"] ?? "action5"); // no effect sent: the group, else the number's guess
});

test("a model's run comes from its row, falling back to action1 and the default row (12 frames out, -12 cells, 8 back)", opts, () => {
  const d = movePlan(fx, "H_nobody", "action1", "action1");
  assert.deepEqual([d.time, d.x, d.backTime], [12 / 60, -12, 8 / 60]);
  assert.equal(movePlan(fx, "H30002", "action1", "action1").x, -16);
  assert.equal(movePlan(fx, "H30009", "action2", "action2").x, -13);
  assert.equal(movePlan(fx, "H30009", "action9", "action9").x, -12); // no such anime_res: the default row
});

test("a run stops short of the target on its own side, forward of home when positive, in the middle for an area move", opts, () => {
  const p = movePlan(fx, "H30002", "action1", "action1"); // x -16
  assert.deepEqual(moveTarget(p, 1, [27, 15], [42, 15], 1), [42 - 16, 15]); // the first group runs from the left
  assert.deepEqual(moveTarget(p, -1, [42, 15], [27, 15], 1), [27 + 16, 15]); // the second group from the right
  assert.deepEqual(backTarget(p, 1, [27, 15], [42, 15]), [27, 15]); // back_model_x 0: home
  assert.deepEqual(moveTarget({ ...p, x: 5, y: 2 }, 1, [27, 15], [42, 15], 1), [32, 17]);
  assert.deepEqual(moveTarget({ ...p, area: true, x: -3, y: 0 }, 1, [27, 15], [42, 15], 1), [37, 80 * 11 / 36]);
  assert.deepEqual(moveTarget({ ...p, col: true, x: -4 }, -1, [42, 21], [27, 21], 2), [44 + 4, 21]);
});

test("a shake steps eight directions a round, 3 weaker each round, as the original's shakeScreen", opts, () => {
  const steps = shakeSteps(fx, 13); // strength 30, 3 rounds, 8 ms
  assert.equal(steps.length, 24);
  assert.deepEqual(steps[0], { x: 30 * 0.25 * -0.7, y: -30 * 0.25 * 0.7, wait: 0.008 });
  assert.equal(steps[8].y, -27 * 0.25 * 0.7);
  assert.equal(steps[23].wait, 0.008);
  assert.deepEqual(shakeSteps(fx, 0), []);
});

test("the damage lands on hit, else on a hit_big / hit_none, else on attack (the area skills); an animation with none lands at its end", () => {
  assert.equal(hitEvent(["move", "attack", "Hit", "back"]), "hit");
  assert.equal(hitEvent(["attack", "back", "move", "shake_point"]), "attack"); // 29 of the release's attack animations have no hit
  assert.equal(hitEvent(["attack", "hit_big"]), "hit_big");
  assert.equal(hitEvent(["ready", "back"]), null);
  assert.equal(hitEvent([]), null);
});

test("a split effect shows ceil(loss / parts) at each hit, as the original's playMagic", opts, () => {
  assert.equal(hitShare(-100, 3), -33); // math.ceil toward zero for a loss: 33, 33, 33 (the server's hit points settle the last 1)
  assert.equal(hitShare(-100, 1), -100);
  assert.equal(hitShare(-1000, 5), -200);
  assert.equal(hitShare(90, 4), 23); // a heal rounds up the same way
  const rows = fx.t.filter(r => r[4] > 1).length;
  assert.ok(rows >= 30, `${rows} split effect rows`); // 37 in the table
});
