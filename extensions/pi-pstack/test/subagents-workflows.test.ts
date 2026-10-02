import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { rpcChannel, rpcResultChannel } from '../src/subagents/rpc.ts';
import type { WorkflowLimits } from '../src/subagents/settings.ts';
import { checkLimits, effectiveLimits, overCredits } from '../src/subagents/workflows/limits.ts';
import { WorkflowRuntime, workflowsEnabled } from '../src/subagents/workflows/runtime.ts';
import { Slots } from '../src/subagents/workflows/slots.ts';
import { type Change, WorkflowStore, workflowEntryType } from '../src/subagents/workflows/store.ts';
import { defineWorkflow, type WorkflowDeclaration, WorkflowPause } from '../src/subagents/workflows/types.ts';
import { workerFixture } from './worker-fixture.ts';

const limits: WorkflowLimits = { maxConcurrentSubagents: 2, maxTotalSubagents: 3, timeoutSeconds: 60, maxAiCredits: 2 };
const consumption = (subagents: number, credits: number, startedAt = 1000) => ({ subagents, credits, startedAt, elapsedSeconds: 0 });

test.for([
  { name: 'a fresh run passes', subagents: 0, credits: 0, now: 2000, expected: true },
  { name: 'the total limit stops admission', subagents: 3, credits: 0, now: 2000, expected: 'total' },
  { name: 'the timeout stops the next step', subagents: 0, credits: 0, now: 61_000, expected: 'time' },
])('$name', ({ subagents, credits, now, expected }) => {
  const verdict = checkLimits({ effectiveLimits: limits, consumption: consumption(subagents, credits) }, now);
  expect(verdict.ok ? true : verdict.kind).toBe(expected);
});

test('a soft credit ceiling only bites after the paying turn settles', () => {
  expect(checkLimits({ effectiveLimits: limits, consumption: consumption(1, 3) }, 2000)).toEqual({ ok: true });
  const over = overCredits({ effectiveLimits: limits, consumption: consumption(1, 2.5) });
  expect(over && !over.ok ? over.kind : 'within').toBe('credits');
  expect(overCredits({ effectiveLimits: limits, consumption: consumption(1, 2) })).toBeUndefined();
});

test('effective limits layer per run over declared over configured defaults', () => {
  const defaults: WorkflowLimits = { maxConcurrentSubagents: 9, maxTotalSubagents: 9 };
  expect(effectiveLimits({ declaration: {}, defaults })).toEqual({ ...defaults, maxAiCredits: 5, timeoutSeconds: 1800 });
  expect(effectiveLimits({ declaration: { limits: { maxTotalSubagents: 1 } }, defaults })).toEqual({ maxConcurrentSubagents: 9, maxTotalSubagents: 1, maxAiCredits: 5, timeoutSeconds: 1800 });
  expect(effectiveLimits({ declaration: {}, overrides: { maxAiCredits: 0.5 }, defaults })).toMatchObject({ maxAiCredits: 0.5 });
});

test.for([
  { name: 'ok-name', description: 'd', error: undefined },
  { name: 'Bad Name', description: 'd', error: "Invalid workflow name 'Bad Name'. Use lowercase letters, digits and hyphens." },
  { name: 'ok-name', description: ' ', error: "Workflow 'ok-name' needs a description." },
])('defineWorkflow validates $name and its description', ({ name, description, error }) => {
  const build = () => defineWorkflow({ name, description, run: async () => 1 });
  if (error === undefined) expect(build().name).toBe(name);
  else expect(build).toThrow(error);
});

test('a pause carries its checkpoint key', () => {
  expect(new WorkflowPause('gate').key).toBe('gate');
});

test('workflows need the dynamic workflows switch', () => {
  expect(workflowsEnabled({})).toBe(false);
  expect(workflowsEnabled({ COPILOT_DYNAMIC_WORKFLOWS: '1' })).toBe(true);
  expect(workflowsEnabled({ COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'dynamic_workflows' })).toBe(true);
});

function journaledStore() {
  const entries: { type: string; customType: string; data: Change }[] = [];
  const store = new WorkflowStore((change) => entries.push({ type: 'custom', customType: workflowEntryType, data: change }));
  return { store, entries };
}

function restoredFrom(entries: readonly { type: string; customType: string; data: Change }[]): WorkflowStore {
  const store = new WorkflowStore(() => {});
  store.restore(entries);
  return store;
}

