// How a skill is played (mini/assets/scripts/skillplan.ts) against the real table of a built release: the rules are the original's, so the
// expected values below are read off the original's Lua (battle_act_data.lua, skill_data*.lua) and the original's moveTo / shakeScreen code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { attackOf, backTarget, effectInfo, fieldEffectPosition, hitEvent, hitShare, movePlan, moveTarget, previewCast, previewCasts, previewCell, previewOpening, previewZOrder, projectilePath, shakeSteps } from "../../mini/assets/scripts/skillplan.ts";
import type { Fx, MovePlan } from "../../mini/assets/scripts/skillplan.ts";

const ASSETS = process.env.ASSETS ?? join(import.meta.dirname, "../../../2DRoundAssets");
const versions = existsSync(join(ASSETS, "build")) ? readdirSync(join(ASSETS, "build")).filter(v => /^dev\d+$/.test(v)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))) : [];
const dir = versions.length ? join(ASSETS, "build", versions[versions.length - 1]) : "";
const have = dir !== "" && existsSync(join(dir, "manifest.web.json")) && "tables/skill_fx.json" in JSON.parse(readFileSync(join(dir, "manifest.web.json"), "utf8")).files;
const fx: Fx = have ? (() => {
  const f = JSON.parse(readFileSync(join(dir, "manifest.web.json"), "utf8")).files["tables/skill_fx.json"] as { hash: string };
  return JSON.parse(readFileSync(join(dir, "f", f.hash.slice(0, 2), `${f.hash}.json`), "utf8"));
})() : ({} as Fx);
const opts = { skip: have ? false : "no built release with tables/skill_fx.json" };

test("original scene, column and side effects use distinct coordinate rules", () => {
  assert.deepEqual(fieldEffectPosition(2, 1, 2, false, 90, -30, 720, 1280), [360, 640]);
  assert.deepEqual(fieldEffectPosition(2, -1, 2, false, 90, -30, 720, 1280), [360, 640]);
  assert.deepEqual(fieldEffectPosition(4, 1, 2, true, 30, -10, 720, 1280), [336, 358]);
  assert.deepEqual(fieldEffectPosition(4, -1, 3, true, 30, -10, 720, 1280), [426, 454]);
  assert.deepEqual(fieldEffectPosition(3, 1, 2, false, 30, -10, 720, 1280), [188.4, 310]);
  assert.deepEqual(fieldEffectPosition(4, -1, 2, false, 30, -10, 720, 1280), [128.4, 310]);
});

test("original flyItem launches at caster height and trims the endpoint, with mirrored facing", () => {
  const args = [0, 20, 0, "hurt", 50, 0, 0];
  const left = projectilePath([162, 336], [558, 336], 1, 120, 120, -130, 50, args);
  assert.deepEqual(left.from, [162, 396]);
  assert.deepEqual(left.to, [428, 396 - 10 * 130 / 396]);
  assert.equal(left.seconds, 20 / 60);
  assert.equal(left.delay, 0);
  const right = projectilePath([558, 336], [162, 336], -1, 120, 120, -130, 50, args);
  assert.deepEqual(right.from, [558, 396]);
  assert.deepEqual(right.to, [292, left.to[1]]);
  assert.equal(right.angle, -left.angle);
  const many = projectilePath([162, 336], [558, 336], 1, 120, 120, -95, 50, [0, 8, 0, "hurt", 70], true);
  assert.deepEqual(many.from, [162, 420]);
  assert.deepEqual(many.to, [463, 386]); // multi-target path uses y_fix pixels, not a height percentage
  assert.equal(many.seconds, 8 / 60);
});

test("preview builds visual-only casts with the original actor, ally and enemy targets", () => {
  const table: Fx = { t: [], e: {}, g: {}, s: {}, m: {}, y: { "41": 4, "42": 7, "43": 2 } };
  assert.deepEqual(previewOpening(table, 70501, 5, "索隆(和之国)", [[41, 42, 43, 44]]), {
    objects: [
      { object_type: 2, group: 1, pos: 5, object_bid: 70501, star: 5, object_name: "索隆(和之国)" },
      { object_type: 3, group: 2, pos: 14, object_bid: 101011, star: 1, object_name: "木桩" },
      { object_type: 3, group: 1, pos: 9, object_bid: 101011, star: 1, object_name: "友方木桩" },
    ],
  });
  assert.deepEqual(previewCast(table, 541314, [41, 42, 43, 44]), {
    order: 1, actor: 5, target: 5, skill_bid: 541314,
    effect_play: [
      { order: 1, actor: 5, target: 5, effect_bid: 41 },
      { order: 2, actor: 5, target: 9, effect_bid: 42 },
      { order: 3, actor: 5, target: 9, effect_bid: 43 },
      { order: 4, actor: 5, target: 14, effect_bid: 44 },
    ],
  });
});

