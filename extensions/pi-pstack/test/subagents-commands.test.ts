import { expect, test } from 'vitest';
import { rpcChannel, rpcResultChannel } from '../src/subagents/rpc.ts';
import { workerFixture } from './worker-fixture.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;
const idOf = (result: unknown) => String((result as { details: { agent_id: string } }).details.agent_id);

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

test('/tasks lists active agents, hides idle ones and lists them with all', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('task', { agent_type: 'general-purpose', name: 'alpha', description: 'probe', prompt: 'hello', mode: 'background' });
    await fixture.call('read_agent', { agent_id: idOf(started), wait: true });
    expect((await fixture.command('tasks', ''))[0]?.message).toBe('No agents.');
    expect((await fixture.command('tasks', 'all'))[0]?.message).toContain('name: alpha | mode: background | status: idle');
  } finally {
    await fixture.close();
  }
});

test('/tasks background reports when nothing can be moved', async () => {
  const fixture = await workerFixture();
  try {
    expect((await fixture.command('tasks', 'background'))[0]?.message).toBe('No running sync task to move to background.');
  } finally {
    await fixture.close();
  }
});

test('/subagents shows the preferences and refuses a malformed edit', async () => {
  const fixture = await workerFixture({ settings: { subagents: { agents: { explore: { model: 'gpt-6', modelPolicy: 'required' } } } } });
  try {
    expect((await fixture.command('subagents', ''))[0]?.message).toContain('explore: model gpt-6 (required), effort low, tier inherit');
    expect(await fixture.command('subagents', 'tier explore huge')).toMatchObject([{ level: 'warning' }]);
  } finally {
    await fixture.close();
  }
});

test('/rubber-duck refuses while the agent is off', async () => {
  const fixture = await workerFixture({ settings: { builtInAgents: { rubberDuck: false } } });
  try {
    expect(await fixture.command('rubber-duck', 'check the plan')).toEqual([{ message: 'The rubber-duck agent is not available. Turn it on with /subagents rubber-duck on.', level: 'warning' }]);
  } finally {
    await fixture.close();
  }
});

test('/fleet without a goal prints its usage', async () => {
  const fixture = await workerFixture();
  try {
    expect(await fixture.command('fleet', '  ')).toEqual([{ message: 'Usage: /fleet <goal>', level: 'warning' }]);
  } finally {
    await fixture.close();
  }
});

test('startAgent over the bus starts a background agent and list shows it', async () => {
  const fixture = await workerFixture();
  try {
    const started = await rpc(fixture, 'session.tasks.startAgent', { agentType: 'general-purpose', prompt: 'hello', name: 'rpc-agent' });
    const agentId = (started.result as { agentId: string }).agentId;
    expect(started.ok).toBe(true);
    await rpc(fixture, 'session.tasks.waitForPending', { timeoutMs: 5000 });
    const listed = (await rpc(fixture, 'session.tasks.list')).result as { id: string; status: string; mode: string; name: string }[];
    expect(listed).toMatchObject([{ id: agentId, status: 'idle', mode: 'background', name: 'rpc-agent' }]);
    expect((await rpc(fixture, 'session.tasks.getProgress', { id: agentId })).result).toEqual({ intent: null, toolCalls: 0, tokens: 5 });
    expect((await rpc(fixture, 'session.tasks.sendMessage', { id: agentId, message: 'again' })).ok).toBe(true);
    expect((await rpc(fixture, 'session.tasks.remove', { id: agentId })).ok).toBe(true);
  } finally {
    await fixture.close();
  }
});

test('rpc reports malformed parameters, unknown methods and the tool set', async () => {
  const fixture = await workerFixture();
  try {
    expect(await rpc(fixture, 'session.tasks.startAgent', { agentType: 1 })).toEqual({ id: expect.any(String), ok: false, error: 'Invalid session.tasks.startAgent parameters.' });
    expect((await rpc(fixture, 'session.nothing')).error).toBe('Unknown RPC method: session.nothing');
    expect(((await rpc(fixture, 'session.tools.initializeAndValidate')).result as { tools: string[] }).tools).toEqual(expect.arrayContaining(['task', 'read_agent', 'write_agent', 'list_agents']));
  } finally {
    await fixture.close();
  }
});

test('live subagent settings change the next spawn', async () => {
  const fixture = await workerFixture();
  try {
    await rpc(fixture, 'session.tools.updateSubagentSettings', { disabledSubagents: ['task'] });
    await expect(fixture.call('task', { agent_type: 'task', name: 'x', description: 'd', prompt: 'p' })).rejects.toThrow("Subagent 'task' is disabled.");
  } finally {
    await fixture.close();
  }
});

test('selecting a custom agent emits selected, setPrompt works and general-purpose is locked', async () => {
  const fixture = await workerFixture();
  const seen: string[] = [];
  fixture.eventBus.on('copilot:event', (payload) => seen.push((payload as { type: string }).type));
  try {
    expect((await rpc(fixture, 'session.agent.select', { name: 'explore' })).ok).toBe(true);
    expect(seen).toContain('subagent.selected');
    expect((await rpc(fixture, 'session.agent.getCurrent')).result).toMatchObject({ name: 'explore' });
    expect((await rpc(fixture, 'session.agent.setPrompt', { name: 'explore', prompt: 'Be quick.' })).ok).toBe(true);
    expect((await rpc(fixture, 'session.agent.setPrompt', { name: 'general-purpose', prompt: 'x' })).error).toBe('The general-purpose prompt cannot be overridden.');
    expect((await rpc(fixture, 'session.agent.deselect')).ok).toBe(true);
    expect(seen).toContain('subagent.deselected');
    expect((await rpc(fixture, 'session.agent.select', { name: 'ghost' })).error).toBe('Unknown agent: ghost');
    expect(((await rpc(fixture, 'session.agent.list')).result as unknown[]).length).toBe(7);
  } finally {
    await fixture.close();
  }
});
