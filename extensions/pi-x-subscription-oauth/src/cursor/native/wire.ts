import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const CURSOR_CLIENT_VERSION = 'cli-2026.11.05-86047df';
const ASK_MODE = 2;

function varint(value: number | bigint): Buffer {
  let rest = BigInt(value);
  const bytes: number[] = [];
  while (rest > 127n) {
    bytes.push(Number((rest & 127n) | 128n));
    rest >>= 7n;
  }
  bytes.push(Number(rest));
  return Buffer.from(bytes);
}

function tag(field: number, wire: number): Buffer {
  return varint((BigInt(field) << 3n) | BigInt(wire));
}

function delimited(field: number, payload: Buffer): Buffer {
  return Buffer.concat([tag(field, 2), varint(payload.length), payload]);
}

function textField(field: number, value: string): Buffer {
  return delimited(field, Buffer.from(value));
}

function varintField(field: number, value: number): Buffer {
  return Buffer.concat([tag(field, 0), varint(value)]);
}

export function envelope(payload: Buffer, flags = 0): Buffer {
  const out = Buffer.alloc(5 + payload.length);
  out[0] = flags;
  out.writeUInt32BE(payload.length, 1);
  payload.copy(out, 5);
  return out;
}

export type RunInput = {
  readonly prompt: string;
  readonly modelId: string;
  readonly conversationId?: string;
  readonly runId?: string;
  readonly messageId?: string;
};

export function encodeRunFrame(input: RunInput): Buffer {
  const user = Buffer.concat([textField(1, input.prompt), textField(2, input.messageId ?? randomUUID()), delimited(3, Buffer.alloc(0)), varintField(4, ASK_MODE)]);
  const requested = Buffer.concat([textField(1, input.modelId), delimited(3, Buffer.concat([textField(1, 'fast'), textField(2, 'false')]))]);
  const run = Buffer.concat([
    delimited(1, Buffer.alloc(0)),
    delimited(2, delimited(1, delimited(1, user))),
    textField(5, input.conversationId ?? randomUUID()),
    delimited(9, requested),
    varintField(12, 0),
    textField(25, input.runId ?? randomUUID()),
  ]);
  return envelope(delimited(1, run));
}

export function encodeContextFrame(): Buffer {
  return envelope(delimited(2, delimited(10, delimited(1, delimited(1, Buffer.alloc(0))))));
}

export function encodeContextRequestFrame(): Buffer {
  return envelope(delimited(2, delimited(10, Buffer.alloc(0))));
}

export function encodeTextFrame(text: string): Buffer {
  return envelope(delimited(1, delimited(1, textField(1, text))));
}

export function encodeTurnEndFrame(): Buffer {
  return envelope(delimited(1, delimited(14, Buffer.alloc(0))));
}

export function encodeErrorFrame(message: string): Buffer {
  return envelope(Buffer.from(JSON.stringify({ error: { code: 'resource_exhausted', message } })), 2);
}

export type ServerNotice = { readonly type: 'text'; readonly text: string } | { readonly type: 'context' } | { readonly type: 'turn_end' } | { readonly type: 'error'; readonly message: string };

type Field = { readonly field: number; readonly buf?: Buffer };

function readVarint(buf: Buffer, offset: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buf.length && shift <= 63n) {
    const byte = buf[cursor] ?? 0;
    cursor += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value, cursor];
    shift += 7n;
  }
  return [value, buf.length];
}

function readFields(buf: Buffer): Field[] {
  const fields: Field[] = [];
  let cursor = 0;
  while (cursor < buf.length) {
    const [key, next] = readVarint(buf, cursor);
    if (next <= cursor) break;
    cursor = next;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      const [, after] = readVarint(buf, cursor);
      cursor = after;
      fields.push({ field });
    } else if (wire === 2) {
      const [length, after] = readVarint(buf, cursor);
      cursor = after;
      const size = Number(length);
      if (!Number.isFinite(size) || size < 0 || cursor + size > buf.length) break;
      fields.push({ field, buf: buf.subarray(cursor, cursor + size) });
      cursor += size;
    } else if (wire === 1) cursor += 8;
    else if (wire === 5) cursor += 4;
    else break;
  }
  return fields;
}

function framePayload(frame: Buffer): { readonly flags: number; readonly payload: Buffer } | undefined {
  if (frame.length < 5) return undefined;
  const flags = frame[0] ?? 0;
  const length = frame.readUInt32BE(1);
  if (frame.length < 5 + length) return undefined;
  let payload: Buffer = frame.subarray(5, 5 + length);
  if ((flags & 1) === 1) {
    try {
      payload = gunzipSync(payload);
    } catch {
      return undefined;
    }
  }
  return { flags, payload };
}

export function decodeFrame(frame: Buffer): ServerNotice[] {
  const parsed = framePayload(frame);
  if (!parsed) return [];
  if ((parsed.flags & 2) === 2) {
    const raw = parsed.payload.toString('utf8').trim();
    if (raw.length === 0) return [];
    try {
      const body = JSON.parse(raw) as { error?: { message?: unknown } };
      if (typeof body.error?.message === 'string' && body.error.message.length > 0) return [{ type: 'error', message: body.error.message }];
    } catch {
      return [{ type: 'error', message: raw }];
    }
    return [];
  }
  const notices: ServerNotice[] = [];
  for (const top of readFields(parsed.payload)) {
    if (top.field === 2 && top.buf && readFields(top.buf).some((field) => field.field === 10)) notices.push({ type: 'context' });
    if (top.field !== 1 || !top.buf) continue;
    for (const update of readFields(top.buf)) {
      if (update.field === 14) notices.push({ type: 'turn_end' });
      if (update.field !== 1 || !update.buf) continue;
      const text = readFields(update.buf).find((field) => field.field === 1 && field.buf);
      if (text?.buf) notices.push({ type: 'text', text: text.buf.toString('utf8') });
    }
  }
  return notices;
}

export class FrameBuffer {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: Buffer[] = [];
    while (this.pending.length >= 5) {
      const length = this.pending.readUInt32BE(1);
      if (this.pending.length < 5 + length) break;
      const frame = Buffer.from(this.pending.subarray(0, 5 + length));
      this.pending = this.pending.subarray(5 + length);
      frames.push(frame);
    }
    return frames;
  }
}
