// The 1197 signature and code rules must reproduce what the real client sent in the captures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { md5 } from "../src/md5.ts";
import { expectedCode, expectedSign, signExempt } from "../src/session.ts";

const ROOT = process.env.CAPTURES ?? join(import.meta.dirname, "../../../2DRoundServer/testdata/captures");

test("md5 matches the RFC 1321 vectors", () => {
  assert.equal(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(md5("message digest"), "f96b697d7cb7938d525a2f31aaf161d0");
  assert.equal(md5("12345678901234567890123456789012345678901234567890123456789012345678901234567890"), "57edf4a22be3c955ac49da2e2107b67a");
  assert.equal(md5("你好"), "7eca689f0d3389d9dea66ae112e5cfd7");
});

test("signatures and codes match the captured 1197 frames", () => {
  let pairs = 0, ok = 0, exemptSigned = 0;
  const bad: string[] = [];
  for (const d of readdirSync(ROOT)) {
    const dir = join(ROOT, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      let pending: { code: number; idx: number; sign: string; time: number } | null = null;
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        let r: { dir: string; cmd: number; msg?: any };
        try { r = JSON.parse(line); } catch { continue; }
        if (r.dir !== "c2s") continue;
        if (r.cmd === 1197) { pending = r.msg; continue; }
        if (!pending || !pending.sign) continue;
        if (signExempt(r.cmd)) exemptSigned++;
        pairs++;
        if (pending.sign === expectedSign(pending.idx, pending.time, r.cmd) && pending.code === expectedCode(r.cmd, pending.idx)) ok++;
        else if (bad.length < 5) bad.push(`${d}/${f} cmd ${r.cmd} idx ${pending.idx}`);
        pending = null;
      }
    }
  }
  console.log(JSON.stringify({ pairs, ok, exemptSigned }), bad.join("; "));
  assert.ok(pairs > 500, "too few signed commands found");
  assert.equal(ok, pairs, "some signatures do not match");
});
