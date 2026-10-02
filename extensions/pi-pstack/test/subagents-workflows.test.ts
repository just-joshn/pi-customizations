import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { rpcChannel, rpcResultChannel } from '../src/subagents/rpc.ts';
import type { WorkflowLimits } from '../src/subagents/settings.ts';
import { checkLimits, effectiveLimits, overCredits } from '../src/subagents/workflows/limits.ts';
import { WorkflowRuntime, workflowsEnabled } from '../src/subagents/workflows/runtime.ts';
import { WorkflowStore } from '../src/subagents/workflows/store.ts';
import { defineWorkflow, type WorkflowDeclaration, WorkflowPause } from '../src/subagents/workflows/types.ts';
import { scratchDir } from './support/scratch.ts';
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

test('the store claims pending runs, heartbeats a lease, settles and persists across instances', () => {
  const file = join(scratchDir('pstack-workflows-'), 'nested', 'workflows.json');
  const first = new WorkflowStore(() => file);
  const declaration = { limits };
  const created = first.create('build', declaration, { a: 1 }, {}, 1000);
  expect(first.claim(created.id, 1, 15_000, 1000)).toMatchObject({ status: 'running', ownerEpoch: 1 });
  expect(first.claim(created.id, 1, 15_000, 1001)).toBeUndefined();
  first.heartbeat(created.id, 1, 15_000, 2000);
  expect(first.get(created.id)?.leaseExpiresAt).toBe(17_000);
  first.putJournal(created.id, 'step', 'kept');
  first.settle(created.id, 1, { status: 'completed', result: 7 });
  const second = new WorkflowStore(() => file);
  expect(second.get(created.id)).toMatchObject({ status: 'completed', result: 7 });
  expect(second.journalOf(created.id)).toEqual({ step: 'kept' });
  expect(second.journalOf('nothing')).toEqual({});
});

test('admission counts subagents atomically and refuses past the total', () => {
  const store = new WorkflowStore(() => undefined);
  const created = store.create('build', { limits }, undefined, {}, 1000);
  store.claim(created.id, 1, 15_000, 1000);
  store.admitSubagent(created.id, 'one', 1000);
  store.admitSubagent(created.id, 'two', 1000);
  expect(store.get(created.id)?.consumption.subagents).toBe(2);
  store.finishSubagent(created.id, 'a', 1, 1001);
  expect(store.get(created.id)?.consumption.credits).toBe(1);
  expect(store.list().filter((entry) => entry.id === created.id)).toHaveLength(1);
});

test('a maxTotalSubagents of zero refuses the first subagent', () => {
  const store = new WorkflowStore(() => undefined);
  const created = store.create('build', { limits: { ...limits, maxTotalSubagents: 0 } }, undefined, {}, 1000);
  store.claim(created.id, 1, 15_000, 1000);
  expect(() => store.admitSubagent(created.id, 'one', 1000)).toThrow('The workflow reached its maxTotalSubagents limit (0).');
});

test('a stale epoch settles nothing and unknown ids are refused', () => {
  const store = new WorkflowStore(() => undefined);
  const created = store.create('build', { limits }, undefined, {}, 1000);
  store.claim(created.id, 1, 15_000, 1000);
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
    storeFile: () => undefined,
  });
  expect(runtime.register(defineWorkflow({ name: 'w', description: 'd', run: async () => 1 }))).toBe(false);
  expect(runtime.runs()).toEqual([]);
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
