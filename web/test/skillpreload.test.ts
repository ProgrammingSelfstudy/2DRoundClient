import { test } from "node:test";
import assert from "node:assert/strict";
import { armAnimationStart, prepareSelectedResources } from "../../mini/assets/scripts/skillpreload.ts";

test("cold loading before setAnimation cannot advance the new animation or its hit event", () => {
  const hitsAfterStart: number[] = [];
  for (const loadingMs of [0, 250, 350]) {
    let now = loadingMs, time = 0, hitAt = 0;
    const skeleton = {
      paused: false,
      updateAnimation(dt: number) {
        time += dt * 1.2;
        if (!hitAt && time >= 0.6) hitAt = now - loadingMs;
      },
    };
    armAnimationStart(skeleton, () => now);
    now += 10;
    // Creator's frame delta still contains the parsing done before the animation began.
    skeleton.updateAnimation((loadingMs + 10) / 1000);
    assert.ok(Math.abs(time - 0.012) < 1e-9);
    while (!hitAt) {
      now += 10;
      skeleton.updateAnimation(0.01);
    }
    hitsAfterStart.push(hitAt);
  }
  assert.deepEqual(hitsAfterStart, [500, 500, 500]);
});

test("only the first active update is corrected; pauses and later stalls keep engine semantics", () => {
  let now = 1000;
  const deltas: number[] = [];
  const skeleton = { paused: true, updateAnimation(dt: number) { if (!this.paused) deltas.push(dt); } };
  armAnimationStart(skeleton, () => now);
  now += 5;
  skeleton.updateAnimation(0.35);
  skeleton.paused = false;
  now += 5;
  skeleton.updateAnimation(0.35);
  now += 400;
  skeleton.updateAnimation(0.4);
  assert.deepEqual(deltas, [0.01, 0.4]);

  // A replay on the same cached skeleton gets a new start; a normal frame is never enlarged.
  armAnimationStart(skeleton, () => now);
  now += 40;
  skeleton.updateAnimation(0.016);
  assert.equal(deltas.at(-1), 0.016);
});

test("an event that restarts the same skeleton keeps the new first-frame guard", () => {
  let now = 1000, restarted = false;
  const deltas: number[] = [];
  const skeleton = {
    paused: false,
    updateAnimation(dt: number) {
      deltas.push(dt);
      if (!restarted) { restarted = true; armAnimationStart(skeleton, () => now); }
    },
  };
  armAnimationStart(skeleton, () => now);
  now += 10;
  skeleton.updateAnimation(0.35);
  now += 10;
  skeleton.updateAnimation(0.35);
  assert.deepEqual(deltas, [0.01, 0.01]);
});

test("selected resources are deduplicated, loaded two at a time and yield between batches", async () => {
  let active = 0, maximum = 0, frames = 0;
  const loaded: string[] = [], prepared: string[] = [];
  await prepareSelectedResources(["action2", "fx1", "fx1", "hurt", "fx2", "fx3"], async base => {
    loaded.push(base);
    maximum = Math.max(maximum, ++active);
    await Promise.resolve();
    active--;
    return base;
  }, base => { prepared.push(base); }, async () => { frames++; });
  assert.deepEqual(loaded, ["action2", "fx1", "hurt", "fx2", "fx3"]);
  assert.deepEqual(prepared, loaded);
  assert.equal(maximum, 2);
  assert.equal(frames, 3);
});

test("closing the preview stops new loads and does not prepare results from the old cast", async () => {
  let current = true;
  const loaded: string[] = [], prepared: string[] = [];
  const releases: (() => void)[] = [];
  const pending = prepareSelectedResources(["action2", "fx1", "hurt", "fx2"], async base => {
    loaded.push(base);
    await new Promise<void>(resolve => { releases.push(resolve); });
    return base;
  }, base => { prepared.push(base); }, async () => {}, () => current);
  current = false;
  releases.forEach(release => release());
  await pending;
  assert.deepEqual(loaded, ["action2", "fx1"]);
  assert.deepEqual(prepared, []);
});
