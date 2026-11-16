import { createHash } from 'node:crypto';

import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  initTheme,
  type Theme,
  type ToolRenderers,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { expect, test, vi } from 'vitest';
import { compactRenderers } from '../src/rows/row.ts';
import { genericSpec, TOOL_SPECS } from '../src/rows/specs.ts';
import { driveRow, output, type RowEvent } from './harness.ts';

// Pi picks truecolor or 256-color codes from COLORTERM, and the snapshot hashes those codes.
vi.stubEnv('COLORTERM', 'truecolor');
initTheme('dark', false);
// Pi keeps the active theme on this global symbol and does not export the instance.
const theme = (globalThis as Record<symbol, unknown>)[Symbol.for('@earendil-works/pi-coding-agent:theme')] as Theme;
const CWD = '/project';
// Pi hands extensions these definitions' renderers through `registerToolRenderer` as `ToolRenderers`.
const native = (definition: object) => definition as ToolRenderers;
const source = Array.from({ length: 30 }, (_, i) => `export const value${i} = await load(${i}); // 漢字 🙂`).join('\n');
const failure = ['FAIL cache.test.ts', '  respects cancellation', '    expected aborted, got resolved', '', 'Command exited with code 1'].join('\n');
const diff = '-41 async function refreshCache() {\n+41 async function refreshCache(signal) {\n-42   return await fetchSnapshot();\n+42   return await fetchSnapshot({ signal });';
const red = '\x1b[31m';
const reset = '\x1b[0m';
const CASES: Record<string, { renderers: ToolRenderers; event: RowEvent }> = {
  read: { renderers: compactRenderers(TOOL_SPECS.read, native(createReadToolDefinition(CWD))), event: { args: { path: `${CWD}/src/cache.ts` }, result: output(source) } },
  grep: {
    renderers: compactRenderers(TOOL_SPECS.grep, native(createGrepToolDefinition(CWD))),
    event: { args: { pattern: 'refreshCache', path: 'src' }, result: output('src/cache.ts:41: async function refreshCache() {\nsrc/app.ts:88: await refreshCache()') },
  },
  edit: {
    renderers: compactRenderers(TOOL_SPECS.edit, native(createEditToolDefinition(CWD))),
    event: { args: { path: `${CWD}/src/cache.ts`, edits: [{ oldText: 'a', newText: 'b' }] }, result: { ...output('Successfully replaced 1 block(s).'), details: { diff, firstChangedLine: 41 } } },
  },
  bashPass: { renderers: compactRenderers(TOOL_SPECS.bash, native(createBashToolDefinition(CWD))), event: { args: { command: 'npm test' }, result: output('PASS cache.test.ts\n\trefreshes a snapshot\n  respects cancellation\n') } },
  bashFail: { renderers: compactRenderers(TOOL_SPECS.bash, native(createBashToolDefinition(CWD))), event: { args: { command: 'npm test' }, result: output(failure, true) } },
  write: { renderers: compactRenderers(TOOL_SPECS.write, native(createWriteToolDefinition(CWD))), event: { args: { path: `${CWD}/src/new.ts`, content: source }, result: output('Successfully wrote 1200 bytes to src/new.ts') } },
  find: { renderers: compactRenderers(TOOL_SPECS.find, native(createFindToolDefinition(CWD))), event: { args: { pattern: '*.ts' }, result: output('src/cache.ts\nsrc/app.ts\nsrc/session/index.ts') } },
  ls: { renderers: compactRenderers(TOOL_SPECS.ls, native(createLsToolDefinition(CWD))), event: { args: { path: 'src' }, result: output('cache.ts\napp.ts\nsession/') } },
  generic: { renderers: compactRenderers(genericSpec('codemode'), {}), event: { args: { code: 'return 1;' }, result: output(`${`${red}red${reset} line\n`.repeat(12)}\n`) } },
  genericFail: { renderers: compactRenderers(genericSpec('tmux_run'), {}), event: { args: { name: 'tests' }, result: output('TypeError: boom\n'.repeat(6), true) } },
};

function digest(lines: readonly string[]): string {
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

test('expanded panels keep their exact output at every width', async () => {
  const digests: Record<string, Record<number, string>> = {};
  for (const [name, { renderers, event }] of Object.entries(CASES)) {
    for (const outputPad of [0, 1]) {
      const row = driveRow(renderers, theme, { cwd: CWD, outputPad });
      row.apply({ ...event, executionStarted: true, isPartial: false, expanded: true });
      const widths: Record<number, string> = {};
      for (let width = 1; width <= 120; width++) widths[width] = digest(row.lines(width));
      for (let width = 120; width >= 1; width--) expect(digest(row.lines(width)), `${name} pad ${outputPad} width ${width} on a cached frame`).toBe(widths[width]);
      digests[`${name} pad ${outputPad}`] = widths;
    }
  }
  await expect(`${JSON.stringify(digests, null, 2)}\n`).toMatchFileSnapshot('./__snapshots__/panels.json');
});

test('an expanded panel repaints its background when the same native lines turn into an error', () => {
  const child = new Text('boom', 0, 0);
  const row = driveRow(compactRenderers(TOOL_SPECS.bash, { renderResult: () => child }), theme);
  row.apply({ args: { command: 'make' }, executionStarted: true, result: output('boom'), isPartial: false, expanded: true });
  expect(row.lines(60)[1]).toContain(theme.getBgAnsi('toolPendingBg'));
  row.apply({ result: output('boom', true) });
  expect(row.lines(60)[1]).toContain(theme.getBgAnsi('toolErrorBg'));
  row.apply({ result: output('boom') });
  expect(row.lines(60)[1]).toContain(theme.getBgAnsi('toolPendingBg'));
});
