import { ARGV_USER_START, assistant, type Draft, fixtureArgsSchema, pad, range, textBlock, toolCall, toolResult, user, writeSession } from './fixture-lib.ts';
import type { JsonObject } from './json.ts';

/**
 * Write a mixed Pi session: 50 turns of six tool calls each (300 tool rows).
 *
 * Half the rows call codemode, pi_spawn, and tmux_run, which bench-provider.ts registers without renderers.
 * Their results hold 20 to 200 lines of text, and a few fail. The other half are read, edit, and bash.
 */
const DEFAULT_TURNS = 50;
const OUTPUT_TOKENS = 400;
const MIN_LINES = 20;
const LINE_SPREAD = 181;
const TURN_STRIDE = 37;
const SLOT_STRIDE = 53;
const SPAWN_SLOT = 1;
const TMUX_SLOT = 2;
const SOURCE_LINES = 60;
const SOURCE_NUMBER_WIDTH = 4;
const TEST_CASES = 15;
const TEXT_CYCLE = 3;
const CODE_LINE_STRIDE = 7;
const PATH_CYCLE = 11;
const MS_CYCLE = 9;
const SPAWN_WIDTH = 3;
const TMUX_WIDTH = 4;
const CODE_FAIL_EVERY = 10;
const CODE_FAIL_REMAINDER = 9;
const TMUX_FAIL_EVERY = 15;
const TMUX_FAIL_REMAINDER = 7;
const FIRST_CHANGED_LINE = 41;

const SOURCE = range(1, SOURCE_LINES + 1)
  .map((i) => `${String(i).padStart(SOURCE_NUMBER_WIDTH, ' ')}  const value${i} = compute(input, ${i});`)
  .join('\n');
const DIFF = '-41 async function refreshCache() {\n+41 async function refreshCache(signal) {';
const PATCH = '--- a/src/cache.ts\n+++ b/src/cache.ts\n@@ -41 +41 @@\n-async function refreshCache() {\n+async function refreshCache(signal) {\n';
const BASH = [...range(1, TEST_CASES + 1).map((i) => ` ✓ cache.test.ts > case ${i}`), '', ' Test Files  1 passed (1)', '      Tests  15 passed (15)'].join('\n');
const CODE = "const files = await tools.bash({ command: 'rg -l refreshCache src' });\nconst hits = files.output.split('\\n');\nreturn hits.map((file) => file.trim());";

const lineCount = (turn: number, slot: number): number => MIN_LINES + ((turn * TURN_STRIDE + slot * SLOT_STRIDE) % LINE_SPREAD);

const codemodeOutput = (turn: number): string =>
  range(0, lineCount(turn, 0))
    .map((i) => `==> text ${(i % TEXT_CYCLE) + 1}/3 <== src/module-${turn}/file-${i}.ts:${i * CODE_LINE_STRIDE}: export function handler${i}(input: Request) {`)
    .join('\n');

const spawnOutput = (turn: number): string => {
  const head = [`Job spawn-${pad(turn, SPAWN_WIDTH)} exited with code 0.`, '', '## Report', ''];
  const body = range(0, lineCount(turn, SPAWN_SLOT) - head.length).map((i) => `- Checked case ${i}: the cache refresh honors the abort signal on path ${i % PATH_CYCLE}.`);
  return [...head, ...body].join('\n');
};

const tmuxOutput = (turn: number): string =>
  range(0, lineCount(turn, TMUX_SLOT))
    .map((i) => `[${pad(i, TMUX_WIDTH)}] vitest run --reporter dot  ✓ suite-${turn}/case-${i}  ${(i % MS_CYCLE) + 1} ms`)
    .join('\n');

const editArgs = (path: string): JsonObject => ({ path, edits: [{ oldText: 'a', newText: 'b' }] });

function turnDrafts(cwd: string, turn: number): Draft[] {
  const k = `t${turn}-`;
  const modulePath = `${cwd}/src/session/cache-${turn}.ts`;
  const codeFailed = turn % CODE_FAIL_EVERY === CODE_FAIL_REMAINDER;
  const tmuxFailed = turn % TMUX_FAIL_EVERY === TMUX_FAIL_REMAINDER;
  const codeText = codeFailed ? `TypeError: tools.bash is not a function\n    at script.js:1:27\n    at run (codemode:${turn})` : codemodeOutput(turn);
  const spawnArgs = { name: `review-${turn}`, brief: `Review cache module ${turn}.\n\nRead src/session/cache-${turn}.ts and report every caller.`, agent: 'poteto-agent' };
  const tmuxArgs = { name: `tests-${turn}`, command: `bunx vitest run test/cache-${turn}.test.ts`, wake: 'tests done' };
  return [
    user(`Make cache module ${turn} cancelable.`),
    assistant([textBlock("I'll map the callers, then hand the review to a worker."), toolCall(`${k}code`, 'codemode', { code: CODE }), toolCall(`${k}read`, 'read', { path: modulePath })], OUTPUT_TOKENS),
    toolResult(`${k}code`, 'codemode', codeText, { error: codeFailed }),
    toolResult(`${k}read`, 'read', SOURCE),
    assistant([toolCall(`${k}spawn`, 'pi_spawn', spawnArgs), toolCall(`${k}edit`, 'edit', editArgs(modulePath))], OUTPUT_TOKENS),
    toolResult(`${k}spawn`, 'pi_spawn', spawnOutput(turn)),
    toolResult(`${k}edit`, 'edit', `Successfully replaced 1 block(s) in src/session/cache-${turn}.ts.`, { details: { diff: DIFF, patch: PATCH, firstChangedLine: FIRST_CHANGED_LINE } }),
    assistant([toolCall(`${k}tmux`, 'tmux_run', tmuxArgs), toolCall(`${k}bash`, 'bash', { command: 'npm test -- cache' })], OUTPUT_TOKENS),
    toolResult(`${k}tmux`, 'tmux_run', tmuxOutput(turn) + (tmuxFailed ? '\n FAIL suite timed out\nCommand exited with code 2' : ''), { error: tmuxFailed }),
    toolResult(`${k}bash`, 'bash', BASH),
    assistant([textBlock(`Module ${turn} now accepts an abort signal. Tests pass.`)], OUTPUT_TOKENS, 'stop'),
  ];
}

const args = fixtureArgsSchema(DEFAULT_TURNS).parse(process.argv.slice(ARGV_USER_START));
writeSession(
  args.out,
  { sessionId: '01a1dffe-0000-7000-8000-000000000003', idPrefix: 'x', cwd: args.cwd },
  range(0, args.count).flatMap((turn) => turnDrafts(args.cwd, turn)),
);
