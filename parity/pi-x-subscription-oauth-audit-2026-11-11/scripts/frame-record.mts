import { gunzipSync } from 'node:zlib';

import { decodeFrame } from '../../../extensions/pi-x-subscription-oauth/src/cursor/native/wire.ts';

export type FrameRecord =
  | { readonly kind: 'frame'; readonly ms: number; readonly flags: number; readonly len: number; readonly hex: string; readonly text?: string; readonly notices: readonly unknown[] }
  | { readonly kind: 'undecodable'; readonly ms: number; readonly flags: number; readonly len: number; readonly error: string }
  | { readonly kind: 'error'; readonly ms: number; readonly error: string };

/** One Connect envelope as the probe records it: flags, declared length, payload head, and what the extension's decodeFrame reads. */
export function recordFrame(frame: Buffer, ms: number): FrameRecord {
  const flags = frame[0] ?? 0;
  const len = frame.length >= 5 ? frame.readUInt32BE(1) : 0;
  const body = frame.subarray(5, 5 + len);
  let payload: Buffer;
  try {
    payload = flags & 1 ? gunzipSync(body) : body;
  } catch (error) {
    return { kind: 'undecodable', ms, flags, len, error: error instanceof Error ? error.message : String(error) };
  }
  return {
    kind: 'frame',
    ms,
    flags,
    len: payload.length,
    hex: payload.subarray(0, 120).toString('hex'),
    ...(flags & 2 ? { text: payload.toString('utf8').slice(0, 2000) } : {}),
    notices: decodeFrame(frame).map((notice) => (notice.type === 'context' ? { type: 'context', execField: notice.execField?.toString('hex') } : notice)),
  };
}
