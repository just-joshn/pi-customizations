import { createHash } from 'node:crypto';

import type { ToolRenderers } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { driveRow, loadSnoop, loadTheme, output, piNative, type RowEvent } from './harness.ts';

const theme = loadTheme('snoop-dark');
const host = loadSnoop();
const CWD = '/project';
const source = Array.from({ length: 30 }, (_, i) => `export const value${i} = await load(${i}); // 漢字 🙂`).join('\n');
const failure = ['FAIL cache.test.ts', '  respects cancellation', '    expected aborted, got resolved', '', 'Command exited with code 1'].join('\n');
const diff = '-41 async function refreshCache() {\n+41 async function refreshCache(signal) {\n-42   return await fetchSnapshot();\n+42   return await fetchSnapshot({ signal });';
const red = '\x1b[31m';
const reset = '\x1b[0m';
const COLORED_LINES = 12;
const ERROR_LINES = 6;
const DIGEST_CHARS = 16;
const MAX_WIDTH = 120;
const WIDTHS = Array.from({ length: MAX_WIDTH }, (_, i) => i + 1);
interface Case {
  readonly tool: string;
  readonly native: ToolRenderers | undefined;
  readonly event: RowEvent;
}
const CASES: Record<string, Case> = {
  read: { tool: 'read', native: piNative('read', CWD), event: { args: { path: `${CWD}/src/cache.ts` }, result: output(source) } },
  grep: { tool: 'grep', native: piNative('grep', CWD), event: { args: { pattern: 'refreshCache', path: 'src' }, result: output('src/cache.ts:41: async function refreshCache() {\nsrc/app.ts:88: await refreshCache()') } },
  edit: {
    tool: 'edit',
    native: piNative('edit', CWD),
    event: { args: { path: `${CWD}/src/cache.ts`, edits: [{ oldText: 'a', newText: 'b' }] }, result: { ...output('Successfully replaced 1 block(s).'), details: { diff, firstChangedLine: 41 } } },
  },
  bashPass: { tool: 'bash', native: piNative('bash', CWD), event: { args: { command: 'npm test' }, result: output('PASS cache.test.ts\n\trefreshes a snapshot\n  respects cancellation\n') } },
  bashFail: { tool: 'bash', native: piNative('bash', CWD), event: { args: { command: 'npm test' }, result: output(failure, true) } },
  write: { tool: 'write', native: piNative('write', CWD), event: { args: { path: `${CWD}/src/new.ts`, content: source }, result: output('Successfully wrote 1200 bytes to src/new.ts') } },
  find: { tool: 'find', native: piNative('find', CWD), event: { args: { pattern: '*.ts' }, result: output('src/cache.ts\nsrc/app.ts\nsrc/session/index.ts') } },
  ls: { tool: 'ls', native: piNative('ls', CWD), event: { args: { path: 'src' }, result: output('cache.ts\napp.ts\nsession/') } },
  generic: { tool: 'codemode', native: undefined, event: { args: { code: 'return 1;' }, result: output(`${`${red}red${reset} line\n`.repeat(COLORED_LINES)}\n`) } },
  genericFail: { tool: 'tmux_run', native: undefined, event: { args: { name: 'tests' }, result: output('TypeError: boom\n'.repeat(ERROR_LINES), true) } },
};

function digest(lines: readonly string[]): string {
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, DIGEST_CHARS);
}

function panelDigests(name: string, { tool, native, event }: Case, outputPad: number): Record<number, string> {
  const row = driveRow(host, tool, { native, theme, cwd: CWD, outputPad });
  row.apply({ ...event, executionStarted: true, isPartial: false, expanded: true });
  const widths: Record<number, string> = Object.fromEntries(WIDTHS.map((width) => [width, digest(row.lines(width))]));
  for (const width of WIDTHS.toReversed()) expect(digest(row.lines(width)), `${name} pad ${outputPad} width ${width} on a repeated frame`).toBe(widths[width]);
  return widths;
}

test('expanded panels keep their exact output at every width', async () => {
  const digests = Object.fromEntries(Object.entries(CASES).flatMap(([name, spec]) => [0, 1].map((outputPad) => [`${name} pad ${outputPad}`, panelDigests(name, spec, outputPad)] as const)));
  await expect(`${JSON.stringify(digests, null, 2)}\n`).toMatchFileSnapshot('./__snapshots__/panels.json');
});