test('the store claims pending runs, settles, and rebuilds every run from the session entries', () => {
  const { store, entries } = journaledStore();
  const created = store.create('build', { limits }, { a: 1 }, {}, {}, 1000);
  expect(store.claim(created.id, 1, 1000)).toMatchObject({ status: 'running', ownerEpoch: 1 });
  expect(store.claim(created.id, 1, 1001)).toBeUndefined();
  store.log(created.id, 'Phase verify.', 'verify');
  store.putJournal(created.id, 'step', 'kept');
  store.settle(created.id, 1, { status: 'completed', result: 7 });
  const restored = restoredFrom(entries);
  expect(restored.get(created.id)).toMatchObject({ status: 'completed', result: 7, arguments: { a: 1 }, logs: ['Phase verify.'], phases: ['verify'] });
  expect(restored.journalOf(created.id)).toEqual({ step: 'kept' });
  expect(restored.journalOf('nothing')).toEqual({});
});

test('a run snapshot never repeats the logs the log entries already carry', () => {
  const { store, entries } = journaledStore();
  const created = store.create('build', { limits }, undefined, {}, {}, 1000);
  store.claim(created.id, 1, 1000);
  store.log(created.id, 'one');
  store.log(created.id, 'two');
  store.settle(created.id, 1, { status: 'completed' });
  const snapshots = entries.flatMap((entry) => (entry.data.kind === 'run' ? [entry.data.run] : []));
  expect(snapshots.every((run) => run.logs.length === 0 && run.phases.length === 0)).toBe(true);
  expect(restoredFrom(entries).get(created.id)?.logs).toEqual(['one', 'two']);
});

test('a run another process left open settles as interrupted, except the runs this process executes', () => {
  const { store, entries } = journaledStore();
  const stale = store.create('stale', { limits }, undefined, {}, {}, 1000);
  store.claim(stale.id, 1, 1000);
  const live = store.create('live', { limits }, undefined, {}, {}, 2000);
  store.claim(live.id, 1, 2000);
  const restored = restoredFrom(entries);
  const interrupted = restored.interruptOpen(new Set([live.id]));
  expect(interrupted.map((run) => run.id)).toEqual([stale.id]);
  expect(restored.get(stale.id)).toMatchObject({ status: 'error', failure: { type: 'interrupted' } });
  expect(restored.get(live.id)?.status).toBe('running');
});

test('admission counts subagents atomically and refuses past the total', () => {
  const store = new WorkflowStore(() => {});
  const created = store.create('build', { limits }, undefined, {}, {}, 1000);
  store.claim(created.id, 1, 1000);
  store.admitSubagent(created.id);
  store.admitSubagent(created.id);
  expect(store.get(created.id)?.consumption.subagents).toBe(2);
  store.finishSubagent(created.id, 1);
  expect(store.get(created.id)?.consumption.credits).toBe(1);
  expect(store.list().filter((entry) => entry.id === created.id)).toHaveLength(1);
});

test('a maxTotalSubagents of zero refuses the first subagent', () => {
  const store = new WorkflowStore(() => {});
  const created = store.create('build', { limits: { ...limits, maxTotalSubagents: 0 } }, undefined, {}, {}, 1000);
  store.claim(created.id, 1, 1000);
  expect(() => store.admitSubagent(created.id)).toThrow('The workflow reached its maxTotalSubagents limit (0).');
});

test('a run persists the configured workflow defaults in its effective limits', () => {
  const store = new WorkflowStore(() => {});
  const created = store.create('build', { limits: {} }, undefined, {}, { maxTotalSubagents: 0, maxConcurrentSubagents: 1 }, 1000);
  expect(store.get(created.id)?.effectiveLimits).toEqual({ maxConcurrentSubagents: 1, maxTotalSubagents: 0, timeoutSeconds: 1800, maxAiCredits: 5 });
  expect(() => store.admitSubagent(created.id)).toThrow('The workflow reached its maxTotalSubagents limit (0).');
});

test('a stale epoch settles nothing and unknown ids are refused', () => {
  const store = new WorkflowStore(() => {});
  const created = store.create('build', { limits }, undefined, {}, {}, 1000);
  store.claim(created.id, 1, 1000);
  expect(store.settle(created.id, 9, { status: 'completed' })).toBeUndefined();
  expect(store.get(created.id)).toMatchObject({ status: 'running', ownerEpoch: 1 });
  expect(store.get('ghost')).toBe(undefined);
});

