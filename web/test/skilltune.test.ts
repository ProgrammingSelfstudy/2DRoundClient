// The hand corrections of skill playing (mini/assets/scripts/skilltune.ts): absent means the original's value, a save keeps only what differs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { animKey, applyMove, fxOf, pruned, setTune, speedOf, tune } from "../../mini/assets/scripts/skilltune.ts";
import type { MovePlan } from "../../mini/assets/scripts/skillplan.ts";

const plan: MovePlan = { delay: 0.1, time: 0.3, x: 5, y: 0, area: false, col: false, reverse: false, backDelay: 0.2, backTime: 0.3, backX: -4 };

test("no correction leaves the original's values", () => {
  setTune(null);
  assert.equal(speedOf("H1", "action1"), 1);
  assert.equal(applyMove(plan, "H1", "action1"), plan);
  assert.deepEqual(fxOf(70106), { dx: 0, dy: 0, scale: 1, delay: 0 });
});

test("a correction replaces only the fields it names, for that model and animation", () => {
  setTune({ anim: { "H1/action1": { speed: 0.8 } }, move: { "H1/action1": { time: 0.5, backX: -9 } }, fx: { "70106": { dx: 12, scale: 1.5, delay: 0.2 } } });
  assert.equal(speedOf("H1", "action1"), 0.8);
  assert.equal(speedOf("H1", "action2"), 1);
  assert.deepEqual(applyMove(plan, "H1", "action1"), { ...plan, time: 0.5, backX: -9 });
  assert.equal(applyMove(plan, "H2", "action1"), plan);
  assert.deepEqual(fxOf(70106), { dx: 12, dy: 0, scale: 1.5, delay: 0.2 });
  assert.equal(fxOf("70107").scale, 1);
});

test("a nonsense speed or scale falls back to the original", () => {
  setTune({ anim: { "H1/a": { speed: 0 } }, move: {}, fx: { "1": { scale: -2 } } });
  assert.equal(speedOf("H1", "a"), 1);
  assert.equal(fxOf(1).scale, 1);
});

test("a save drops what equals the original", () => {
  setTune({ anim: { [animKey("H1", "a")]: { speed: 1 } }, move: { "H1/a": { time: 0.3, x: 7 } }, fx: { "5": { dx: 0, dy: 3, scale: 1, delay: 0 }, "6": { dx: 0 } } });
  assert.deepEqual(pruned(tune(), { move: { "H1/a": plan } }), { anim: {}, move: { "H1/a": { x: 7 } }, fx: { "5": { dy: 3 } } });
});
