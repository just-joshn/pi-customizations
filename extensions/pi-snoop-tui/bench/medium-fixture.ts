import { ARGV_USER_START, assistant, type Draft, fixtureArgsSchema, range, textBlock, toolCall, toolResult, user, writeSession } from './fixture-lib.ts';
import type { JsonObject } from './json.ts';

/** Write a medium Pi session: 30 turns of Markdown with code blocks and five tool calls each (150 tool rows). */
const DEFAULT_TURNS = 30;
const OUTPUT_TOKENS = 400;
const SOURCE_LINES = 60;
const GREP_FILES = 5;
const GREP_LINE_STRIDE = 3;
const TEST_CASES = 15;
const SOURCE_NUMBER_WIDTH = 4;
const FIRST_CHANGED_LINE = 41;

const SOURCE = range(1, SOURCE_LINES + 1)
  .map((i) => `${String(i).padStart(SOURCE_NUMBER_WIDTH, ' ')}  const value${i} = compute(input, ${i});`)
  .join('\n');
const GREP = range(1, GREP_FILES + 1)
  .map((i) => `src/session/cache-${i}.ts:${i * GREP_LINE_STRIDE}: await refreshCache()`)
  .join('\n');
const BASH = [...range(1, TEST_CASES + 1).map((i) => ` ✓ cache.test.ts > case ${i}`), '', ' Test Files  1 passed (1)', '      Tests  15 passed (15)'].join('\n');
const DIFF = '-41 async function refreshCache() {\n+41 async function refreshCache(signal) {\n-42   return await fetchSnapshot();\n+42   return await fetchSnapshot({ signal });';
const PATCH = '--- a/src/cache.ts\n+++ b/src/cache.ts\n@@ -41,2 +41,2 @@\n-async function refreshCache() {\n+async function refreshCache(signal) {\n-  return await fetchSnapshot();\n+  return await fetchSnapshot({ signal });\n';

const plan = (turn: number): string =>
  [
    `## Step ${turn + 1}: tighten the cache path`,
    '',
    `The **refresh** loop in \`cache-${turn}.ts\` re-reads the snapshot on every tick. I'll check the callers, then make the fetch cancelable.`,
    '',
    '- Read the module and its tests.',
    '- Find every caller of `refreshCache`.',
    '- Patch the signature and rerun the suite.',
    '',
    '```ts',
    `export async function refreshCache${turn}(signal?: AbortSignal) {`,
    '  const snapshot = await fetchSnapshot({ signal });',
    '  return snapshot.rows.filter((row) => row.visible);',
    '}',
    '```',
  ].join('\n');

const summary = (turn: number): string =>
  [
    `### Result for step ${turn + 1}`,
    '',
    '| Check | Status |',
    '|---|---|',
    '| Unit tests | pass |',
    '| Type check | pass |',
    '',
    'The fetch now honors the abort signal. Retries keep their old backoff:',
    '',
    '```ts',
    'const delay = Math.min(250 * 2 ** attempt, 4000);',
    'await sleep(delay, signal);',
    '```',
    '',
    '> Callers that pass no signal keep the old behavior.',
  ].join('\n');

const editArgs = (path: string): JsonObject => ({ path, edits: [{ oldText: 'a', newText: 'b' }] });

function turnDrafts(cwd: string, turn: number): Draft[] {
  const k = `t${turn}-`;
  const modulePath = `${cwd}/src/session/cache-${turn}.ts`;
  const testPath = `${cwd}/test/cache-${turn}.test.ts`;
  return [
    user(`Make cache module ${turn} cancelable.`),
    assistant([textBlock(plan(turn)), toolCall(`${k}read`, 'read', { path: modulePath }), toolCall(`${k}grep`, 'grep', { pattern: 'refreshCache', path: 'src' })], OUTPUT_TOKENS),
    toolResult(`${k}read`, 'read', SOURCE),
    toolResult(`${k}grep`, 'grep', GREP),
    assistant([textBlock('The callers all await the result, so a signal parameter is safe.'), toolCall(`${k}edit`, 'edit', editArgs(modulePath))], OUTPUT_TOKENS),
    toolResult(`${k}edit`, 'edit', `Successfully replaced 1 block(s) in src/session/cache-${turn}.ts.`, { details: { diff: DIFF, patch: PATCH, firstChangedLine: FIRST_CHANGED_LINE } }),
    assistant([toolCall(`${k}bash`, 'bash', { command: 'npm test -- cache' }), toolCall(`${k}read2`, 'read', { path: testPath })], OUTPUT_TOKENS),
    toolResult(`${k}bash`, 'bash', BASH),
    toolResult(`${k}read2`, 'read', SOURCE),
    assistant([textBlock(summary(turn))], OUTPUT_TOKENS, 'stop'),
  ];
}

const args = fixtureArgsSchema(DEFAULT_TURNS).parse(process.argv.slice(ARGV_USER_START));
writeSession(
  args.out,
  { sessionId: '01a1dffe-0000-7000-8000-000000000002', idPrefix: 'm', cwd: args.cwd },
  range(0, args.count).flatMap((turn) => turnDrafts(args.cwd, turn)),
);
