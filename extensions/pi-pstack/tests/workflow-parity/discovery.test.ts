import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawnSync: vi.fn(() => ({ stdout: 'host ready operator receipt operator receipt', status: 0 })),
}));

import { interactionFamily } from './families/interaction.ts';
import { babysitRestartFamily } from './families/pr-babysit-restart.ts';
import { evaluate } from './lib/check.ts';
import type { Ctx, DriveApi } from './lib/driver.ts';
import type { RunView, Session } from './lib/view.ts';

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
  const state = (value: object) => {
    writeFileSync(join(dir, 'state.json'), JSON.stringify(value));
    if ('phase' in value && value.phase === 'running' && 'tmuxSession' in value) {
      mkdirSync(join(dir, 'session'), { recursive: true });
      writeFileSync(
        join(dir, 'session/worker.jsonl'),
        [
          { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'PANE-PROMPT-7f3a' }] } },
          { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'long', name: 'bash', arguments: { command: 'sleep 6' } }] } },
        ]
          .map((entry) => JSON.stringify(entry))
          .join('\n'),
      );
    }
  };
  writeFileSync(join(dir, 'assignment.json'), JSON.stringify({ kind: 'general' }));
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
  const decoy = join(api.ctx.repo, '.pi/pstack/runs/swarm-chat/workers/watch-decoy');
  mkdirSync(decoy, { recursive: true });
  writeFileSync(join(decoy, 'assignment.json'), JSON.stringify({ kind: 'watch' }));
  writeFileSync(join(decoy, 'state.json'), JSON.stringify({ phase: 'running', tmuxSession: 'watch-pane' }));
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
  expect(spawnSync).toHaveBeenCalledWith('tmux', expect.arrayContaining(['prompt PANE-PROMPT-7f3a Run exactly this long command before answering: sleep 6']), expect.anything());
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

test('interaction rejects ambiguous pane candidates by name', async () => {
  const { api, state } = setup();
  state({ phase: 'idle', tmuxSession: 'pane-one', settles: [{ phase: 'idle' }] });
  const dir = join(api.ctx.repo, '.pi/pstack/runs/other/workers/w2');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ phase: 'idle', tmuxSession: 'pane-two', settles: [{ phase: 'idle' }] }));
  writeFileSync(join(dir, 'assignment.json'), '{}');
  assert(interactionFamily.spec.drive);
  await expect(interactionFamily.spec.drive(api)).rejects.toThrow(/ambiguous.*(?:w1.*w2|w2.*w1)/);
});

test('restart rejects a second watcher before restarting', async () => {
  const { api, state } = setup();
  state({ kind: 'watch', phase: 'running', output: '{"kind":"check"}' });
  const dir = join(api.ctx.repo, '.pi/pstack/runs/other/workers/w2');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ kind: 'watch', phase: 'running', output: '{"kind":"check"}' }));
  writeFileSync(join(dir, 'assignment.json'), JSON.stringify({ kind: 'watch' }));
  assert(babysitRestartFamily.spec.drive);
  await expect(babysitRestartFamily.spec.drive(api)).rejects.toThrow(/ambiguous.*(?:w1.*w2|w2.*w1)/);
  expect(api.restart).not.toHaveBeenCalled();
});

test('restart holds a parent-chosen watcher name', () => {
  expect(babysitRestartFamily.spec.holdWatchers?.test('parent-chosen-watch')).toBe(true);
});

function interactionView(): RunView {
  const session: Session = {
    file: '',
    cwd: null,
    models: [],
    errors: [],
    errorTimes: [],
    messages: [
      { order: 1, role: 'user', text: 'PANE-PROMPT-7f3a Run exactly this long command before answering: sleep 6' },
      { order: 3, role: 'user', text: 'PANE-STEER-91bc' },
      { order: 4, role: 'assistant', text: 'handled the typed steer' },
    ],
    toolCalls: [{ order: 2, name: 'bash', args: { command: 'sleep 6' }, resultText: '', isError: false }],
  };
  return {
    family: 'worker-interaction',
    driver: 'real',
    repo: '',
    sandbox: '',
    base: '',
    models: null,
    parent: session,
    plans: [],
    todoHistory: {},
    claims: [],
    pkg: '',
    prompt: '',
    git: { head: '', dirty: [], commitsSinceBase: [], branches: [], worktrees: [], branchCommits: {}, worktreeDirty: {} },
    runs: [
      {
        id: 'parent-chosen-run',
        dir: '',
        runJson: null,
        todoText: null,
        steps: [],
        decisions: null,
        events: [],
        receipts: [],
        workers: [{ id: 'parent-chosen-worker', dir: '', assignment: {}, brief: null, state: { tmuxSession: 'actual-pane' }, report: null, session, worktree: null, evidenceFiles: [], finalText: '' }],
      },
    ],
  };
}

for (const suffix of ['typed-prompt-reaches-the-transcript', 'typed-steer-lands-mid-run']) {
  test(`${suffix} follows the discovered worker and rejects a decoy long command`, () => {
    const view = interactionView();
    const check = interactionFamily.checks.find((entry) => entry.id.endsWith(suffix));
    assert(check);
    expect(check.run(view)).toMatchObject({ ok: true });
    const session = view.runs[0]?.workers[0]?.session;
    assert(session);
    const command = session.toolCalls[0];
    assert(command);
    session.toolCalls.unshift({ order: 0, name: 'bash', args: { command: 'sleep 6' }, resultText: '', isError: false });
    command.args['command'] = 'echo not-the-long-command';
    expect(check.run(view)).toMatchObject({ ok: false });
  });
}

