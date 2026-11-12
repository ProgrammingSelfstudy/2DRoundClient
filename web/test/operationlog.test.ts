import assert from "node:assert/strict";
import { test } from "node:test";
import { H5_OPERATION_LOG_PREFIX, OperationLog } from "../../mini/assets/scripts/operationlog.ts";

test("feedback captures only the latest 32 actions with a bounded attachment", () => {
  const log = new OperationLog("0.1");
  log.setRelease("dev54");
  for (let id = 1; id <= 40; id++) log.record("skillPlayed", id);
  const snapshot = log.snapshot();
  const lines = snapshot.split("\n");

  assert.equal(lines.length, 33);
  assert.equal(lines[0], "H5 0.1 · 资源 dev54 · UTC");
  assert.match(lines[1], /技能播放完成 #9$/);
  assert.match(lines.at(-1)!, /技能播放完成 #40$/);
  assert.ok(Buffer.byteLength(H5_OPERATION_LOG_PREFIX + snapshot) <= 4096);
});

test("feedback does not embed arbitrary action detail or invalid resource version", () => {
  const log = new OperationLog("0.1");
  log.setRelease("dev54");
  log.setRelease("dev54\npassword=secret");
  log.record("login", "token=secret" as unknown as number);

  const snapshot = log.snapshot();
  assert.match(snapshot, /资源 dev54/);
  assert.match(snapshot, /点击登录$/);
  assert.doesNotMatch(snapshot, /secret/);
});
