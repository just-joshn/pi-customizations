// The expected outcomes follow Cursor CLI 2026.11.05 (parity/evidence/shell-probe-2026-11-07/edges*-run-1.jsonl).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type BashOperations, createLocalBashOperations } from '@earendil-works/pi-coding-agent';
import { test as base, expect } from 'vitest';
import { createSessionShell, type SessionShell } from '../src/shell-state.ts';

interface Run {
  exitCode: number | null | string;
  output: string;
}

const test = base.extend<{ dir: string; shell: SessionShell; run: (command: string, options?: { env?: NodeJS.ProcessEnv; timeout?: number; shell?: SessionShell }) => Promise<Run> }>({
  dir: async ({ signal }, use) => {
    signal.throwIfAborted();
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-shell-state-')));
    try {
      await use(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  shell: async ({ signal }, use) => {
    signal.throwIfAborted();
    await use(createSessionShell());
  },
  run: async ({ dir, shell }, use) => {
    const local = createLocalBashOperations({ shellPath: '/bin/bash' });
    await use(async (command, options = {}) => {
      const session = options.shell ?? shell;
      let output = '';
      const onData = (bytes: Buffer) => {
        output += bytes.toString('utf8');
      };
      const env = options.env ?? { PATH: process.env['PATH'] ?? '/usr/bin:/bin' };
      const exitCode = await session
        .operations(local)
        .exec(session.script(command), dir, { onData, env, ...(options.timeout === undefined ? {} : { timeout: options.timeout }) })
        .then(
          (result) => result.exitCode,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
      return { exitCode, output };
    });
  },
});

test('the next command runs in the directory and with the variables the last one left', async ({ run }) => {
  await run('cd /usr && export PSTACK_A="it\'s\nmultiline"');

  await expect(run('pwd; printf "%s|" "$PSTACK_A"')).resolves.toEqual({ exitCode: 0, output: "/usr\nit's\nmultiline|" });
});

test('a failing command still keeps the state it reached', async ({ run }) => {
  await expect(run('cd /usr && export PSTACK_C=3 && false')).resolves.toEqual({ exitCode: 1, output: '' });

  await expect(run('pwd; echo "c=$PSTACK_C"')).resolves.toEqual({ exitCode: 0, output: '/usr\nc=3\n' });
});

test('a command that ends the shell with exit keeps none of its changes', async ({ run }) => {
  await run('cd /usr && export PSTACK_A=1');

  await expect(run('export PSTACK_B=2; cd /; exit 3')).resolves.toEqual({ exitCode: 3, output: '' });
  await expect(run('pwd; echo "a=$PSTACK_A b=$PSTACK_B"')).resolves.toEqual({ exitCode: 0, output: '/usr\na=1 b=\n' });
});

test('a timed-out command keeps none of its changes', async ({ run }) => {
  await run('cd /usr && export PSTACK_A=1');

  await expect(run('cd /; export PSTACK_A=2; sleep 5', { timeout: 0.5 })).resolves.toEqual({ exitCode: 'timeout:0.5', output: '' });
  await expect(run('pwd; echo "a=$PSTACK_A"')).resolves.toEqual({ exitCode: 0, output: '/usr\na=1\n' });
});

test('an unset inherited variable comes back on the next call', async ({ run }) => {
  const env = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', PSTACK_BASE: 'base' };
  await run('unset PSTACK_BASE', { env });

  await expect(run(`echo "base=\${PSTACK_BASE-unset}"`, { env })).resolves.toEqual({ exitCode: 0, output: 'base=base\n' });
});

test('a variable the host changes between calls stays current until a command sets it', async ({ run }) => {
  const env = (model: string) => ({ PATH: process.env['PATH'] ?? '/usr/bin:/bin', PI_MODEL: model });
  await run('export PSTACK_A=1', { env: env('first') });

  await expect(run('echo "$PI_MODEL"; export PI_MODEL=mine', { env: env('second') })).resolves.toEqual({ exitCode: 0, output: 'second\n' });
  await expect(run('echo "$PI_MODEL $PSTACK_A"', { env: env('third') })).resolves.toEqual({ exitCode: 0, output: 'mine 1\n' });
});

test('a command that removes its own directory leaves the next one refused and the one after in the start directory', async ({ dir, run }) => {
  const gone = join(dir, 'gone');
  mkdirSync(gone);
  await run(`cd ${gone} && rmdir ${gone}`);

  await expect(run('echo RAN')).resolves.toEqual({
    exitCode: 1,
    output: `The shell's working directory ${gone} no longer exists or cannot be entered. The command did not run. The shell is back in ${dir}; run the command again.\n`,
  });
  await expect(run('pwd')).resolves.toEqual({ exitCode: 0, output: `${dir}\n` });
});

test('output and the exit status reach the caller unchanged, stderr included', async ({ run }) => {
  await expect(run('printf "out"; printf "err" >&2; exit 4')).resolves.toEqual({ exitCode: 4, output: 'outerr' });
});

test('a command that redirects the shell output still carries its state, and the file gets only its own output', async ({ dir, run }) => {
  await expect(run('exec >redirected.txt; echo inside; cd /usr')).resolves.toEqual({ exitCode: 0, output: '' });

  expect(readFileSync(join(dir, 'redirected.txt'), 'utf8')).toBe('inside\n');
  await expect(run('pwd')).resolves.toEqual({ exitCode: 0, output: '/usr\n' });
});

test('a traced command shows its own trace and not the state capture', async ({ run }) => {
  await expect(run('set -x; cd /usr')).resolves.toEqual({ exitCode: 0, output: expect.stringMatching(/^\++ cd \/usr\n$/) });
  await expect(run('pwd')).resolves.toEqual({ exitCode: 0, output: '/usr\n' });
});

test('a state record split across output chunks is still read and hidden', async ({ dir, shell }) => {
  const local = createLocalBashOperations({ shellPath: '/bin/bash' });
  const byteAtATime: BashOperations = {
    exec: (command, cwd, options) =>
      local.exec(command, cwd, {
        ...options,
        onData: (bytes) => {
          for (const byte of bytes) options.onData(Buffer.from([byte]));
        },
      }),
  };
  let output = '';
  const exec = (command: string) =>
    shell.operations(byteAtATime).exec(shell.script(command), dir, {
      onData: (bytes) => {
        output += bytes.toString('utf8');
      },
    });

  await exec('echo before; cd /usr');
  await exec('pwd');

  expect(output).toBe('before\n/usr\n');
});

test('two shells keep separate state', async ({ dir, run }) => {
  const other = createSessionShell();
  await run('cd /usr && export PSTACK_A=1');

  await expect(run('pwd; echo "a=$PSTACK_A"', { shell: other })).resolves.toEqual({ exitCode: 0, output: `${dir}\na=\n` });
});
