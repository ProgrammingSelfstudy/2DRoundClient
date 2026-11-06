// The main-city request list must be the one the real client sent, and every command in it must be encodable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAIN_CITY_REQUESTS } from "../src/city.ts";
import { send } from "../src/proto/schema.ts";

const FILE = join(process.env.CAPTURES ?? join(import.meta.dirname, "../../../2DRoundServer/testdata/captures"), "original-2026-10-26/login-main-city.jsonl");

test("every request has a send schema", () => {
  for (const [cmd] of MAIN_CITY_REQUESTS) assert.ok(send[cmd], `no schema for ${cmd}`);
});

test("the list equals the commands the real client sent after 10192", () => {
  const rows = readFileSync(FILE, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as { dir: string; cmd: number; msg?: unknown });
  const from = rows.findIndex(r => r.dir === "c2s" && r.cmd === 10192) + 1;
  const sent = rows.slice(from).filter(r => r.dir === "c2s" && r.cmd !== 1197).slice(0, MAIN_CITY_REQUESTS.length);
  assert.deepEqual(sent.map(r => r.cmd), MAIN_CITY_REQUESTS.map(([c]) => c));
  MAIN_CITY_REQUESTS.forEach(([cmd, msg], i) => { if (msg) assert.deepEqual(sent[i].msg, msg, `payload of ${cmd}`); });
});
