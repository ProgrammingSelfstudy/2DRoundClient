// Byte-for-byte check against the real captures: every recorded payload must decode with the generated tables, encode back to the same
// bytes, and (when the capture kept a readable msg) decode to the same values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { decode, encode, type Msg } from "../src/proto/codec.ts";
import { recv, send } from "../src/proto/schema.ts";
import { FrameParser, encodeFrame } from "../src/proto/frame.ts";

const ROOT = process.env.CAPTURES ?? join(import.meta.dirname, "../../../2DRoundServer/testdata/captures");
const hex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], h => parseInt(h, 16));
const plain = (v: unknown): unknown =>
  typeof v === "bigint" ? Number(v) : Array.isArray(v) ? v.map(plain) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;

function* records() {
  for (const d of readdirSync(ROOT)) {
    const dir = join(ROOT, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          yield { file: `${d}/${f}`, r: JSON.parse(line) as { dir: string; cmd: number; payload_hex?: string; msg?: unknown } };
        } catch {}
      }
    }
  }
}

test("captures round trip byte for byte", () => {
  const stat = { checked: 0, redacted: 0, noSchema: 0, valueDiff: 0, failed: 0 };
  const failures: string[] = [];
  const parser = new FrameParser();
  for (const { file, r } of records()) {
    if (r.dir !== "c2s" && r.dir !== "s2c") continue;
    const fields = (r.dir === "c2s" ? send : recv)[r.cmd];
    if (!fields) { stat.noSchema++; continue; }
    const payload = hex(r.payload_hex ?? "");
    if (payload.length === 0 && fields.length > 0) { stat.redacted++; continue; } // the capture dropped the payload
    try {
      const m: Msg = decode(fields, payload);
      const again = encode(fields, m);
      assert.deepEqual(Buffer.from(again), Buffer.from(payload));
      const frames = parser.push(encodeFrame(r.cmd, payload));
      assert.equal(frames.length, 1);
      assert.equal(frames[0].cmd, r.cmd);
      // key order differs (the capture was written by Go, which sorts keys), so compare as data, not as text
      if (r.msg && !JSON.stringify(r.msg).includes("REDACTED")) {
        try { assert.deepEqual(plain(m), r.msg); } catch {
          const a = plain(m) as Record<string, unknown>, b = r.msg as Record<string, unknown>;
          const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
          if (stat.valueDiff++ < 8) failures.push(`value differs ${file} cmd ${r.cmd} keys ${keys.join(",")}: mine ${JSON.stringify(a[keys[0]])?.slice(0, 80)} | file ${JSON.stringify(b[keys[0]])?.slice(0, 80)}`);
        }
      }
      stat.checked++;
    } catch (e) {
      stat.failed++;
      if (failures.length < 15) failures.push(`${file} ${r.dir} cmd ${r.cmd}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log(JSON.stringify(stat), failures.length ? "\n" + failures.join("\n") : "");
  assert.equal(stat.failed, 0);
  assert.ok(stat.checked > 1000, "too few records were checked");
});

test("frame parser cuts frames out of arbitrary chunks", () => {
  const a = encodeFrame(1169, new Uint8Array(0)), b = encodeFrame(10316, Uint8Array.of(1, 2, 3));
  const p = new FrameParser();
  const all = Uint8Array.from([...a, ...b]);
  const got = [];
  for (const byte of all) got.push(...p.push(Uint8Array.of(byte)));
  assert.deepEqual(got.map(f => f.cmd), [1169, 10316]);
  assert.deepEqual([...got[1].payload], [1, 2, 3]);
});