test('the runtime registers nothing while dynamic workflows are off', () => {
  const runtime = new WorkflowRuntime({
    pi: { events: { emit: () => {}, on: () => () => {} } } as never,
    events: { emit: () => {} } as never,
    factory: {} as never,
    env: () => ({}) as NodeJS.ProcessEnv,
    settings: { read: () => ({ settings: { workflows: { maxConcurrentRuns: 4, defaultLimits: {} } } }) },
    log: () => {},
    persist: () => {},
  });
  expect(runtime.register(defineWorkflow({ name: 'w', description: 'd', run: async () => 1 }))).toBe(false);
  expect(runtime.runs()).toEqual([]);
});

test('a waiter takes a slot the moment a holder releases it and never on a timer', async () => {
  const slots = new Slots(1);
  const signal = new AbortController().signal;
  const releaseFirst = await slots.acquire(signal);
  const order: string[] = [];
  const second = slots.acquire(signal).then((release) => {
    order.push('second acquired');
    release();
  });
  await Promise.resolve();
  order.push('first still holds');
  releaseFirst();
  await second;
  expect(order).toEqual(['first still holds', 'second acquired']);
});

test('an aborted waiter leaves the line without blocking the waiters behind it', async () => {
  const slots = new Slots(1);
  const release = await slots.acquire(new AbortController().signal);
  const leaving = new AbortController();
  const gone = slots.acquire(leaving.signal);
  const staying = slots.acquire(new AbortController().signal);
  leaving.abort();
  await expect(gone).rejects.toThrow('The workflow was cancelled.');
  release();
  await expect(staying).resolves.toBeTypeOf('function');
});

test('a limit of undefined never makes a caller wait', async () => {
  const slots = new Slots(undefined);
  await expect(Promise.all([slots.acquire(new AbortController().signal), slots.acquire(new AbortController().signal)])).resolves.toHaveLength(2);
});

type Fixture = Awaited<ReturnType<typeof workerFixture>>;
const rpc = (fixture: Fixture, method: string, params?: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
  const id = `${method}-${Math.random()}`;
  return new Promise((resolve) => {
    const off = fixture.eventBus.on(rpcResultChannel, (payload) => {
      const reply = payload as { id: string; ok: boolean; result?: unknown; error?: string };
      if (reply.id !== id) return;
      off();
      resolve(reply);
    });
    fixture.eventBus.emit(rpcChannel, { id, method, params });
  });
};

async function workflowFixture() {
  vi.stubEnv('COPILOT_DYNAMIC_WORKFLOWS', '1');
  const fixture = await workerFixture();
  let steps = 0;
  fixture.eventBus.emit('reference-assistant:register-workflow', {
    name: 'probe-flow',
    description: 'Test workflow',
    run: async (ctx) => {
      const first = await ctx.step('probe-one', async () => {
        steps += 1;
        ctx.phase('verify');
        return 'one';
      });
      ctx.log('about to delegate');
      const answer = (await ctx.agent('hello', { model: 'worker-test/deterministic' })) as { text: string };
      await ctx.step('probe-two', async () => `${first}-${answer.text}`);
      return 'done';
    },
  } satisfies WorkflowDeclaration);
  return { fixture, stepsRef: () => steps };
}

test('a registered workflow runs, delegates, journals and settles completed', async () => {
  const { fixture } = await workflowFixture();
  const seen: { type: string; data?: Record<string, unknown>; agentId?: string }[] = [];
  fixture.eventBus.on('reference-assistant:event', (payload) => {
    const _event = payload as { type: string; data?: Record<string, unknown> };
    seen.push(payload as { type: string; data?: Record<string, unknown> });
  });
  try {
    const started = await rpc(fixture, 'session.workflow.run', { name: 'probe-flow' });
    expect(started.ok).toBe(true);
    const id = (started.result as { id: string }).id;
    expect(started.result).toMatchObject({ status: 'completed', name: 'probe-flow', consumption: { subagents: 1, credits: 1 }, phases: ['verify'] });
    const detail = await rpc(fixture, 'session.workflow.getRunDetail', { id });
    expect((detail.result as { journal: Record<string, unknown> }).journal).toEqual({ 'probe-one': 'one', 'probe-two': 'one-users=1' });
    expect(seen.map((event) => event.type)).toEqual(expect.arrayContaining(['workflow.run_started', 'workflow.run_updated', 'workflow.run_settled', 'system.notification']));
    expect((await rpc(fixture, 'session.workflow.getRunProgress', { id })).result).toMatchObject({ phases: ['verify'] });
    expect((await rpc(fixture, 'session.tasks.list')).result).toEqual([]);
    const childStart = seen.find((event) => event.type === 'subagent.started');
    expect(childStart?.data).toMatchObject({ agentType: 'general-purpose', executionMode: 'sync' });
    expect(childStart?.data?.workflowRunId).toBe(id);
    expect(childStart?.data?.factoryRunId).toBe(id);
    const childId = String(childStart?.agentId);
    await expect(fixture.call('read_agent', { agent_id: childId })).rejects.toThrow(`Agent ${childId} is managed by workflow run ${id}.`);
    const put = await rpc(fixture, 'session.workflow.journal.put', { id, key: 'manual', value: 7 });
    expect(put.ok).toBe(true);
    expect(((await rpc(fixture, 'session.workflow.getRunDetail', { id })).result as { journal: Record<string, unknown> }).journal.manual).toBe(7);
  } finally {
    await fixture.close();
  }
});

