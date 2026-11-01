import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../src/paths.ts';
import { childArgs, resolveAttachments, startChild, validateAgentId, withAttachments } from '../src/task/runner.ts';

const FAKE_PI = join(PACKAGE_ROOT, 'test/fixtures/fake-pi.mjs');
const base = { sessionDir: '/state/subagents', agentId: '11111111-2222-4333-8444-555555555555' };

describe('childArgs (SEC-001, TASK-008)', () => {
  test('always runs one RPC session per agent ID with this package loaded, so its owner can steer and stop it (C-H4)', () => {
    expect(childArgs(base)).toEqual(['--mode', 'rpc', '--session-dir', '/state/subagents', '--session-id', base.agentId, '-e', PACKAGE_ROOT]);
  });

  test('adds trust, model, thinking, and readonly tools in that order', () => {
    expect(childArgs({ ...base, trusted: true, model: { provider: 'p', id: 'm', thinking: 'high' }, readonly: true })).toEqual([
      '--mode',
      'rpc',
      '--session-dir',
      '/state/subagents',
      '--session-id',
      base.agentId,
      '-e',
      PACKAGE_ROOT,
      '--approve',
      '--model',
      'p/m',
      '--thinking',
      'high',
      '--tools',
      'read,grep,find,ls,bash,TodoWrite',
      '--no-mcp',
    ]);
  });
});

test('a writable launch adds back the tools a plan-mode launch took; a readonly one never does (C-M1)', () => {
  expect([childArgs({ ...base, restoreTools: ['edit', 'write'] }).slice(-2), childArgs({ ...base, readonly: true, restoreTools: ['edit'] }).includes('+edit')]).toEqual([['--tools', '+edit,+write'], false]);
});

describe('attachments (TASK-016)', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'attach-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('builds the message Pi builds from @file arguments: the prompt, each text file in a <file> block, images as attachments', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
    writeFileSync(join(dir, 'note.txt'), '\uFEFFhello\n');
    writeFileSync(join(dir, 'empty.txt'), '');
    writeFileSync(join(dir, 'shot.png'), png);
    const input = await withAttachments('  look at these\n', [join(dir, 'note.txt'), join(dir, 'empty.txt'), join(dir, 'shot.png')]);
    expect(input).toEqual({
      text: `look at these<file name="${join(dir, 'note.txt')}">\nhello\n\n</file>\n<file name="${join(dir, 'shot.png')}"></file>\n`,
      images: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }],
    });
    await expect(withAttachments('plain', [])).resolves.toEqual({ text: 'plain', images: [] });
  });

  test('uses Pi detectSupportedImageMimeTypeFromFile rules so a truncated BM prefix is treated as text', async () => {
    writeFileSync(join(dir, 'fake.bmp'), 'BM-not-a-bitmap');
    const input = await withAttachments('check', [join(dir, 'fake.bmp')]);
    expect(input).toEqual({
      text: `check<file name="${join(dir, 'fake.bmp')}">\nBM-not-a-bitmap\n</file>\n`,
      images: [],
    });
  });
});

describe('input validation (SEC-001, TASK-016)', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'attach-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test.for(['../escape', '', 'a/b', '-flag', 'x'.repeat(200)])('rejects the agent ID %j', (id) => {
    expect(() => validateAgentId(id)).toThrow('is not a valid agent ID');
  });

  test('accepts a UUID agent ID', () => {
    expect(validateAgentId(base.agentId)).toBe(base.agentId);
  });

  test('passes the parent project trust decision on (review r2: security)', () => {
    expect([childArgs({ ...base, trusted: true }).includes('--approve'), childArgs({ ...base, trusted: false }).includes('--no-approve')]).toEqual([true, true]);
  });

  test('rejects a directory attachment and expands ~ as Pi read paths do (review r2: security 4)', () => {
    mkdirSync(join(dir, 'adir'));
    mkdirSync(join(dir, 'home'));
    writeFileSync(join(dir, 'home/x.txt'), 'x');
    expect(() => resolveAttachments(['adir'], dir)).toThrow(`file_attachments: ${join(dir, 'adir')} is not a file`);
    expect(resolveAttachments(['~/x.txt'], dir, join(dir, 'home'))).toEqual([join(dir, 'home/x.txt')]);
  });

  test('resolves attachments against the working directory and rejects missing files', () => {
    writeFileSync(join(dir, 'shot.png'), 'png');
    expect(resolveAttachments(['shot.png', join(dir, 'shot.png')], dir)).toEqual([join(dir, 'shot.png'), join(dir, 'shot.png')]);
    expect(() => resolveAttachments(['missing.png'], dir)).toThrow(`file_attachments: ${join(dir, 'missing.png')} does not exist`);
  });
});