test('interaction negatives mutate the discovered worker rather than the scripted name', () => {
  const { api } = setup();
  const view = interactionView();
  const dir = join(api.ctx.sandbox, 'repo/.pi/pstack/runs/parent-chosen-run/workers/parent-chosen-worker/session');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'worker.jsonl');
  for (const [index, marker] of ['PANE-PROMPT-7f3a', 'PANE-STEER-91bc', 'PARENT-STEER-55de'].entries()) {
    writeFileSync(file, marker);
    const negative = interactionFamily.negatives[index];
    assert(negative);
    negative.mutate(api.ctx.sandbox, view);
    expect(readFileSync(file, 'utf8')).toBe('nothing');
  }
});

test('typed steer must follow command start and precede the answer', () => {
  const view = interactionView();
  const check = interactionFamily.checks.find((entry) => entry.id.endsWith('typed-steer-lands-mid-run'));
  const steer = view.runs[0]?.workers[0]?.session?.messages[1];
  assert(check && steer);
  steer.order = 1;
  expect(check.run(view)).toMatchObject({ ok: false });
  steer.order = 5;
  expect(check.run(view)).toMatchObject({ ok: false });
});

test('restart checks bind adoption and the exit wake to the discovered run and instance', () => {
  const view = interactionView();
  const run = view.runs[0];
  const watcher = run?.workers[0];
  assert(run && watcher);
  watcher.assignment['kind'] = 'watch';
  watcher.state = { kind: 'watch', instance: 'actual-instance', exit: { code: 0 }, settles: [{ phase: 'exited' }] };
  view.claims = [{ runId: run.id, workerId: watcher.id, seq: 1 }];
  view.parent = {
    ...view.parent,
    messages: [
      { order: 1, role: 'user', text: 'first request' },
      { order: 3, role: 'user', text: 'resumed request' },
      { order: 5, role: 'custom', text: 'READY', customType: 'pstack-worker', details: { runId: run.id, workerId: watcher.id, transitionId: `${watcher.id}:actual-instance:1`, phase: 'exited' } },
    ],
    toolCalls: [
      { order: 2, name: 'pstack_worker', args: { action: 'spawn', runId: run.id }, resultText: '', isError: false },
      { order: 4, name: 'pstack_worker', args: { action: 'inspect', runId: run.id, workerId: watcher.id }, resultText: 'running {"kind":"check"}', isError: false },
      { order: 6, name: 'pstack_worker', args: { action: 'collect', runId: run.id, workerId: watcher.id }, resultText: '', isError: false },
    ],
  };
  const adoption = babysitRestartFamily.checks.find((entry) => entry.id.endsWith('the-live-watcher-was-adopted-and-no-second-one-armed'));
  const exit = babysitRestartFamily.checks.find((entry) => entry.id.endsWith('the-watcher-exit-woke-the-restarted-parent-once'));
  const claim = view.claims[0];
  const wake = view.parent.messages[2];
  assert(adoption && exit && claim && wake?.details);
  expect(adoption.run(view)).toMatchObject({ ok: true });
  expect(exit.run(view)).toMatchObject({ ok: true });
  claim.runId = 'other-run';
  expect(adoption.run(view)).toMatchObject({ ok: false });
  wake.details['runId'] = 'other-run';
  expect(exit.run(view)).toMatchObject({ ok: false });
  wake.details['runId'] = run.id;
  wake.details['transitionId'] = `${watcher.id}:wrong-instance:1`;
  expect(exit.run(view)).toMatchObject({ ok: false });
});

test('interaction selection ignores a noninteractive watch pane', () => {
  const view = interactionView();
  const run = view.runs[0];
  const selected = run?.workers[0];
  assert(run && selected);
  run.workers.push({ ...selected, id: 'watch-decoy', assignment: { kind: 'watch' } });
  const check = interactionFamily.checks.find((entry) => entry.id.endsWith('typed-prompt-reaches-the-transcript'));
  assert(check);
  expect(check.run(view)).toMatchObject({ ok: true });
});

for (const family of [interactionFamily, babysitRestartFamily]) {
  test(`${family.id} checker rejects ambiguous candidates with their names`, () => {
    const view = interactionView();
    const run = view.runs[0];
    const selected = run?.workers[0];
    assert(run && selected);
    if (family === babysitRestartFamily) selected.assignment['kind'] = 'watch';
    run.workers.push({ ...selected, id: 'second-candidate' });
    const check = family.checks.find((entry) => entry.id.endsWith(family === interactionFamily ? 'typed-prompt-reaches-the-transcript' : 'the-live-watcher-was-adopted-and-no-second-one-armed'));
    assert(check);
    expect(evaluate([check], view)).toEqual([expect.objectContaining({ verdict: 'FAIL', evidence: expect.stringMatching(/candidates:.*parent-chosen-worker.*second-candidate/) })]);
  });

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
