import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, onTestFinished, test } from 'vitest';
import { runArgsCommand, runShellCommand, runStdinCommand } from '../src/run-command.ts';

const LONG_COMMAND = 'sleep 30';
const LONG_ARGS: readonly string[] = [process.execPath, '-e', 'setTimeout(() => {}, 30000)'];

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    if (existsSync(path)) return true;
    await delay(25);
  }
  return existsSync(path);
}

describe('runShellCommand', () => {
  test('returns the merged output of a completed command', async () => {
    const [code, output] = await runShellCommand('echo out', undefined, undefined);
    expect(code).toBe(0);
    expect(output).toBe('out\n');
  });

  test('resolves with a non-zero status when the signal aborted first', async () => {
    const [code] = await runShellCommand(LONG_COMMAND, undefined, abortedSignal());
    expect(code).not.toBe(0);
  });

  test('kills the command when the signal aborts during the run', async () => {
    const controller = new AbortController();
    const pending = runShellCommand(LONG_COMMAND, undefined, controller.signal);
    controller.abort();
    const [code] = await pending;
    expect(code).not.toBe(0);
  });

  test.skipIf(process.platform === 'win32')('kills the running grandchild so it cannot outlive the abort', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-maintainer-abort-'));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const started = join(dir, 'started');
    const survived = join(dir, 'survived');
    const controller = new AbortController();
    const pending = runShellCommand(`sh -c 'sleep 1; touch ${survived}' & touch ${started}; wait`, undefined, controller.signal);
    expect(await waitForFile(started, 3000)).toBe(true);
    controller.abort();
    const [code] = await pending;
    expect(code).not.toBe(0);
    await delay(1500);
    expect(existsSync(survived)).toBe(false);
  });
});

describe('runArgsCommand', () => {
  test('keeps stdout and stderr separate for a completed command', async () => {
    const outcome = await runArgsCommand([process.execPath, '-e', 'process.stdout.write("ok")'], undefined, undefined);
    expect(outcome.stdout).toBe('ok');
    expect(outcome.stderr).toBe('');
    expect(outcome.code).toBe(0);
  });

  test('resolves with a non-zero status when the signal aborted first', async () => {
    const outcome = await runArgsCommand(LONG_ARGS, undefined, abortedSignal());
    expect(outcome.code).not.toBe(0);
    expect(outcome.spawnError).toBeUndefined();
  });

  test('kills the command when the signal aborts during the run', async () => {
    const controller = new AbortController();
    const pending = runArgsCommand(LONG_ARGS, undefined, controller.signal);
    controller.abort();
    const outcome = await pending;
    expect(outcome.code).not.toBe(0);
  });
});

describe('runStdinCommand', () => {
  test('feeds stdin and returns the output for a completed command', async () => {
    const outcome = await runStdinCommand(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], 'piped', undefined, undefined);
    expect(outcome.stdout).toBe('piped');
    expect(outcome.code).toBe(0);
  });

  test('resolves with a non-zero status when the signal aborted first', async () => {
    const outcome = await runStdinCommand(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], '', undefined, abortedSignal());
    expect(outcome.code).not.toBe(0);
  });
});
