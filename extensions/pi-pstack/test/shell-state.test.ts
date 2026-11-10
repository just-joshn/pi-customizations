// The expected outcomes follow Cursor CLI 2026.11.05 (parity/evidence/shell-probe-2026-11-07/edges*-run-1.jsonl).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { type BashOperations, createLocalBashOperations } from '@earendil-works/pi-coding-agent';
import { test as base, describe, expect, onTestFinished, vi } from 'vitest';
import { type BackgroundedCommand, createSessionShell, type MovedCommand, type SessionShell, sessionBashDefinition } from '../src/shell-state.ts';

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

test('an environment name with a hyphen still lets the next call see exports and functions', async ({ run }) => {
  const env = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', 'npm_package_bin_pstack-routines-supervisor': '/tmp/bin' };

  await expect(run('export PSTACK_A=1; pstack_fn() { echo kept; }', { env })).resolves.toEqual({ exitCode: 0, output: '' });
  await expect(run('echo "a=$PSTACK_A"; pstack_fn', { env })).resolves.toEqual({ exitCode: 0, output: 'a=1\nkept\n' });
});

test('a cd function does not stop the next command from restoring the directory', async ({ run }) => {
  await run('cd /usr && cd() { echo hijacked; return 1; }');

  await expect(run('pwd')).resolves.toEqual({ exitCode: 0, output: '/usr\n' });
});

test('a foreground command that stays put still accepts a directory captured before it', async ({ dir, shell, run }) => {
  await run('pwd');
  const seen = shell.epoch();
  const next = join(dir, 'away');
  mkdirSync(next);
  const away = realpathSync(next);

  await run('echo still');
  shell.adoptCwd(seen, away);

  expect(shell.cwd()).toBe(away);
  await expect(run('pwd')).resolves.toEqual({ exitCode: 0, output: `${away}\n` });
});

test('a function defined in one call runs in the next, including quotes and newlines in its body', async ({ run }) => {
  await run(`pstack_fn() { printf '%s' "it's\nstill"; }`);

  await expect(run('pstack_fn')).resolves.toEqual({ exitCode: 0, output: "it's\nstill" });
});

test('unset -f drops the function, and exit keeps a function defined in that command from replacing the previous one', async ({ run }) => {
  await run('pstack_fn() { echo kept; }');
  await expect(run('pstack_fn() { echo replaced; }; exit 3')).resolves.toEqual({ exitCode: 3, output: '' });
  await expect(run('pstack_fn')).resolves.toEqual({ exitCode: 0, output: 'kept\n' });

  await run('unset -f pstack_fn');
  await expect(run('pstack_fn')).resolves.toMatchObject({ exitCode: 127 });
});

test('two shells keep separate state', async ({ dir, run }) => {
  const other = createSessionShell();
  await run('cd /usr && export PSTACK_A=1');

  await expect(run('pwd; echo "a=$PSTACK_A"', { shell: other })).resolves.toEqual({ exitCode: 0, output: `${dir}\na=\n` });
});

interface Handover {
  moved: MovedCommand[];
  later: string;
  exits: (number | undefined)[];
  take: (moved: MovedCommand) => BackgroundedCommand;
}

function handover(): Handover {
  const record: Handover = {
    moved: [],
    later: '',
    exits: [],
    take: (moved) => {
      record.moved.push(moved);
      return {
        data: (chunk) => {
          record.later += chunk.toString('utf8');
        },
        exit: (exitCode) => record.exits.push(exitCode),
        text: 'moved',
        outputPath: '/terminals/1.txt',
      };
    },
  };
  return record;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const local = createLocalBashOperations({ shellPath: '/bin/bash' });

test('a shell that does not read the host pid leaves the directory unchanged when a command moves to the background', async ({ dir }) => {
  const shell = createSessionShell({ hostPidCwd: false });
  const to = handover();
  onTestFinished(() => {
    const pid = to.moved[0]?.pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // The command already exited.
      }
    }
  });
  const moving = shell.operations(local, to.take).exec(shell.script('cd /usr; echo moved; sleep 30'), dir, { onData: () => {}, timeout: 0.4 });

  await expect(moving).rejects.toMatchObject({ command: { text: 'moved' } });
  expect(shell.cwd()).toBeUndefined();
});

