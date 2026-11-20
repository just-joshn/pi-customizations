import { ARGV_USER_START, assistant, type Draft, fixtureArgsSchema, range, textBlock, toolCall, toolResult, user, writeSession } from '../fixture-lib.ts';
import type { JsonObject } from '../json.ts';

/**
 * Write a Pi session that replays the mockup conversation: read, edit, bash pass, bash fail, grep, image read, codemode.
 *
 * An optional third argument repeats the conversation that many times, for a long transcript.
 */
const DEFAULT_REPEATS = 1;
const OUTPUT_TOKENS = 200;
const SOURCE_LINES = 142;
const FIRST_CHANGED_LINE = 41;
const TEST_CHANGED_LINE = 7;
const PNG_HEX = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf500f00038601805a347d6b0000000049454e44ae426082';
const PNG = Buffer.from(PNG_HEX, 'hex').toString('base64');

const SOURCE = range(1, SOURCE_LINES + 1)
  .map((i) => `line ${i}`)
  .join('\n');
const DIFF = '-41 async function refreshCache() {\n+41 async function refreshCache(signal) {\n-42   return await fetchSnapshot();\n+42   return await fetchSnapshot({ signal });';
const PATCH =
  '--- a/src/session/cache.ts\n+++ b/src/session/cache.ts\n@@ -41,2 +41,2 @@\n-async function refreshCache() {\n+async function refreshCache(signal) {\n-  return await fetchSnapshot();\n+  return await fetchSnapshot({ signal });\n';
const FAIL = [
  'FAIL cache.test.ts',
  '  refreshes a snapshot',
  '  respects cancellation',
  '    expected aborted, got resolved',
  '      at cache.test.ts:42:7',
  '      at runTest (vitest)',
  'Tests: 1 failed, 1 passed',
  '',
  'Command exited with code 1',
].join('\n');
const GREP = 'src/session/cache.ts:41: async function refreshCache() {\nsrc/session/index.ts:12: refreshCache()\nsrc/app.ts:88: await refreshCache()';

const editArgs = (path: string): JsonObject => ({ path, edits: [{ oldText: 'a', newText: 'b' }] });

function repeatDrafts(cwd: string, repeat: number): Draft[] {
  const k = repeat === 0 ? '' : `r${repeat}-`;
  const cachePath = `${cwd}/src/session/cache.ts`;
  return [
    user('Make the cache refresh cancelable.'),
    assistant(
      [
        textBlock("I'll check the refresh path and preserve the existing retry behavior."),
        toolCall(`${k}c1`, 'read', { path: cachePath }),
        toolCall(`${k}c2`, 'grep', { pattern: 'refreshCache', path: 'src' }),
        toolCall(`${k}c7`, 'read', { path: `${cwd}/docs/flow.png` }),
      ],
      OUTPUT_TOKENS,
    ),
    toolResult(`${k}c1`, 'read', SOURCE),
    toolResult(`${k}c7`, 'read', 'Read image file [image/png]', { extra: [{ type: 'image', data: PNG, mimeType: 'image/png' }] }),
    toolResult(`${k}c2`, 'grep', GREP),
    assistant([toolCall(`${k}c3`, 'edit', editArgs(cachePath))], OUTPUT_TOKENS),
    toolResult(`${k}c3`, 'edit', 'Successfully replaced 1 block(s) in src/session/cache.ts.', { details: { diff: DIFF, patch: PATCH, firstChangedLine: FIRST_CHANGED_LINE } }),
    assistant([toolCall(`${k}c4`, 'bash', { command: 'npm test' })], OUTPUT_TOKENS),
    toolResult(`${k}c4`, 'bash', FAIL, { error: true }),
    assistant([toolCall(`${k}c5`, 'edit', editArgs(`${cwd}/test/cache.test.ts`)), toolCall(`${k}c6`, 'bash', { command: 'npm test' })], OUTPUT_TOKENS),
    toolResult(`${k}c5`, 'edit', 'Successfully replaced 1 block(s).', { details: { diff: '-7 x\n+7 y', patch: '--- a\n+++ b\n@@ -7 +7 @@\n-x\n+y\n', firstChangedLine: TEST_CHANGED_LINE } }),
    toolResult(`${k}c6`, 'bash', 'PASS cache.test.ts\n  refreshes a snapshot\n  respects cancellation'),
    assistant([textBlock('Refresh now accepts an abort signal.\n\nExisting retries are unchanged. Tests pass.')], OUTPUT_TOKENS, 'stop'),
  ];
}

const args = fixtureArgsSchema(DEFAULT_REPEATS).parse(process.argv.slice(ARGV_USER_START));
writeSession(
  args.out,
  { sessionId: '01a1dffe-0000-7000-8000-000000000001', idPrefix: 'e', cwd: args.cwd },
  range(0, args.count).flatMap((repeat) => repeatDrafts(args.cwd, repeat)),
);
