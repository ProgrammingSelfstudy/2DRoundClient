// Field codec of the wire protocol, written to match internal/proto/codec.go of the server byte for byte:
// big-endian integers, string = 2-byte byte length + UTF-8 bytes, array = 2-byte count + elements, no padding, no trailing bytes.
import type { Field } from "./schema.ts";

export type Msg = { [name: string]: number | bigint | string | Msg[] };

const INT_SIZE: Record<string, number> = { int8: 1, uint8: 1, byte: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, uint64: 8 };
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export class DecodeError extends Error {}

class Reader {
  pos = 0;
  readonly b: Uint8Array;
  readonly view: DataView;
  constructor(b: Uint8Array) {
    this.b = b;
    this.view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  need(n: number) {
    if (this.pos + n > this.b.length) throw new DecodeError(`need ${n} bytes, have ${this.b.length - this.pos}`);
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  int(type: string): number | bigint {
    const n = INT_SIZE[type];
    if (!n) throw new DecodeError(`unknown type ${type}`);
    this.need(n);
    const p = this.pos;
    this.pos += n;
    switch (type) {
      case "int8": return this.view.getInt8(p);
      case "int16": return this.view.getInt16(p);
      case "int32": return this.view.getInt32(p);
      case "uint16": return this.view.getUint16(p);
      case "uint32": return this.view.getUint32(p);
      case "uint64": return this.view.getBigUint64(p);
      default: return this.view.getUint8(p);
    }
  }
}

function readFields(r: Reader, fields: readonly Field[]): Msg {
  const m: Msg = {};
  for (const [name, type, children] of fields) {
    if (type === "string") {
      const n = r.u16();
      r.need(n);
      m[name] = dec.decode(r.b.subarray(r.pos, r.pos + n));
      r.pos += n;
    } else if (type === "array") {
      const n = r.u16();
      const kids = children ?? [];
      if (kids.length > 0 && n > r.b.length - r.pos) throw new DecodeError(`array ${name} count ${n} exceeds payload`);
      const items: Msg[] = [];
      for (let i = 0; i < n; i++) items.push(readFields(r, kids));
      m[name] = items;
    } else {
      m[name] = r.int(type);
    }
  }
  return m;
}

export function decode(fields: readonly Field[], payload: Uint8Array): Msg {
  const r = new Reader(payload);
  const m = readFields(r, fields);
  if (r.pos !== payload.length) throw new DecodeError(`${payload.length - r.pos} trailing bytes`);
  return m;
}

class Writer {
  chunks: number[] = [];
  put(n: number, v: bigint | number) {
    let x = BigInt(v);
    if (x < 0n) x += 1n << BigInt(8 * n);
    for (let i = n - 1; i >= 0; i--) this.chunks.push(Number((x >> BigInt(8 * i)) & 0xffn));
  }
}

function writeFields(w: Writer, fields: readonly Field[], msg: Msg) {
  for (const [name, type, children] of fields) {
    const v = msg[name];
    if (type === "string") {
      const bytes = enc.encode(typeof v === "string" ? v : "");
      if (bytes.length > 0xffff) throw new Error(`field ${name}: string too long`);
      w.put(2, bytes.length);
      for (const b of bytes) w.chunks.push(b);
    } else if (type === "array") {
      const items = Array.isArray(v) ? (v as Msg[]) : [];
      if (items.length > 0xffff) throw new Error(`field ${name}: too many items`);
      w.put(2, items.length);
      for (const it of items) writeFields(w, children ?? [], it);
    } else {
      const n = INT_SIZE[type];
      if (!n) throw new Error(`field ${name}: unknown type ${type}`);
      w.put(n, typeof v === "number" || typeof v === "bigint" ? v : 0);
    }
  }
}

export function encode(fields: readonly Field[], msg: Msg): Uint8Array {
  const w = new Writer();
  writeFields(w, fields, msg);
  return Uint8Array.from(w.chunks);
}
