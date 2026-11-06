// WebSocket transport. The gateway puts the same byte stream as TCP inside binary messages, so frames are cut with FrameParser.
import { decode, encode, type Msg } from "./proto/codec.ts";
import { FrameParser, encodeFrame } from "./proto/frame.ts";
import { recv, send } from "./proto/schema.ts";

export interface Logged {
  t: number;
  dir: "c2s" | "s2c";
  cmd: number;
  size: number;
  msg: Msg | null;
  error?: string;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private parser = new FrameParser();
  onLog: (e: Logged) => void = () => {};
  onState: (s: string) => void = () => {};

  connect(url: string) {
    this.close();
    this.parser = new FrameParser();
    this.onState("connecting");
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => this.onState("open");
    ws.onclose = e => this.onState(`closed (${e.code})`);
    ws.onerror = () => this.onState("error");
    ws.onmessage = ev => {
      try {
        for (const f of this.parser.push(new Uint8Array(ev.data as ArrayBuffer))) {
          const fields = recv[f.cmd];
          let msg: Msg | null = null, error: string | undefined;
          if (!fields) error = "no schema for this command";
          else try { msg = decode(fields, f.payload); } catch (e) { error = (e as Error).message; }
          this.onLog({ t: Date.now(), dir: "s2c", cmd: f.cmd, size: f.payload.length, msg, error });
        }
      } catch (e) {
        this.onLog({ t: Date.now(), dir: "s2c", cmd: 0, size: 0, msg: null, error: (e as Error).message });
      }
    };
    this.ws = ws;
  }

  send(cmd: number, msg: Msg = {}) {
    const fields = send[cmd];
    if (!fields) throw new Error(`no send schema for ${cmd}`);
    const payload = encode(fields, msg);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("not connected");
    this.ws.send(encodeFrame(cmd, payload));
    this.onLog({ t: Date.now(), dir: "c2s", cmd, size: payload.length, msg });
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}
