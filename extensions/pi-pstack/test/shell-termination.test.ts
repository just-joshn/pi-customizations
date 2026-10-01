import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { ShellRuntime } from '../src/shell-runtime.ts';

const pi = { sendMessage: () => {}, on: () => {}, events: { emit: () => {}, on: () => () => {} } } as never;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function children(pid: number): number[] {
  try {
    return execFileSync('pgrep', ['-P', String(pid)])
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

async function shellContext() {
  const cwd = await mkdtemp(join(tmpdir(), 'pstack-shell-term-'));
  return { cwd, ctx: { cwd, sessionManager: { getSessionFile: () => null }, isIdle: () => true } as never };
}

test('a shell that ignores SIGTERM is SIGKILLed after the 1.5s grace', async () => {
  const runtime = new ShellRuntime(pi);
  const { cwd, ctx } = await shellContext();
  const record = await runtime.start({ command: "trap '' TERM; sleep 30", title: 'stubborn' }, ctx);
  try {
    await vi.waitFor(() => expect(children(record.pid)).toHaveLength(1));
    const started = Date.now();
    expect((await runtime.stop(record.id)).status).toEqual({ kind: 'stopped' });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1500);
    expect(elapsed).toBeLessThan(2000);
    expect(alive(record.pid)).toBe(false);
  } finally {
    await runtime.stopAll();
    await rm(dirname(record.outputFile), { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}, 20000);

test('a descendant that left the process group is killed by the descendant backstop', async () => {
  const runtime = new ShellRuntime(pi);
  const { cwd, ctx } = await shellContext();
  const record = await runtime.start({ command: `perl -MPOSIX -e 'POSIX::setsid(); sleep 300' & sleep 30`, title: 'escape' }, ctx);
  let escaped: number | undefined;
  try {
    await vi.waitFor(
      () => {
        escaped = children(record.pid).find(
          (pid) =>
            execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)])
              .toString()
              .trim() !== String(record.pid),
        );
        expect(escaped).toBeDefined();
      },
      { timeout: 5000, interval: 50 },
    );
    expect((await runtime.stop(record.id)).status).toEqual({ kind: 'stopped' });
    await vi.waitFor(() => expect(alive(escaped ?? 0)).toBe(false));
  } finally {
    if (escaped !== undefined && alive(escaped)) process.kill(escaped, 'SIGKILL');
    await runtime.stopAll();
    await rm(dirname(record.outputFile), { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}, 20000);
