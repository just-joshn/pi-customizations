// Minimal protobuf wire codec and Connect envelope framing for the agent.v1 messages the bridge uses.
// Field numbers come from the schema embedded in cursor-agent (scripts/extract-cursor-schema.mjs).
import { gunzipSync } from 'node:zlib';

/** A message is a list of [field number, value]; nested messages are Field[] themselves. */
export type Field = [number, FieldValue];
export type FieldValue = string | number | boolean | Uint8Array | Field[] | undefined;

function varint(n: number | bigint, out: number[]) {
  let v = BigInt(n);
  if (v < 0n) v += 1n << 64n;
  while (v > 0x7fn) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
}

export function encode(fields: Field[]): Uint8Array {
  const out: number[] = [];
  for (const [no, value] of fields) {
    if (value === undefined) continue;
    if (typeof value === 'number' || typeof value === 'boolean') {
      varint((no << 3) | 0, out);
      varint(typeof value === 'boolean' ? Number(value) : value, out);
      continue;
    }
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : encode(value);
    varint((no << 3) | 2, out);
    varint(bytes.length, out);
    for (const b of bytes) out.push(b);
  }
  return Uint8Array.from(out);
}

/** Doubles need wire type 1, which `encode` never infers; used only for google.protobuf.Value numbers. */
function double(no: number, n: number): Uint8Array {
  const buf = new Uint8Array(9);
  buf[0] = (no << 3) | 1;
  new DataView(buf.buffer).setFloat64(1, n, true);
  return buf;
}

export interface Decoded {
  varints: Map<number, bigint[]>;
  bytes: Map<number, Uint8Array[]>;
  fixed64: Map<number, Uint8Array[]>;
}

export function decode(buf: Uint8Array): Decoded {
  const d: Decoded = { varints: new Map(), bytes: new Map(), fixed64: new Map() };
  let pos = 0;
  const readVarint = () => {
    let shift = 0n;
    let result = 0n;
    for (;;) {
      const b = buf[pos++];
      if (b === undefined) throw new Error('truncated protobuf varint');
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
  };
  const push = <T>(map: Map<number, T[]>, no: number, v: T) => map.set(no, [...(map.get(no) ?? []), v]);
  while (pos < buf.length) {
    const tag = Number(readVarint());
    const no = tag >>> 3;
    switch (tag & 7) {
      case 0:
        push(d.varints, no, readVarint());
        break;
      case 1:
        if (pos + 8 > buf.length) throw new Error('truncated protobuf field');
        push(d.fixed64, no, buf.subarray(pos, pos + 8));
        pos += 8;
        break;
      case 2: {
        const len = Number(readVarint());
        if (pos + len > buf.length) throw new Error('truncated protobuf field');
        push(d.bytes, no, buf.subarray(pos, pos + len));
        pos += len;
        break;
      }
      case 5:
        if (pos + 4 > buf.length) throw new Error('truncated protobuf field');
        pos += 4;
        break;
      default:
        throw new Error(`unsupported protobuf wire type ${tag & 7}`);
    }
  }
  return d;
}

export const str = (d: Decoded, no: number) => {
  const b = d.bytes.get(no)?.[0];
  return b ? new TextDecoder().decode(b) : '';
};
export const msg = (d: Decoded, no: number) => {
  const b = d.bytes.get(no)?.[0];
  return b ? decode(b) : undefined;
};
export const num = (d: Decoded, no: number) => Number(d.varints.get(no)?.[0] ?? 0n);
export const raw = (d: Decoded, no: number) => d.bytes.get(no)?.[0];

// google.protobuf.Value, used for MCP tool schemas and arguments.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function encodeValue(v: Json): Uint8Array {
  if (v === null) return encode([[1, 0]]);
  if (typeof v === 'number') return double(2, v);
  if (typeof v === 'string') return encode([[3, v]]);
  if (typeof v === 'boolean') return encode([[4, v]]);
  if (Array.isArray(v)) return encode([[6, v.map((x): Field => [1, encodeValue(x)])]]);
  return encode([
    [
      5,
      Object.entries(v).map(
        ([k, x]): Field => [
          1,
          [
            [1, k],
            [2, encodeValue(x)],
          ],
        ],
      ),
    ],
  ]);
}

export function decodeValue(buf: Uint8Array): Json {
  const d = decode(buf);
  const f64 = d.fixed64.get(2)?.[0];
  if (f64) return new DataView(f64.buffer, f64.byteOffset, 8).getFloat64(0, true);
  if (d.bytes.has(3)) return str(d, 3);
  if (d.varints.has(4)) return num(d, 4) !== 0;
  const struct = raw(d, 5);
  if (struct) return decodeStruct(struct);
  const list = raw(d, 6);
  if (list) return (decode(list).bytes.get(1) ?? []).map(decodeValue);
  return null;
}

function decodeStruct(buf: Uint8Array): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  for (const entry of decode(buf).bytes.get(1) ?? []) {
    const e = decode(entry);
    const value = raw(e, 2);
    out[str(e, 1)] = value ? decodeValue(value) : null;
  }
  return out;
}

/** Decodes a protobuf map<string, google.protobuf.Value> field into a plain object. */
export function decodeValueMap(d: Decoded, no: number): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  for (const entry of d.bytes.get(no) ?? []) {
    const e = decode(entry);
    const value = raw(e, 2);
    out[str(e, 1)] = value ? decodeValue(value) : null;
  }
  return out;
}

// Connect streaming envelopes: 1 flag byte (bit 0 compressed, bit 1 end-stream) + 4-byte big-endian length.
export function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  new DataView(out.buffer).setUint32(1, payload.length);
  out.set(payload, 5);
  return out;
}

export type Envelope = { end: false; payload: Uint8Array } | { end: true; json: string };

export class EnvelopeReader {
  private buf = new Uint8Array(0);
  push(chunk: Uint8Array): Envelope[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    const out: Envelope[] = [];
    while (this.buf.length >= 5) {
      const flags = this.buf[0] ?? 0;
      const len = new DataView(this.buf.buffer, this.buf.byteOffset).getUint32(1);
      if (this.buf.length < 5 + len) break;
      let payload: Uint8Array = this.buf.slice(5, 5 + len);
      this.buf = this.buf.slice(5 + len);
      if (flags & 1) payload = gunzipSync(payload);
      out.push(flags & 2 ? { end: true, json: new TextDecoder().decode(payload) } : { end: false, payload });
    }
    return out;
  }
}
