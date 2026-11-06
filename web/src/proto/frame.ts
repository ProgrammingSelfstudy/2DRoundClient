// Frame: flags (1) | body length (3, big endian, = 2 + payload) | command (2, big endian) | payload. Matches internal/proto/frame.go.
export const HANDSHAKE = "game_client------------";
export const HEADER_SIZE = 6;
export const MAX_PAYLOAD = 0x7ffe;

export interface Frame {
  flags: number;
  cmd: number;
  payload: Uint8Array;
}

export function encodeFrame(cmd: number, payload: Uint8Array, flags = 0): Uint8Array {
  if (payload.length > MAX_PAYLOAD) throw new Error(`payload ${payload.length} exceeds limit`);
  const n = payload.length + 2;
  const out = new Uint8Array(HEADER_SIZE + payload.length);
  out.set([flags, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, (cmd >> 8) & 0xff, cmd & 0xff]);
  out.set(payload, HEADER_SIZE);
  return out;
}

// A WebSocket message may hold half a frame or several, so frames are cut from a growing buffer.
export class FrameParser {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Frame[] {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    this.buf = joined;
    const out: Frame[] = [];
    while (this.buf.length >= HEADER_SIZE) {
      const body = (this.buf[1] << 16) | (this.buf[2] << 8) | this.buf[3];
      if (body < 2 || body - 2 > MAX_PAYLOAD) throw new Error(`bad frame: body length ${body}`);
      if (this.buf.length < HEADER_SIZE + body - 2) break;
      out.push({ flags: this.buf[0], cmd: (this.buf[4] << 8) | this.buf[5], payload: this.buf.slice(HEADER_SIZE, HEADER_SIZE + body - 2) });
      this.buf = this.buf.subarray(HEADER_SIZE + body - 2);
    }
    return out;
  }
}
