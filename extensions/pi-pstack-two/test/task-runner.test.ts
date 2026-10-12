import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../src/paths.ts';
import { childArgs, resolveAttachments, startChild, validateAgentId } from '../src/task/runner.ts';

const FAKE_PI = join(PACKAGE_ROOT, 'test/fixtures/fake-pi.mjs');
const base = { sessionDir: '/state/subagents', agentId: '11111111-2222-4333-8444-555555555555' };

describe('childArgs (SEC-001, TASK-008)', () => {
  test('always runs one JSON session per agent ID with this package loaded', () => {
    expect(childArgs(base)).toEqual(['--mode', 'json', '--session-dir', '/state/subagents', '--session-id', base.agentId, '-e', PACKAGE_ROOT]);
  });

  test('adds trust, model, thinking, readonly tools, and attachments in that order', () => {
    expect(childArgs({ ...base, trusted: true, model: { provider: 'p', id: 'm', thinking: 'high' }, readonly: true, attachments: ['/w/a.png', '/w/b.txt'] })).toEqual([
      '--mode',
      'json',
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
      'read,grep,find,ls,TodoWrite',
      '--no-mcp',
      '@/w/a.png',
      '@/w/b.txt',
    ]);
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

function run(mode: string, prompt = 'hello', signal?: AbortSignal) {
  return startChild({ command: [process.execPath, FAKE_PI], args: ['--x', 'y'], prompt, cwd: tmpdir(), env: { ...process.env, FAKE_PI_MODE: mode }, ...(signal ? { signal } : {}) });
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
  test('sends the prompt on stdin and returns the final assistant text with summed usage', async () => {
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
});
