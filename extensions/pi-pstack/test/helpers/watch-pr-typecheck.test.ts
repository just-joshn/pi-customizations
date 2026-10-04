import './leak-preload.ts';

import { expect, test } from 'vitest';
import { runProcess } from './watch-pr-process.ts';

const scripts = new URL('../../skills/poteto-mode/scripts', import.meta.url).pathname;
const tsc = `${scripts}/node_modules/.bin/tsc`;

function run(command: [string, ...string[]]) {
  const result = runProcess(command, { cwd: scripts });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

test('the helper typecheck script passes strict tsc over watch-pr including its four ts-expect-error assertions', () => {
  const result = run(['bun', 'run', 'typecheck']);
  expect(result).toEqual({ code: 0, output: expect.stringContaining('tsc --project tsconfig.json') });
});

test('the full helper project passes its shared compiler policy', () => {
  const result = run([tsc, '--project', 'tsconfig.json']);
  expect(result.output.trim()).toBe('');
  expect(result.code).toBe(0);
});