describe('a timeout with somewhere to move the command', () => {
  test('hands over the still-running command with its process and output so far, keeps the directory it reached, and keeps none of its variables', async ({ dir, shell, run }) => {
    const to = handover();
    let output = '';

    const moving = shell.operations(local, to.take).exec(shell.script('cd /usr; export PSTACK_A=1; echo first; sleep 1; echo second'), dir, {
      onData: (bytes) => {
        output += bytes.toString('utf8');
      },
      timeout: 0.5,
    });

    await expect(moving).rejects.toMatchObject({ command: { text: 'moved' } });
    expect(to.moved).toEqual([expect.objectContaining({ waitedMs: 500, output: Buffer.from('first\n') })]);
    expect(alive(to.moved[0]?.pid ?? 0)).toBe(true);
    expect(output).toBe('first\n');
    await expect(run('pwd; echo "a=$PSTACK_A"')).resolves.toEqual({ exitCode: 0, output: '/usr\na=\n' });
    await expect.poll(() => to.exits, { timeout: 5_000 }).toEqual([0]);
    expect(to.later).toBe('second\n');
  });

  test('a foreground cd after the move stays when the background command later exits in another directory', async ({ dir, shell, run }) => {
    // Use sibling dirs under the fixture. /bin and /usr collide on Linux usrmerge (/bin → /usr/bin).
    const away = join(dir, 'away');
    const stay = join(dir, 'stay');
    mkdirSync(away);
    mkdirSync(stay);
    const to = handover();
    const moving = shell.operations(local, to.take).exec(shell.script(`cd ${away}; sleep 1`), dir, { onData: () => {}, timeout: 0.3 });

    await expect(moving).rejects.toMatchObject({ command: { text: 'moved' } });
    await expect(run(`cd ${stay} && pwd`)).resolves.toEqual({ exitCode: 0, output: `${stay}\n` });
    await expect.poll(() => to.exits, { timeout: 5_000 }).toEqual([0]);
    await expect(run('pwd')).resolves.toEqual({ exitCode: 0, output: `${stay}\n` });
  });

  test('a foreground command that does not change directory still lets a later background cd apply', async ({ dir, shell, run }) => {
    const away = join(dir, 'away');
    mkdirSync(away);
    const to = handover();
    const moving = shell.operations(local, to.take).exec(shell.script(`cd ${away}; sleep 1`), dir, { onData: () => {}, timeout: 0.3 });

    await expect(moving).rejects.toMatchObject({ command: { text: 'moved' } });
    await expect(run('echo hi')).resolves.toEqual({ exitCode: 0, output: 'hi\n' });
    await expect.poll(() => to.exits, { timeout: 5_000 }).toEqual([0]);
    await expect(run('pwd')).resolves.toEqual({ exitCode: 0, output: `${away}\n` });
  });

  test('a command whose state report has arrived when the timeout elapses finishes in the foreground and keeps its state', async ({ dir, shell, run }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const to = handover();
    let exited = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exitsAfterTheDeadline: BashOperations = {
      exec: async (command, cwd, options) => {
        const result = await local.exec(command, cwd, options);
        exited = true;
        await gate;
        return result;
      },
    };
    let output = '';

    const finishing = shell.operations(exitsAfterTheDeadline, to.take).exec(shell.script('cd /usr; echo done'), dir, {
      onData: (bytes) => {
        output += bytes.toString('utf8');
      },
      timeout: 100,
    });
    await vi.waitFor(() => expect(exited).toBe(true));
    vi.advanceTimersByTime(100_000);
    release();

    await expect(finishing).resolves.toEqual({ exitCode: 0 });
    vi.useRealTimers();
    expect(to.moved).toEqual([]);
    expect(output).toBe('done\n');
    await expect(run('pwd')).resolves.toEqual({ exitCode: 0, output: '/usr\n' });
  });

  test('aborting the call before the timeout stops the command and hands nothing over', async ({ dir, shell }) => {
    const to = handover();
    const controller = new AbortController();
    let pid = 0;

    const running = shell.operations(local, to.take).exec(shell.script('echo $$; sleep 30'), dir, {
      onData: (bytes) => {
        pid ||= Number.parseInt(bytes.toString('utf8'), 10);
      },
      signal: controller.signal,
      timeout: 20,
    });
    await vi.waitFor(() => expect(pid).toBeGreaterThan(0));
    controller.abort();

    await expect(running).rejects.toThrow('aborted');
    expect(to.moved).toEqual([]);
    expect(alive(pid)).toBe(false);
  });

  test('aborting the call after the hand-off leaves the command running to its end', async ({ dir, shell }) => {
    const to = handover();
    const controller = new AbortController();

    const moving = shell.operations(local, to.take).exec(shell.script('sleep 0.6; echo later'), dir, { onData: () => {}, signal: controller.signal, timeout: 0.3 });
    await expect(moving).rejects.toMatchObject({ command: { text: 'moved' } });
    controller.abort();

    await expect.poll(() => to.exits).toEqual([0]);
    expect(to.later).toBe('later\n');
  });
});

