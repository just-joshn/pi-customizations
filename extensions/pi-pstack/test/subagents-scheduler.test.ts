import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import type { EventEnvelope } from '../src/subagents/events.ts';
import { rpcChannel, rpcResultChannel } from '../src/subagents/rpc.ts';
import { workerFixture } from './worker-fixture.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;
type Result = { content: { text: string }[]; details: Record<string, unknown> };
const textOf = (result: unknown) => (result as Result).content[0]?.text ?? '';
const idOf = (result: unknown) => String((result as Result).details.agent_id);
const task = (fixture: Fixture, prompt: string, extra: Record<string, unknown> = {}) => fixture.call('task', { agent_type: 'general-purpose', name: 'probe', description: 'probe', prompt, ...extra });

function collect(fixture: Fixture): EventEnvelope[] {
  const seen: EventEnvelope[] = [];
  fixture.eventBus.on('copilot:event', (payload) => seen.push(payload as EventEnvelope));
  return seen;
}

function rpc(fixture: Fixture, method: string, params?: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }> {
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
}

test('a sync task emits the documented event order with its provenance', async () => {
  const fixture = await workerFixture();
  const seen = collect(fixture);
  try {
    await task(fixture, 'hello');
    const types = seen.map((event) => event.type);
    expect(types.slice(0, 4)).toEqual(['subagent.started', 'session.background_tasks_changed', 'subagent.configured', 'subagent.selected']);
    expect(types).toEqual(expect.arrayContaining(['system.message', 'session.model_change', 'user.message', 'assistant.turn_start', 'assistant.message', 'assistant.turn_end', 'subagent.completed']));
    expect(seen[0]).toMatchObject({ data: { agentType: 'general-purpose', executionMode: 'sync', resumable: false, modelSelectionSource: 'session_inheritance', taskModelSource: 'unset', agentDisplayName: 'probe' } });
    expect(seen[0]?.data).not.toHaveProperty('parentId');
    expect(seen.find((event) => event.type === 'subagent.selected')?.data).toMatchObject({ agentName: 'general-purpose', tools: ['*'] });
    const completed = seen.find((event) => event.type === 'subagent.completed');
    expect(completed?.data).toMatchObject({ agentName: 'general-purpose', configuredModelMatchesActual: true, totalToolCalls: 0 });
    const childOwned = seen.filter((event) => event.type.startsWith('assistant.') || event.type === 'user.message');
    expect(childOwned.every((event) => typeof event.agentId === 'string' && event.agentId.length > 0)).toBe(true);
  } finally {
    await fixture.close();
  }
});

test('the ephemeral change event is never persisted but durable events are', async () => {
  const fixture = await workerFixture();
  try {
    await task(fixture, 'hello');
    const persisted = fixture.session.sessionManager.getEntries().flatMap((entry) => (entry.type === 'custom' && entry.customType === 'copilot-event' ? [(entry.data as EventEnvelope).type] : []));
    expect(persisted).toContain('subagent.started');
    expect(persisted).toContain('subagent.completed');
    expect(persisted).not.toContain('session.background_tasks_changed');
  } finally {
    await fixture.close();
  }
});

test('a spawn at the concurrent limit is rejected and a finished agent frees its slot', async () => {
  const fixture = await workerFixture({ settings: { subagents: { maxConcurrency: 1 } } });
  try {
    const first = await task(fixture, 'WAIT_BLOCKED hold', { mode: 'background', name: 'holder' });
    await expect(task(fixture, 'second', { name: 'second' })).rejects.toThrow('Maximum concurrent agent limit of 1 reached. Wait for existing agents to complete before spawning new ones.');
    await rpc(fixture, 'session.tasks.cancel', { id: idOf(first) });
    expect(textOf(await task(fixture, 'third', { name: 'third' }))).toBe('users=1');
  } finally {
    await fixture.close();
  }
});

test('a nested spawn at the depth limit is refused inside the child', async () => {
  const fixture = await workerFixture({ settings: { subagents: { maxDepth: 1 } } });
  try {
    await task(fixture, 'SPAWN_TASK');
    const results = JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8')) as { toolName: string; isError: boolean; content: { text: string }[] }[];
    expect(results.find((result) => result.toolName === 'task')).toMatchObject({ isError: true, content: [{ text: 'Maximum sub-agent depth of 1 reached. Complete this task without spawning further sub-agents.' }] });
  } finally {
    await fixture.close();
  }
});

test('a nested spawn counts against the concurrency slots of the root', async () => {
  const fixture = await workerFixture({ settings: { subagents: { maxConcurrency: 1 } } });
  try {
    await task(fixture, 'SPAWN_TASK');
    const results = JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8')) as { toolName: string; isError: boolean; content: { text: string }[] }[];
    expect(results.find((result) => result.toolName === 'task')).toMatchObject({ isError: true, content: [{ text: 'Maximum concurrent agent limit of 1 reached. Wait for existing agents to complete before spawning new ones.' }] });
  } finally {
    await fixture.close();
  }
});

