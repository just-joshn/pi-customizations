import { describe, expect, test } from 'vitest';
import { runArgsCommand, runShellCommand, runStdinCommand } from '../src/run-command.ts';

const LONG_COMMAND = 'sleep 30';
const LONG_ARGS: readonly string[] = [process.execPath, '-e', 'setTimeout(() => {}, 30000)'];

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
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