function run(mode: string, prompt = 'hello', signal?: AbortSignal, onEvent?: (event: { type: string }) => void) {
  return startChild({ command: [process.execPath, FAKE_PI], args: ['--x', 'y'], prompt, cwd: tmpdir(), env: { ...process.env, FAKE_PI_MODE: mode }, ...(signal ? { signal } : {}), ...(onEvent ? { onEvent } : {}) });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function eventually(check: () => boolean, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return check();
}

describe('startChild', () => {
  test('sends the prompt as an RPC prompt and returns the final assistant text with summed usage', async () => {
    const outcome = await run('echo', 'line one\n"quoted" $HOME').done;
    expect(outcome.finalText).toBe('GOT:line one\n"quoted" $HOME|ARGS:--x y');
    expect(outcome.usage).toEqual({ input: 20, output: 10, cacheRead: 2, cacheWrite: 4, totalTokens: 36, cost: { input: 0.2, output: 0.4, cacheRead: 0, cacheWrite: 0, total: 0.6 } });
    expect(outcome.failure).toBeUndefined();
  });

  test('a command that cannot start has no pid and fails clearly (review recheck: no record for a child that never ran)', async () => {
    const handle = startChild({ command: [join(tmpdir(), 'no-such-pi-binary')], args: [], prompt: 'x', cwd: tmpdir(), env: process.env });
    expect(handle.pid).toBeUndefined();
    expect((await handle.done).failure).toBe(`could not start pi: spawn ${join(tmpdir(), 'no-such-pi-binary')} ENOENT`);
  });

  test('a child that exits without reading a large prompt fails cleanly instead of crashing Pi (review r2: security 1)', async () => {
    const handle = startChild({ command: [process.execPath, '-e', 'process.exit(3)'], args: [], prompt: 'x'.repeat(4 * 1024 * 1024), cwd: tmpdir(), env: process.env });
    expect((await handle.done).failure).toBe('pi exited with code 3:');
  });

  test('an abort before the child reads its prompt does not crash Pi (review r2: security 1)', async () => {
    const controller = new AbortController();
    controller.abort();
    const handle = startChild({ command: [process.execPath, FAKE_PI], args: [], prompt: 'x'.repeat(4 * 1024 * 1024), cwd: tmpdir(), env: { ...process.env, FAKE_PI_MODE: 'hang' }, signal: controller.signal });
    expect((await handle.done).failure).toBe('Subagent was aborted');
  });

  test("counts the child's tool-result and compaction usage, as Pi's session totals do (review r2: architecture 2)", async () => {
    const { usage } = await run('nested').done;
    expect([usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens]).toEqual([40, 20, 4, 8, 72]);
    expect(usage.cost.total).toBeCloseTo(1.2);
  });

  test('ignores a stdout line that is not JSON instead of crashing the parent (SEC-001)', async () => {
    const outcome = await run('noise').done;
    expect([outcome.finalText, outcome.failure]).toEqual(['after noise', undefined]);
  });

  test('reports an error stop reason as a failure (TASK-015)', async () => {
    const outcome = await run('error').done;
    expect(outcome.failure).toBe('provider exploded');
  });

  test('reports a nonzero exit with stderr as a failure (TASK-015)', async () => {
    const outcome = await run('crash').done;
    expect(outcome.failure).toBe('pi exited with code 3: fatal: no model');
  });

  test('abort kills the child and its descendants (TASK-013)', async () => {
    const controller = new AbortController();
    const pids: number[] = [];
    const handle = startChild({
      command: [process.execPath, FAKE_PI],
      args: [],
      prompt: 'x',
      cwd: tmpdir(),
      env: { ...process.env, FAKE_PI_MODE: 'hang' },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'fake_pids') pids.push(...(event['pids'] as number[]));
      },
    });
    expect(await eventually(() => pids.length === 2)).toBe(true);
    controller.abort();
    const outcome = await handle.done;
    expect(outcome.failure).toBe('Subagent was aborted');
    expect(await eventually(() => pids.every((pid) => !alive(pid)))).toBe(true);
  });

  test('kill() stops a running child for session shutdown (TASK-013)', async () => {
    const pids: number[] = [];
    const handle = startChild({
      command: [process.execPath, FAKE_PI],
      args: [],
      prompt: 'x',
      cwd: tmpdir(),
      env: { ...process.env, FAKE_PI_MODE: 'hang' },
      onEvent: (event) => {
        if (event.type === 'fake_pids') pids.push(...(event['pids'] as number[]));
      },
    });
    expect(await eventually(() => pids.length === 2)).toBe(true);
    handle.kill();
    expect((await handle.done).failure).toBe('Subagent was aborted');
    expect(await eventually(() => pids.every((pid) => !alive(pid)))).toBe(true);
  });

  test('sends attachment images with the prompt', async () => {
    const outcome = await startChild({ command: [process.execPath, FAKE_PI], args: [], prompt: 'see', images: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }], cwd: tmpdir(), env: { ...process.env, FAKE_PI_MODE: 'echo' } }).done;
    expect(outcome.finalText).toBe('GOT:see|IMAGES:image/png|ARGS:');
  });

  test('answers a dialog request as dismissed, since nobody can answer a subagent (HOST-005)', async () => {
    const outcome = await run('dialog').done;
    expect(JSON.parse(outcome.finalText.slice('ANSWER:'.length))).toEqual({ type: 'extension_ui_response', id: 'dialog-1', cancelled: true });
  });
});

describe('steer and stop (C-H4)', () => {
  const started = (mode: string) => {
    let begun: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      begun = resolve;
    });
    const handle = run(mode, 'first', undefined, (event) => {
      if (event.type === 'agent_start') begun();
    });
    return { handle, running };
  };

  test('steer delivers a message into the running turn, and the agent finishes with it', async () => {
    const { handle, running } = started('wait');
    await running;
    await handle.steer('change course', []);
    const outcome = await handle.done;
    expect([outcome.finalText, outcome.failure]).toEqual(['STEERED:change course|steer', undefined]);
  });

  test('steer refuses once the agent has finished', async () => {
    const handle = run('echo');
    await handle.done;
    await expect(handle.steer('too late', [])).rejects.toThrow('has finished');
  });

  test('stop aborts the run over RPC and the child exits', async () => {
    const { handle, running } = started('wait');
    await running;
    handle.stop();
    const outcome = await handle.done;
    expect(outcome.failure).toBe('Subagent was stopped with stop_agent');
  });

  test('stop kills a child that ignores the abort after the grace period', async () => {
    const { handle, running } = started('deaf');
    await running;
    const before = Date.now();
    handle.stop();
    const outcome = await handle.done;
    expect([outcome.failure, Date.now() - before >= 2_500]).toEqual(['Subagent was stopped with stop_agent', true]);
  });
});
