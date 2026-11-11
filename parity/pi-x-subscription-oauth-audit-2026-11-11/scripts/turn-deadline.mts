import { type NativeSession, readAssistantText } from '../../../extensions/pi-x-subscription-oauth/src/cursor/native/turn.ts';
import { encodeTextFrame, encodeTurnEndFrame } from '../../../extensions/pi-x-subscription-oauth/src/cursor/native/wire.ts';

// The server streams text every 100 ms for 600 ms, then ends the turn. A 300 ms deadline stands in for the 120 s FIRST_BYTE_MS.
const session = {
  write() {},
  close() {},
  async *frames() {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      yield encodeTextFrame(`chunk${i} `);
    }
    yield encodeTurnEndFrame();
  },
} satisfies NativeSession;
try {
  console.log('OK', await readAssistantText(session, { prompt: 'x', modelId: 'm' }, undefined, 300));
} catch (error) {
  console.log('THREW after text was streaming:', error instanceof Error ? error.message : String(error));
}
