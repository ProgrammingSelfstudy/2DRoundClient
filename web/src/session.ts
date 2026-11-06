// A logged-in-or-not game session on top of GameSocket: it signs commands the way the client does (gamenet.lua SendPrev) and turns
// "send a command, wait for the answer" into a promise. The signature is only logged by the server, but we send the real one.
import { md5 } from "./md5.ts";
import { GameSocket } from "./net.ts";
import type { Msg } from "./proto/codec.ts";

export const SIGN_KEY = "__sszg666__";

// commands the client sends without a 1197 in front of them
export function signExempt(cmd: number): boolean {
  if (cmd === 10300 || (cmd >= 16601 && cmd <= 16603)) return true;
  const g = Math.floor(cmd / 100);
  return g === 111 || g === 200;
}
export const expectedSign = (idx: number, time: number, cmd: number) => md5(`${idx}${time}${cmd}${SIGN_KEY}`);
export const expectedCode = (cmd: number, idx: number) => cmd + ((idx + 5) % 16);

export class Session {
  readonly sock: GameSocket;
  private idx = 0;
  private waiters = new Map<number, (m: Msg | null) => void>();

  constructor(sock: GameSocket) {
    this.sock = sock;
    sock.onFrame = (cmd, msg) => {
      const w = this.waiters.get(cmd);
      if (w) {
        this.waiters.delete(cmd);
        w(msg);
      }
    };
  }

  // connect and wait until the socket is open; the UI's own state listener keeps working
  open(url: string, timeoutMs = 6000): Promise<void> {
    return new Promise((resolve, reject) => {
      const prev = this.sock.onState;
      const done = (err?: Error) => {
        clearTimeout(timer);
        this.sock.onState = prev;
        err ? reject(err) : resolve();
      };
      const timer = setTimeout(() => done(new Error("connect timed out")), timeoutMs);
      this.sock.onState = st => {
        prev(st);
        if (st === "open") done();
        else if (st.startsWith("closed") || st === "error") done(new Error(`connection failed (${st})`));
      };
      this.reset();
      this.sock.connect(url);
    });
  }

  reset() {
    this.idx = 0;
    this.waiters.clear();
  }

  // send a command, preceded by its 1197 unless it is exempt
  send(cmd: number, msg: Msg = {}) {
    if (!signExempt(cmd)) {
      this.idx++;
      const time = Math.floor(Date.now() / 1000);
      this.sock.send(1197, { code: expectedCode(cmd, this.idx), idx: this.idx, sign: expectedSign(this.idx, time, cmd), time });
    }
    this.sock.send(cmd, msg);
  }

  // send and wait for the next frame with command `reply`
  request(cmd: number, msg: Msg, reply: number, timeoutMs = 8000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(reply);
        reject(new Error(`no answer ${reply} to ${cmd} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.set(reply, m => {
        clearTimeout(timer);
        m ? resolve(m) : reject(new Error(`answer ${reply} could not be decoded`));
      });
      try {
        this.send(cmd, msg);
      } catch (e) {
        clearTimeout(timer);
        this.waiters.delete(reply);
        reject(e);
      }
    });
  }

  // wait for a server push without sending anything
  waitFor(cmd: number, timeoutMs = 8000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${cmd} within ${timeoutMs} ms`)), timeoutMs);
      this.waiters.set(cmd, m => {
        clearTimeout(timer);
        m ? resolve(m) : reject(new Error(`push ${cmd} could not be decoded`));
      });
    });
  }
}
