// Session: two requests waiting for the same answer each get their own frame, and a listener can be taken off again.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameSocket } from "../src/net.ts";
import type { Msg } from "../src/proto/codec.ts";
import { Session } from "../src/session.ts";

function fake() {
  const sent: number[] = [];
  const sock = { onFrame: (_c: number, _m: Msg | null) => {}, onState: (_s: string) => {}, send: (cmd: number) => { sent.push(cmd); } };
  return { sock, sent, session: new Session(sock as unknown as GameSocket) };
}

test("two requests for the same answer are served in the order they were sent", async () => {
  const { sock, session } = fake();
  const a = session.request(11063, { partner_id: 1 }, 11063);
  const b = session.request(11063, { partner_id: 2 }, 11063);
  sock.onFrame(11063, { partner_id: 1 });
  sock.onFrame(11063, { partner_id: 2 });
  assert.equal((await a).partner_id, 1);
  assert.equal((await b).partner_id, 2);
});

test("a request that timed out does not take the frame of a later one", async () => {
  const { sock, session } = fake();
  await assert.rejects(session.request(11025, {}, 11025, 10));
  const later = session.request(11025, {}, 11025);
  sock.onFrame(11025, { num: 7 });
  assert.equal((await later).num, 7);
});

test("on() returns a function that stops the calls", () => {
  const { sock, session } = fake();
  let calls = 0;
  const off = session.on(10302, () => { calls++; });
  sock.onFrame(10302, { coin: 1 });
  off();
  sock.onFrame(10302, { coin: 2 });
  assert.equal(calls, 1);
});
