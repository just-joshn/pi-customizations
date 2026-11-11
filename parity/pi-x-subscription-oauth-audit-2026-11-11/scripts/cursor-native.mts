import { writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { openCursorRun } from '../../../extensions/pi-x-subscription-oauth/src/cursor/native/http2.ts';
import { decodeFrame, encodeContextFrame, encodeRunFrame } from '../../../extensions/pi-x-subscription-oauth/src/cursor/native/wire.ts';
import { RAW_OUT_DIR, storedCredential } from './audit-env.mts';

const [baseUrl = 'https://api2.cursor.sh', prompt = 'Reply with exactly the word pong and nothing else.', modelId = 'composer-2.5'] = process.argv.slice(2);
const started = Date.now();
const session = await openCursorRun({ token: storedCredential('cursor').access, signal: AbortSignal.timeout(60_000), baseUrl });
session.write(encodeRunFrame({ prompt, modelId }));

type FrameRecord =
  | { readonly kind: 'frame'; readonly ms: number; readonly flags: number; readonly len: number; readonly hex: string; readonly text?: string; readonly notices: readonly unknown[] }
  | { readonly kind: 'error'; readonly ms: number; readonly error: string };
const frames: FrameRecord[] = [];
let contextSent = false;
try {
  for await (const frame of session.frames()) {
    const flags = frame[0] ?? 0;
    const payload = flags & 1 ? gunzipSync(frame.subarray(5)) : frame.subarray(5);
    const notices = decodeFrame(frame);
    frames.push({
      kind: 'frame',
      ms: Date.now() - started,
      flags,
      len: payload.length,
      hex: payload.subarray(0, 120).toString('hex'),
      ...(flags & 2 ? { text: payload.toString('utf8').slice(0, 2000) } : {}),
      notices: notices.map((notice) => (notice.type === 'context' ? { type: 'context', execField: notice.execField?.toString('hex') } : notice)),
    });
    for (const notice of notices) {
      if (notice.type === 'context' && !contextSent) {
        contextSent = true;
        session.write(encodeContextFrame(notice.execField));
      }
    }
    if (notices.some((notice) => notice.type === 'turn_end')) break;
  }
} catch (error) {
  frames.push({ kind: 'error', ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
}
session.close();
writeFileSync(`${RAW_OUT_DIR}/cursor-native-frames.json`, JSON.stringify(frames, null, 1));
console.log(JSON.stringify(frames, null, 1));