describe('a bash call that sets no timeout', () => {
  const textOf = (result: { content: { type: string; text?: string }[] }) => result.content.map((part) => part.text ?? '').join('');
  const watched = () => {
    const seen = { started: false };
    const ops: BashOperations = {
      exec: (command, cwd, options) =>
        local.exec(command, cwd, {
          ...options,
          onData: (bytes) => {
            seen.started = true;
            options.onData(bytes);
          },
        }),
    };
    return { seen, ops };
  };

  test('moves a command still running after 30 seconds to the background', async ({ dir, shell }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const to = handover();
    const { seen, ops } = watched();
    const bash = sessionBashDefinition(shell, dir, ops, { background: (_ctx, _call, moved) => to.take(moved) });

    const running = bash.execute('call', { command: 'echo first; sleep 3; echo second' }, undefined, undefined, {
      cwd: dir,
      model: undefined,
      sessionManager: { getSessionId: () => 'session', getSessionFile: () => undefined },
    } as unknown as ExtensionToolContext);
    await vi.waitFor(() => expect(seen.started).toBe(true));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(to.moved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(running.then(textOf)).resolves.toBe('moved');
    vi.useRealTimers();
    expect(to.moved).toEqual([expect.objectContaining({ waitedMs: 30_000, output: Buffer.from('first\n') })]);
    await expect.poll(() => to.exits, { timeout: 10_000 }).toEqual([0]);
    expect(to.later).toBe('second\n');
  });

  test('keeps waiting for the command when nothing can take it after 30 seconds', async ({ dir, shell }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { seen, ops } = watched();
    const bash = sessionBashDefinition(shell, dir, ops, { background: () => undefined });

    const running = bash.execute('call', { command: 'echo first; sleep 3; echo second' }, undefined, undefined, {
      cwd: dir,
      model: undefined,
      sessionManager: { getSessionId: () => 'session', getSessionFile: () => undefined },
    } as unknown as ExtensionToolContext);
    await vi.waitFor(() => expect(seen.started).toBe(true));
    await vi.advanceTimersByTimeAsync(30_000);
    vi.useRealTimers();

    await expect(running.then(textOf)).resolves.toBe('first\nsecond\n');
  });
});

describe('a bash timeout copied from a millisecond wait', () => {
  const ctx = (dir: string) =>
    ({
      cwd: dir,
      model: undefined,
      sessionManager: { getSessionId: () => 'session', getSessionFile: () => undefined },
    }) as unknown as ExtensionToolContext;

  test('refuses timeout 30000 instead of waiting 30000 seconds', async ({ dir, shell }) => {
    const controller = new AbortController();
    onTestFinished(() => controller.abort());
    const seen = { started: false };
    const ops: BashOperations = {
      exec: (command, cwd, options) =>
        local.exec(command, cwd, {
          ...options,
          onData: (bytes) => {
            seen.started = true;
            options.onData(bytes);
          },
        }),
    };
    const bash = sessionBashDefinition(shell, dir, ops, { background: () => undefined });

    const running = bash.execute('call', { command: 'sleep 30', timeout: 30000 }, controller.signal, undefined, ctx(dir));
    const outcome = await running.then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain('30000');
    expect((outcome as Error).message).toContain('seconds');
    expect((outcome as Error).message).toContain('milliseconds');
    expect(seen.started).toBe(false);
    const timeoutSchema = bash.parameters.properties.timeout as { description?: string };
    expect(timeoutSchema.description).toContain('seconds');
    expect(timeoutSchema.description).toContain('30000');
  });

  test('a timeout of 60 waits 60 seconds', async ({ dir, shell }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const to = handover();
    const seen = { started: false };
    const ops: BashOperations = {
      exec: (command, cwd, options) =>
        local.exec(command, cwd, {
          ...options,
          onData: (bytes) => {
            seen.started = true;
            options.onData(bytes);
          },
        }),
    };
    const bash = sessionBashDefinition(shell, dir, ops, { background: (_ctx, _call, moved) => to.take(moved) });

    const running = bash.execute('call', { command: 'echo first; sleep 3; echo second', timeout: 60 }, undefined, undefined, ctx(dir));
    await vi.waitFor(() => expect(seen.started).toBe(true));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(to.moved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(running.then((result: { content: { type: string; text?: string }[] }) => result.content.map((part) => part.text ?? '').join(''))).resolves.toBe('moved');
    vi.useRealTimers();
    expect(to.moved).toEqual([expect.objectContaining({ waitedMs: 60_000 })]);
    await expect.poll(() => to.exits, { timeout: 10_000 }).toEqual([0]);
  });
});