test('a workflow run is journaled as session entries and never as a side file', async () => {
  const { fixture } = await workflowFixture();
  try {
    const started = await rpc(fixture, 'session.workflow.run', { name: 'probe-flow' });
    const id = (started.result as { id: string }).id;
    const entries = fixture.session.sessionManager.getEntries().flatMap((entry) => (entry.type === 'custom' && entry.customType === 'reference-assistant-workflow' ? [entry.data as Change] : []));
    expect(entries.filter((change) => change.kind === 'journal').map((change) => change.kind === 'journal' && change.key)).toEqual(['probe-one', 'probe-two']);
    expect(entries.some((change) => change.kind === 'run' && change.run.id === id && change.run.status === 'completed')).toBe(true);
    expect(existsSync(join(fixture.dir, 'sessions', 'workflows.json'))).toBe(false);
    const rebuilt = new WorkflowStore(() => {});
    rebuilt.restore(fixture.session.sessionManager.getBranch());
    expect(rebuilt.get(id)).toMatchObject({ status: 'completed', phases: ['verify'] });
  } finally {
    await fixture.close();
  }
});

test('a workflow never runs more subagents at once than its concurrency limit', async () => {
  vi.stubEnv('COPILOT_DYNAMIC_WORKFLOWS', '1');
  const fixture = await workerFixture();
  const order: string[] = [];
  fixture.eventBus.on('reference-assistant:event', (payload) => {
    const { type } = payload as { type: string };
    if (type === 'subagent.started' || type === 'subagent.completed') order.push(type);
  });
  fixture.eventBus.emit('reference-assistant:register-workflow', {
    name: 'serial-flow',
    description: 'Two delegates through one slot',
    limits: { maxConcurrentSubagents: 1 },
    run: async (ctx) => ctx.parallel([() => ctx.agent('one'), () => ctx.agent('two')]),
  } satisfies WorkflowDeclaration);
  try {
    const started = await rpc(fixture, 'session.workflow.run', { name: 'serial-flow' });
    expect(started.result).toMatchObject({ status: 'completed', consumption: { subagents: 2 } });
    expect(order).toEqual(['subagent.started', 'subagent.completed', 'subagent.started', 'subagent.completed']);
  } finally {
    await fixture.close();
  }
});

test('the configured workflow defaults bound a run that declares no limits', async () => {
  vi.stubEnv('COPILOT_DYNAMIC_WORKFLOWS', '1');
  const fixture = await workerFixture({ settings: { workflows: { defaultLimits: { maxTotalSubagents: 1 } } } });
  fixture.eventBus.emit('reference-assistant:register-workflow', {
    name: 'defaulted-flow',
    description: 'Declares no limits of its own',
    run: async (ctx) => {
      await ctx.agent('one');
      return ctx.agent('two');
    },
  } satisfies WorkflowDeclaration);
  try {
    const started = await rpc(fixture, 'session.workflow.run', { name: 'defaulted-flow' });
    expect(started.result).toMatchObject({ status: 'error', failure: { type: 'workflow_limit_reached', message: expect.stringContaining('maxTotalSubagents (1) was reached') } });
  } finally {
    await fixture.close();
  }
});

test('the configured concurrency default serializes a run that declares none', async () => {
  vi.stubEnv('COPILOT_DYNAMIC_WORKFLOWS', '1');
  const fixture = await workerFixture({ settings: { workflows: { defaultLimits: { maxConcurrentSubagents: 1 } } } });
  const order: string[] = [];
  fixture.eventBus.on('reference-assistant:event', (payload) => {
    const { type } = payload as { type: string };
    if (type === 'subagent.started' || type === 'subagent.completed') order.push(type);
  });
  fixture.eventBus.emit('reference-assistant:register-workflow', {
    name: 'defaulted-parallel',
    description: 'Two delegates through the configured slot',
    run: async (ctx) => ctx.parallel([() => ctx.agent('one'), () => ctx.agent('two')]),
  } satisfies WorkflowDeclaration);
  try {
    const started = await rpc(fixture, 'session.workflow.run', { name: 'defaulted-parallel' });
    expect(started.result).toMatchObject({ status: 'completed', consumption: { subagents: 2 } });
    expect(order).toEqual(['subagent.started', 'subagent.completed', 'subagent.started', 'subagent.completed']);
  } finally {
    await fixture.close();
  }
});

