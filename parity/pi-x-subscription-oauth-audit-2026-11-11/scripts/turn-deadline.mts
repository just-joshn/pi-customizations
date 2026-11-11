import { type NativeSession, readAssistantText } from '../../../extensions/pi-x-subscription-oauth/src/cursor/native/turn.ts';
import { encodeTextFrame, encodeTurnEndFrame } from '../../../extensions/pi-x-subscription-oauth/src/cursor/native/wire.ts';

const CHUNK_INTERVAL_MS = 100;
const CHUNK_COUNT = 6;
const STAND_IN_FIRST_BYTE_MS = 300;

const session = {
  write() {},
  close() {},
  async *frames() {
    for (let i = 0; i < CHUNK_COUNT; i++) {
      await new Promise((resolve) => setTimeout(resolve, CHUNK_INTERVAL_MS));
      yield encodeTextFrame(`chunk${i} `);
    }
    yield encodeTurnEndFrame();
  },
} satisfies NativeSession;
try {
  console.log('OK', await readAssistantText(session, { prompt: 'x', modelId: 'm' }, undefined, STAND_IN_FIRST_BYTE_MS));
} catch (error) {
  console.log('THREW after text was streaming:', error instanceof Error ? error.message : String(error));
}
