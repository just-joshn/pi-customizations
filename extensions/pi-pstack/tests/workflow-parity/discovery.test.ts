import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawnSync: vi.fn(() => ({ stdout: 'host ready operator receipt operator receipt', status: 0 })),
}));

import { interactionFamily } from './families/interaction.ts';
import { babysitRestartFamily } from './families/pr-babysit-restart.ts';
import type { Ctx, DriveApi } from './lib/driver.ts';

const sandboxes: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { api: DriveApi; state: (value: object) => void } {
  const sandbox = mkdtempSync(join(tmpdir(), 'parity-discovery-'));
  sandboxes.push(sandbox);
  const dir = join(sandbox, '.pi/pstack/runs/swarm-chat/workers/w1');
  const sessionsDir = join(sandbox, 'sessions');
  mkdirSync(dir, { recursive: true });
  mkdirSync(sessionsDir);
  const forge = join(sandbox, 'forge/origin.git/forge');
  mkdirSync(forge, { recursive: true });
  writeFileSync(join(forge, 'state.json'), JSON.stringify({ prs: { '71': { checks: [] } } }));
  const state = (value: object) => writeFileSync(join(dir, 'state.json'), JSON.stringify(value));
  writeFileSync(join(dir, 'assignment.json'), JSON.stringify({ kind: 'watch' }));
  const api: DriveApi = {
    ctx: { repo: sandbox, sandbox, sessionsDir } as Ctx,
    socket: 'discovery-test',
    events: () => [],
    request: vi.fn(async (command) => {
      if (command['type'] === 'get_state') return { success: true, data: { isStreaming: true } };
      return { success: true };
    }),
    restart: vi.fn(async () => {}),
    prompt: vi.fn(async () => {
      writeFileSync(join(sessionsDir, 'parent.jsonl'), 'Worker w1: running\n{"kind":"check"}');
    }),
    finding: vi.fn(),
  };
  return { api, state };
}

test('interaction operator discovers a different run and worker from persisted state', async () => {
  vi.useFakeTimers();
  const { api, state } = setup();
  state({ phase: 'idle', tmuxSession: 'actual-pane', settles: [{ phase: 'idle' }] });
  assert(interactionFamily.spec.drive);
  const drive = interactionFamily.spec.drive(api);
  const completed = drive.then(
    () => null,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(0);
  state({ phase: 'running', tmuxSession: 'actual-pane', settles: [{ phase: 'idle' }] });
  await vi.advanceTimersByTimeAsync(100);
  await vi.runAllTimersAsync();
  expect(await completed).toBeNull();
  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'steer' }));
  expect(spawnSync).toHaveBeenCalledWith('tmux', expect.arrayContaining(['-t', 'actual-pane']), expect.anything());
});

test('restart hook discovers and inspects a differently named live watcher', async () => {
  vi.useFakeTimers();
  const { api, state } = setup();
  assert(babysitRestartFamily.spec.drive);
  const drive = babysitRestartFamily.spec.drive(api);
  const completed = drive.then(
    () => null,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(api.restart).not.toHaveBeenCalled();
  state({ kind: 'watch', phase: 'running', output: '{"kind":"check"}' });
  await vi.runAllTimersAsync();
  expect(await completed).toBeNull();
  expect(api.restart).toHaveBeenCalledOnce();
  expect(api.finding).not.toHaveBeenCalled();
});

for (const family of [interactionFamily, babysitRestartFamily]) {
  test(`${family.id} missing state fails without restarting`, async () => {
    vi.useFakeTimers();
    const { api } = setup();
    assert(family.spec.drive);
    const drive = family.spec.drive(api);
    const rejected = expect(drive).rejects.toThrow(/timed out/);
    await vi.runAllTimersAsync();
    await rejected;
    expect(api.restart).not.toHaveBeenCalled();
  });
}
