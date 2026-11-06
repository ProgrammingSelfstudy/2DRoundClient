// The shared TypeScript is also compiled by Cocos Creator, which down-levels it. Spreading an iterator ([...map.entries()],
// [...set]) breaks there (found by screenshot: it produced undefined), so the shared files must not do it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHARED = ["proto/codec.ts", "proto/frame.ts", "md5.ts", "net.ts", "session.ts", "login.ts", "city.ts"];

test("shared files do not spread iterators", () => {
  const bad: string[] = [];
  for (const f of SHARED) {
    readFileSync(join(import.meta.dirname, "../src", f), "utf8").split("\n").forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      if (/\[\s*\.\.\.[^\]]*\.(entries|keys|values)\(\)/.test(line) || /\[\s*\.\.\.new\s+(Set|Map)/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});