test('a paused workflow resumes from its journal without repeating steps', async () => {
  vi.stubEnv('COPILOT_DYNAMIC_WORKFLOWS', '1');
  const fixture = await workerFixture();
  let steps = 0;
  fixture.eventBus.emit('reference-assistant:register-workflow', {
    name: 'pausing-flow',
    description: 'Pauses after the first step',
    run: async (ctx) => {
      await ctx.step('only', async () => {
        steps += 1;
        return 'kept';
      });
      if (!ctx.resumed) ctx.pause('gate');
    },
  } satisfies WorkflowDeclaration);
  try {
    const started = await rpc(fixture, 'session.workflow.run', { name: 'pausing-flow' });
    expect(started.result).toMatchObject({ status: 'paused', checkpoint: 'gate' });
    expect(steps).toBe(1);
    const id = (started.result as { id: string }).id;
    const resumed = await rpc(fixture, 'session.workflow.resume', { id });
    expect((resumed.result as { status: string }).status).toBe('completed');
    expect(steps).toBe(1);
    expect(((await rpc(fixture, 'session.workflow.getRunDetail', { id })).result as { journal: Record<string, unknown> }).journal).toEqual({ only: 'kept' });
  } finally {
    await fixture.close();
  }
});

test('a workflow past its subagent total fails with workflow_limit_reached', async () => {
  vi.stubEnv('COPILOT_DYNAMIC_WORKFLOWS', '1');
  const fixture = await workerFixture();
  fixture.eventBus.emit('reference-assistant:register-workflow', {
    name: 'limited-flow',
    description: 'Needs one delegate but admits none',
    limits: { maxTotalSubagents: 0 },
    run: async (ctx) => ctx.agent('hello'),
  } satisfies WorkflowDeclaration);
  try {
    const started = await rpc(fixture, 'session.workflow.run', { name: 'limited-flow' });
    expect(started.result).toMatchObject({ status: 'error', failure: { type: 'workflow_limit_reached', message: expect.stringContaining('maxTotalSubagents (0) was reached') } });
  } finally {
    await fixture.close();
  }
});

test('unknown workflows, duplicate active runs and run detail of nothing are refused', async () => {
  const { fixture } = await workflowFixture();
  try {
    expect((await rpc(fixture, 'session.workflow.run', { name: 'ghost' })).error).toContain('Unknown workflow: ghost');
    const pending = rpc(fixture, 'session.workflow.run', { name: 'probe-flow' });
    await expect(rpc(fixture, 'session.workflow.run', { name: 'probe-flow' })).resolves.toMatchObject({ ok: false, error: 'Workflow probe-flow already has an active run. Resume or cancel it first.' });
    expect((await pending).ok).toBe(true);
    expect((await rpc(fixture, 'session.workflow.getRun', { id: 'x' })).result).toBe(null);
  } finally {
    await fixture.close();
  }
});

test('cancelling a running workflow settles it as cancelled', async () => {
  vi.stubEnv('COPILOT_DYNAMIC_WORKFLOWS', '1');
  const fixture = await workerFixture();
  fixture.eventBus.emit('reference-assistant:register-workflow', {
    name: 'slow-flow',
    description: 'Waits on a blocked agent',
    run: async (ctx) => ctx.agent('WAIT_BLOCKED hold'),
  } satisfies WorkflowDeclaration);
  try {
    const pending = rpc(fixture, 'session.workflow.run', { name: 'slow-flow' });
    let id: string | undefined;
    await vi.waitFor(async () => {
      const listed = (await rpc(fixture, 'session.workflow.listRuns')).result as { id: string; status: string; name: string }[];
      id = listed.find((entry) => entry.name === 'slow-flow' && entry.status === 'running')?.id;
      expect(id).toBeDefined();
    });
    const cancelled = await rpc(fixture, 'session.workflow.cancel', { id });
    expect([cancelled.ok, (cancelled.result as { status: string }).status]).toEqual([true, 'cancelled']);
    await expect(pending).resolves.toMatchObject({ ok: true, result: { status: 'cancelled' } });
  } finally {
    await fixture.close();
  }
});
