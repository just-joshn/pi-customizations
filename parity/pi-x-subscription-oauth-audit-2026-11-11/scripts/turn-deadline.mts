const EXT = '/Users/josh-desktop/src/personal/pi-x-subscription-oauth-audit/extensions/pi-x-subscription-oauth/src/cursor/native';
const { readAssistantText } = await import(`${EXT}/turn.ts`);
const { encodeTextFrame, encodeTurnEndFrame } = await import(`${EXT}/wire.ts`);
// Server streams text every 100 ms for 600 ms, then ends the turn. Deadline 300 ms (stands in for the 120 s FIRST_BYTE_MS).
const session = {
  write() {},
  close() {},
  frames() {
    return { async *[Symbol.asyncIterator]() {
      for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 100)); yield encodeTextFrame(`chunk${i} `); }
      yield encodeTurnEndFrame();
    } };
  },
};
try { console.log('OK', await readAssistantText(session as any, { prompt: 'x', modelId: 'm' }, undefined, 300)); }
catch (e: any) { console.log('THREW after text was streaming:', e.message); }
