import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Host } from '../../src/core/host.ts';
import { runShellCommand, shellQuote } from '../../src/lint/shell.ts';
import { createValidation } from '../../src/lint/validation.ts';

async function tempRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('Host.exec /bin/sh -c runs trusted shell under the user account; filename quoting does not sandbox compounds', {
  meta: {
    aider: ['run_cmd.py:11-23,42-86', 'linter.py:118-166'],
    evidence: ['ev-lint/probe/runner-merges-stderr'],
  },
}, async () => {
  const root = await tempRoot('lint-shell-trust-');
  const calls: { command: string; args: readonly string[] }[] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async () => false,
    select: async () => undefined,
    exec: async (request) => {
      calls.push({ command: request.command, args: request.args });
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync(request.command, [...request.args], {
        cwd: request.cwd,
        encoding: 'utf8',
        env: process.env,
      });
      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        code: result.status ?? 1,
        killed: false,
      };
    },
  };

  const compound = await runShellCommand(host, 'echo first && echo second', root);
  expect(calls[0]).toEqual({ command: '/bin/sh', args: ['-c', 'echo first && echo second'] });
  expect(compound.code).toBe(0);
  expect(compound.output).toContain('first');
  expect(compound.output).toContain('second');

  const marker = join(root, 'escaped.txt');
  const sneaky = `touch ${shellQuote('safe.py')}; echo pwned > ${shellQuote('escaped.txt')}`;
  const sneakyResult = await runShellCommand(host, sneaky, root);
  expect(sneakyResult.code).toBe(0);
  expect(await readFile(marker, 'utf8')).toBe('pwned\n');

  await writeFile(join(root, 'target.py'), 'x = 1\n');
  const lint = createValidation({
    host,
    root,
    autoLint: true,
    autoTest: false,
    lintCmds: new Map([[null, 'true']]),
    testCmd: null,
  });
  await lint.lintEdited(new Set(['target.py']));
  const lintCall = calls.find((call) => call.args[1]?.includes('target.py'));
  expect(lintCall?.command).toBe('/bin/sh');
  expect(lintCall?.args[0]).toBe('-c');
  expect(lintCall?.args[1]).toContain(shellQuote('target.py'));
});
