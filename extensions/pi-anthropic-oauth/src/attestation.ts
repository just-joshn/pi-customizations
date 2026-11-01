const MASK = (1n << 64n) - 1n;
const P1 = 0x9e3779b185ebca87n;
const P2 = 0xc2b2ae3d27d4eb4fn;
const P3 = 0x165667b19e3779f9n;
const P4 = 0x85ebca77c2b2ae63n;
const P5 = 0x27d4eb2f165667c5n;

/** Seed Claude Code 2.1.316's native HTTP layer feeds XXH64 for the `cch` body attestation. */
export const CCH_SEED = 0x4d659218e32a3268n;
export const CCH_PLACEHOLDER = 'cch=00000';

const SYSTEM_MARKER = '"system":[';
const MODEL_KEY = '"model":"';
const FALLBACKS_KEY = '"fallbacks":[';
const FALLBACK_TOKEN_KEY = '"fallback_credit_token":"';
const MAX_TOKENS_KEY = '"max_tokens":';
const PLACEHOLDER_WINDOW = 300;

function rotl(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & MASK;
}

function round(acc: bigint, input: bigint): bigint {
  return (rotl((acc + input * P2) & MASK, 31n) * P1) & MASK;
}

function mergeRound(acc: bigint, value: bigint): bigint {
  return ((((acc ^ round(0n, value)) * P1) & MASK) + P4) & MASK;
}

export function xxh64(data: Uint8Array, seed: bigint): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = data.byteLength;
  let offset = 0;
  let hash: bigint;
  if (length >= 32) {
    let v1 = (seed + P1 + P2) & MASK;
    let v2 = (seed + P2) & MASK;
    let v3 = seed;
    let v4 = (seed - P1) & MASK;
    for (; offset + 32 <= length; offset += 32) {
      v1 = round(v1, view.getBigUint64(offset, true));
      v2 = round(v2, view.getBigUint64(offset + 8, true));
      v3 = round(v3, view.getBigUint64(offset + 16, true));
      v4 = round(v4, view.getBigUint64(offset + 24, true));
    }
    hash = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & MASK;
    hash = mergeRound(hash, v1);
    hash = mergeRound(hash, v2);
    hash = mergeRound(hash, v3);
    hash = mergeRound(hash, v4);
  } else {
    hash = (seed + P5) & MASK;
  }
  hash = (hash + BigInt(length)) & MASK;
  for (; offset + 8 <= length; offset += 8) {
    hash ^= round(0n, view.getBigUint64(offset, true));
    hash = (((rotl(hash, 27n) * P1) & MASK) + P4) & MASK;
  }
  if (offset + 4 <= length) {
    hash ^= (BigInt(view.getUint32(offset, true)) * P1) & MASK;
    hash = (((rotl(hash, 23n) * P2) & MASK) + P3) & MASK;
    offset += 4;
  }
  for (; offset < length; offset += 1) {
    hash ^= (BigInt(data[offset] as number) * P5) & MASK;
    hash = (rotl(hash, 11n) * P1) & MASK;
  }
  hash ^= hash >> 33n;
  hash = (hash * P2) & MASK;
  hash ^= hash >> 29n;
  hash = (hash * P3) & MASK;
  hash ^= hash >> 32n;
  return hash;
}

type Span = { start: number; end: number };

const COMMA = 0x2c;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

function withComma(body: Buffer, start: number, end: number, cursor: number): Span {
  if (body[end] === COMMA) return { start, end: end + 1 };
  return { start: start > cursor && body[start - 1] === COMMA ? start - 1 : start, end };
}