test('write_agent refuses a sync agent, an unknown id and a finished agent', async () => {
  const fixture = await workerFixture();
  try {
    const sync = await task(fixture, 'hello');
    await expect(fixture.call('write_agent', { agent_id: idOf(sync), message: 'more' })).rejects.toThrow(`write_agent only supports background agents. Agent ${idOf(sync)} was started in sync mode.`);
    await expect(fixture.call('write_agent', { agent_id: 'ghost', message: 'more' })).rejects.toThrow('Agent not found: ghost');
    await expect(fixture.call('read_agent', { agent_id: 'ghost' })).rejects.toThrow('Agent not found: ghost');
  } finally {
    await fixture.close();
  }
});

test('read_agent with a short timeout reports a still running agent', async () => {
  const fixture = await workerFixture();
  try {
    const started = await task(fixture, 'WAIT_BLOCKED hold', { mode: 'background' });
    const read = await fixture.call('read_agent', { agent_id: idOf(started), wait: true, timeout: 1 });
    expect(textOf(read).split('\n')[0]).toBe('Agent is still running.');
    await rpc(fixture, 'session.tasks.cancel', { id: '*', includeIdle: true });
  } finally {
    await fixture.close();
  }
});

test('cancelling a running agent completes it with cancelled true and no notification wake', async () => {
  const fixture = await workerFixture();
  const seen = collect(fixture);
  try {
    const started = await task(fixture, 'WAIT_BLOCKED hold', { mode: 'background' });
    const reply = await rpc(fixture, 'session.tasks.cancel', { id: idOf(started) });
    expect(reply).toMatchObject({ ok: true, result: { id: idOf(started), status: 'cancelled' } });
    expect(seen.find((event) => event.type === 'subagent.completed')?.data).toMatchObject({ cancelled: true });
    expect(seen.some((event) => event.type === 'system.notification')).toBe(false);
  } finally {
    await fixture.close();
  }
});

test('a sync task moved to the background returns at once and the agent keeps running', async () => {
  const fixture = await workerFixture();
  try {
    const pending = task(fixture, 'WAIT_BLOCKED hold');
    await vi.waitFor(async () => {
      const reply = await rpc(fixture, 'session.tasks.getCurrentPromotable');
      expect(reply.result).not.toBeNull();
    });
    const promoted = await rpc(fixture, 'session.tasks.promoteCurrentToBackground');
    expect(promoted).toMatchObject({ ok: true, result: { mode: 'background', status: 'running' } });
    expect(textOf(await pending)).toMatch(/was moved to the background and is still running\..* Use read_agent to check for results\.$/);
    expect(await rpc(fixture, 'session.tasks.promoteCurrentToBackground')).toMatchObject({ ok: true, result: { message: 'No running sync task to move to background.' } });
    await rpc(fixture, 'session.tasks.cancel', { id: '*', includeIdle: true });
  } finally {
    await fixture.close();
  }
});

test('a background agent that finishes wakes the parent with an idle notification', async () => {
  const fixture = await workerFixture();
  const seen = collect(fixture);
  try {
    const started = await task(fixture, 'hello', { mode: 'background', name: 'alpha' });
    await fixture.call('read_agent', { agent_id: idOf(started), wait: true });
    const notice = seen.find((event) => event.type === 'system.notification');
    expect(notice?.data).toMatchObject({ kind: 'agent_idle', summary: 'Agent "alpha" (general-purpose) has finished processing and is now idle.' });
  } finally {
    await fixture.close();
  }
});

test('an unknown agent type fails with the valid list', async () => {
  const fixture = await workerFixture();
  try {
    await expect(task(fixture, 'x', { agent_type: 'nope' })).rejects.toThrow('Unknown agent_type: nope. Valid types are: code-review, explore, general-purpose, research, rubber-duck, security-review, task');
  } finally {
    await fixture.close();
  }
});

test('a disabled subagent and an excluded model policy refuse before any child starts', async () => {
  const fixture = await workerFixture({ settings: { subagents: { disabledSubagents: ['explore'], agents: { task: { model: 'worker-test/missing', modelPolicy: 'required' } } } } });
  try {
    await expect(task(fixture, 'x', { agent_type: 'explore' })).rejects.toThrow("Subagent 'explore' is disabled. Enable it in /subagents before dispatching it.");
    await expect(task(fixture, 'x', { agent_type: 'task' })).rejects.toThrow("Model 'worker-test/missing' is required for agent type 'task' but is not available in this session.");
    expect(textOf(await fixture.call('list_agents', { scope: 'all' }))).toBe('No agents.');
  } finally {
    await fixture.close();
  }
});

test('a required setting pins the child model and reports configured_required', async () => {
  const fixture = await workerFixture({ settings: { subagents: { agents: { 'general-purpose': { model: 'worker-test/alternate', modelPolicy: 'required', effortLevel: 'low' } } } } });
  const seen = collect(fixture);
  try {
    await task(fixture, 'hello');
    expect(seen[0]?.data).toMatchObject({ model: 'worker-test/alternate', modelSelectionSource: 'configured_required', taskModelSource: 'subagent_configuration' });
    expect(seen.find((event) => event.type === 'subagent.configured')?.data).toMatchObject({ model: 'worker-test/alternate', reasoningEffort: 'low', contextTier: 'inherit', multiTurn: true });
  } finally {
    await fixture.close();
  }
});
