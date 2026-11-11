import { readFileSync, writeFileSync } from 'node:fs';
const EXT = '/Users/josh-desktop/src/personal/pi-x-subscription-oauth-audit/extensions/pi-x-subscription-oauth/src/cursor';
const { openCursorRun } = await import(`${EXT}/native/http2.ts`);
const { encodeRunFrame, decodeFrame, encodeContextFrame } = await import(`${EXT}/native/wire.ts`);
const { gunzipSync } = await import('node:zlib');
const token = JSON.parse(readFileSync('/tmp/xaudit/piagent/auth.json', 'utf8')).cursor.access;
const baseUrl = process.argv[2] ?? 'https://api2.cursor.sh';
const prompt = process.argv[3] ?? 'Reply with exactly the word pong and nothing else.';
const model = process.argv[4] ?? 'composer-2.5';
const t0 = Date.now();
const session = await openCursorRun({ token, signal: AbortSignal.timeout(60000), baseUrl });
console.log('opened', Date.now() - t0, 'ms');
session.write(encodeRunFrame({ prompt, modelId: model }));
const log: any[] = [];
let ctx = false;
try {
  for await (const frame of session.frames()) {
    const flags = frame[0];
    let payload = frame.subarray(5);
    if (flags & 1) payload = gunzipSync(payload);
    const notices = decodeFrame(frame);
    log.push({ ms: Date.now() - t0, flags, len: payload.length, hex: payload.subarray(0, 120).toString('hex'), text: flags & 2 ? payload.toString('utf8').slice(0, 2000) : undefined, notices: notices.map((n: any) => ({ ...n, execField: n.execField ? n.execField.toString('hex') : undefined })) });
    for (const n of notices) {
      if (n.type === 'context' && !ctx) { ctx = true; session.write(encodeContextFrame(n.execField)); }
    }
    if (notices.some((n: any) => n.type === 'turn_end')) break;
  }
} catch (e: any) { log.push({ error: String(e?.message ?? e) }); }
session.close();
writeFileSync('/tmp/xaudit/cursor-native-frames.json', JSON.stringify(log, null, 1));
console.log(JSON.stringify(log, null, 1).slice(0, 6000));