test("preview uses the original numbered formation cells and drawing order", () => {
  assert.deepEqual(previewCell(5), [18, 21]);
  assert.deepEqual(previewCell(14), [62, 21]);
  assert.deepEqual(previewCell(9), [9, 27]);
  assert.deepEqual(previewCell(7), [7, 15]);
  assert.deepEqual(previewCell(18), [71, 27]);
  assert.deepEqual(previewCell(31), [15, 43]);
  assert.deepEqual(previewCell(32), [65, 43]);
  assert.deepEqual(previewCell(41), [11, 39]);
  assert.deepEqual(previewCell(42), [69, 39]);
  assert.equal(previewCell(0), undefined);
  assert.deepEqual([previewZOrder(5), previewZOrder(14), previewZOrder(9)], [996, 996, 991]);
  assert.deepEqual([previewZOrder(31), previewZOrder(42)], [990, 989]);
  assert.deepEqual([previewZOrder(5, true), previewZOrder(14, true), previewZOrder(9, true)], [998, 996, 998]);
  assert.deepEqual([previewZOrder(31, true), previewZOrder(42, true)], [990, 989]);
});

test("preview keeps successive action phases and attaches unnamed effects without guessing", () => {
  const table: Fx = {
    t: [["", "", 0, "no-hurt", 1], ["skill1", "action", 0, "hurt", 1], ["skill2", "action", 0, "hurt", 1], ["skill1", "action2", 0, "hurt", 1]],
    e: { "10": 0, "11": 1, "12": 1, "13": 2, "14": 3, "15": 2 }, g: {}, s: {}, m: {}, am: { "15": "none" },
  };
  const casts = previewCasts(table, 999101, [10, 11, 12, 10, 13, 10, 11, 14]);
  assert.deepEqual(casts.map(cast => (cast.effect_play as { effect_bid: number }[]).map(e => e.effect_bid)), [[10, 11, 12, 10], [13, 10], [11], [14]]);
  assert.deepEqual(casts.map(cast => cast.order), [1, 2, 3, 4]);
  assert.deepEqual(previewCasts(table, 999101, [10, 10]), [previewCast(table, 999101, [10, 10])]);
  assert.deepEqual(previewCasts(table, 999101, [11, 15, 12]), [previewCast(table, 999101, [11, 15, 12])]);
  assert.deepEqual(previewCasts(table, 999101, []), [previewCast(table, 999101, [])]);
});

test("distinct original damage effects replay the same animation in separate phases", () => {
  const combos = [
    [269101, [2691001, 2691101]],
    [275101, [2751001, 2751101, 2751201]],
    [554101, [5541001, 5541011, 5541111]],
  ] as const;
  const damage = combos.flatMap<number>(([, effects]) => effects);
  const table: Fx = {
    t: [["action1", "action1", 0, "hurt", 1], ["", "", 0, "no-hurt", 1]],
    e: { ...Object.fromEntries([...damage, 5501001, 7051001, 5501101, 7051011, 7051021].map(id => [id, 0])),
      5541201: 1, 5541131: 1 },
    g: {}, s: {}, m: {},
    am: { 5541201: "none", 5541131: "none" },
    d: [...damage, 5501001, 7051001],
  };
  const phases = (sid: number, effects: readonly number[]) => previewCasts(table, sid, [...effects])
    .map(cast => (cast.effect_play as { effect_bid: number }[]).map(effect => effect.effect_bid));
  for (const [sid, effects] of combos) {
    assert.deepEqual(phases(sid, effects), effects.map(effect => [effect]));
  }
  assert.deepEqual(phases(269101, [2691001, 2691101, 2691001]), [[2691001, 2691001], [2691101]]);
  assert.deepEqual(phases(554101, [5541001, 5541011, 5541111, 5541201, 5541131]),
    [[5541001], [5541011], [5541111, 5541201, 5541131]]);
  assert.deepEqual(phases(550101, [5501001, 5501101]), [[5501001, 5501101]]);
  assert.deepEqual(phases(705101, [7051001, 7051011, 7051021]), [[7051001, 7051011, 7051021]]);
});

test("original moveTo keeps column offsets in pixels and reverse offsets relative to the target base", () => {
  const p: MovePlan = { delay: 0, time: 0.2, x: -12, y: 2, area: false, col: false, reverse: false, backDelay: 0, backTime: 0.15, backX: 0 };
  const home: [number, number] = [18, 21], target: [number, number] = [62, 21];
  assert.deepEqual(moveTarget(p, 1, home, target, 2), [50, 23]);
  assert.deepEqual(moveTarget({ ...p, col: true, x: 45 }, 1, home, target, 2, 9), [39, 21]);
  assert.deepEqual(moveTarget({ ...p, col: true, x: 45 }, -1, target, home, 2, 9), [39, 21]);
  assert.deepEqual(moveTarget({ ...p, col: true, reverse: true, x: 45 }, -1, target, home, 2, 9), [49, 21]);
  assert.deepEqual(moveTarget({ ...p, reverse: true }, 1, home, target, 2, 9, [53, 15]), [65, 13]);
  assert.deepEqual(moveTarget({ ...p, reverse: true }, -1, target, home, 2, 9, [27, 15]), [15, 17]);
  assert.deepEqual(moveTarget({ ...p, area: true, reverse: true }, 1, home, target, 2), [28, 80 * 11 / 36 + 2]);
  assert.deepEqual(backTarget({ ...p, backX: -3 }, 1, home, target), [15, 21]);
  assert.deepEqual(backTarget({ ...p, backX: -3 }, -1, target, home), [65, 21]);
  assert.deepEqual(backTarget({ ...p, backX: 3 }, 1, home, target), [59, 21]);
});

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
  assert.deepEqual(moveTarget({ ...p, col: true, x: -4 }, -1, [42, 21], [27, 21], 2), [44 + 4 / 9, 21]);
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
