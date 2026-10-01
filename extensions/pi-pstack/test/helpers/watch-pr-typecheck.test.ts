import { expect, test } from 'bun:test';

const scripts = new URL('../../skills/poteto-mode/scripts', import.meta.url).pathname;
const tsc = `${scripts}/node_modules/.bin/tsc`;

function run(command: string[]) {
  const result = Bun.spawnSync(command, { cwd: scripts });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

test('the helper typecheck script passes strict tsc over watch-pr including its four ts-expect-error assertions', () => {
  const result = run(['bun', 'run', 'typecheck']);
  expect(result).toEqual({ code: 0, output: expect.stringContaining('tsc --project watch-pr/tsconfig.json --noEmit --strict') });
});

test('strict tsc passes over bootstrap.ts, orch.ts, and store.ts, which no tsconfig includes', () => {
  const flags = ['--ignoreConfig', '--noEmit', '--strict', '--allowImportingTsExtensions', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'esnext', '--skipLibCheck', '--types', 'bun-types'];
  const result = run([tsc, ...flags, 'bootstrap.ts', 'orch/orch.ts', 'orch/store.ts']);
  expect(result.output.trim()).toBe('');
  expect(result.code).toBe(0);
});