function fallbacksSpan(body: Buffer, cursor: number): Span | undefined {
  const at = body.indexOf(FALLBACKS_KEY, cursor);
  if (at < 0) return undefined;
  let depth = 1;
  let inString = false;
  for (let index = at + FALLBACKS_KEY.length; index < body.length; index += 1) {
    const byte = body[index];
    if (inString) {
      if (byte === BACKSLASH) index += 1;
      else if (byte === QUOTE) inString = false;
    } else if (byte === QUOTE) inString = true;
    else if (byte === OPEN_BRACKET) depth += 1;
    else if (byte === CLOSE_BRACKET) {
      depth -= 1;
      if (depth === 0) return withComma(body, at, index + 1, cursor);
    }
  }
  return undefined;
}

function creditTokenSpan(body: Buffer, cursor: number): Span | undefined {
  const at = body.indexOf(FALLBACK_TOKEN_KEY, cursor);
  if (at < 0) return undefined;
  const close = body.indexOf('"', at + FALLBACK_TOKEN_KEY.length);
  if (close < 0) return undefined;
  return withComma(body, at, close + 1, cursor);
}

function isDigit(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}

function maxTokensSpan(body: Buffer, cursor: number): Span | undefined {
  let from = cursor;
  for (;;) {
    const at = body.indexOf(MAX_TOKENS_KEY, from);
    if (at < 0) return undefined;
    const valueStart = at + MAX_TOKENS_KEY.length;
    if (valueStart >= body.length) return undefined;
    let end = valueStart;
    while (isDigit(body[end])) end += 1;
    if (end === valueStart) {
      from = valueStart;
      continue;
    }
    return withComma(body, at, end, cursor);
  }
}

function nextSpan(body: Buffer, cursor: number): Span | undefined {
  const candidates = [fallbacksSpan(body, cursor), creditTokenSpan(body, cursor), maxTokensSpan(body, cursor)];
  return candidates.reduce<Span | undefined>((best, candidate) => (candidate !== undefined && (best === undefined || candidate.start < best.start) ? candidate : best), undefined);
}

/**
 * The bytes Claude Code hashes: the body without the model value, the `fallbacks`
 * array, the `fallback_credit_token` value, and `max_tokens`. Everything else, the
 * `cch=00000` placeholder included, is hashed as sent.
 */
export function attestedBytes(body: Buffer): Buffer {
  const kept: Buffer[] = [];
  let cursor = 0;
  let span = nextSpan(body, cursor);
  for (;;) {
    if (span !== undefined && span.start < cursor) span = nextSpan(body, cursor);
    const model = body.indexOf(MODEL_KEY, cursor);
    if (span !== undefined && (model < 0 || span.start < model)) {
      kept.push(body.subarray(cursor, span.start));
      cursor = span.end;
      span = nextSpan(body, cursor);
      continue;
    }
    if (model >= 0) {
      const valueStart = model + MODEL_KEY.length;
      const close = body.indexOf('"', valueStart);
      if (close >= 0) {
        kept.push(body.subarray(cursor, valueStart));
        cursor = close;
        continue;
      }
    }
    kept.push(body.subarray(cursor));
    return Buffer.concat(kept);
  }
}

export function cchDigest(body: Buffer): string {
  return (xxh64(attestedBytes(body), CCH_SEED) & 0xfffffn).toString(16).padStart(5, '0');
}

/**
 * Replace the `cch=00000` placeholder in the billing block with the body hash, as
 * Claude Code's HTTP layer does for `/v1/messages`. A body without the placeholder
 * inside the first 300 bytes after `"system":[` is returned unchanged.
 */
export function attestBody(body: string): string {
  const bytes = Buffer.from(body, 'utf8');
  const marker = bytes.indexOf(SYSTEM_MARKER);
  if (marker < 0) return body;
  const window = bytes.subarray(0, Math.min(marker + PLACEHOLDER_WINDOW, bytes.length));
  const placeholder = window.indexOf(CCH_PLACEHOLDER, marker);
  if (placeholder < 0) return body;
  const digits = placeholder + 4;
  bytes.write(cchDigest(bytes), digits, 5, 'ascii');
  return bytes.toString('utf8');
}
