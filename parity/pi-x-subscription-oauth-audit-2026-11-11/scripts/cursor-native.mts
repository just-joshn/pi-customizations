import { openCursorRun } from '../../../extensions/pi-x-subscription-oauth/src/cursor/native/http2.ts';
import { decodeFrame, encodeContextFrame, encodeRunFrame } from '../../../extensions/pi-x-subscription-oauth/src/cursor/native/wire.ts';
import { storedCredential } from './audit-env.mts';
import { type FrameRecord, recordFrame } from './frame-record.mts';

const [baseUrl = 'https://api2.cursor.sh', prompt = 'Reply with exactly the word pong and nothing else.', modelId = 'composer-2.5'] = process.argv.slice(2);
const started = Date.now();
const session = await openCursorRun({ token: storedCredential('cursor').access, signal: AbortSignal.timeout(60_000), baseUrl });
session.write(encodeRunFrame({ prompt, modelId }));

const frames: FrameRecord[] = [];
let contextSent = false;
try {
  for await (const frame of session.frames()) {
    frames.push(recordFrame(frame, Date.now() - started));
    const notices = decodeFrame(frame);
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
console.log(JSON.stringify(frames, null, 1));
