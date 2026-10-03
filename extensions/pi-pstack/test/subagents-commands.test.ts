import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import type { AgentNode } from '../src/subagents/agent-node.ts';
import { rpcChannel, rpcResultChannel } from '../src/subagents/rpc.ts';
import { parseReference AssistantSettings } from '../src/subagents/settings.ts';
import { fleetPrompt, registerSubagentCommands, rubberDuckPrompt } from '../src/subagents/subagent-commands.ts';
import { workerFixture } from './worker-fixture.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;
const idOf = (result: unknown) => String((result as { details: { agent_id: string } }).details.agent_id);

/** A record created outside the scheduler, as an external RPC client would register it. */
const externalTask = (id: string): AgentNode => ({
  id,
  registryId: `registry-${id}`,
  toolCallId: `call-${id}`,
  agentType: 'general-purpose',
  agentDisplayName: id,
  agentDescription: 'A record created outside the scheduler.',
  description: 'probe',
  prompt: 'hello',
  mode: 'background',
  status: 'running',
  depth: 1,
  turns: [],
  startedAt: 1,
  model: 'worker-test/deterministic',
  modelSource: 'session_inheritance',
  taskModelSource: 'unset',
  contextTier: 'inherit',
  firstDispatchedModel: 'worker-test/deterministic',
  totalToolCalls: 0,
  totalTokens: 0,
  sessionFile: `/tmp/${id}.jsonl`,
  cwd: '/repo',
});

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
    const listed = (await rpc(fixture, 'session.tasks.list')).result as { id: string; taskStoreId: string; status: string; mode: string; name: string }[];
    expect(listed).toMatchObject([{ id: agentId, taskStoreId: agentId, status: 'idle', mode: 'background', name: 'rpc-agent' }]);
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

test('register adds an externally created task keyed by its native session id', async () => {
  const fixture = await workerFixture();
  try {
    const task = externalTask('external-task');
    const registered = await rpc(fixture, 'session.tasks.register', task);
    expect(registered).toMatchObject({ ok: true, result: { id: 'external-task', taskStoreId: 'external-task', kind: 'agent', status: 'running' } });
    expect((registered.result as { taskStoreId: string }).taskStoreId).not.toBe(task.registryId);
    expect(await rpc(fixture, 'session.tasks.register', { id: 'broken' })).toMatchObject({ ok: false, error: 'Invalid session.tasks.register parameters.' });
  } finally {
    await fixture.close();
  }
});

test('update patches a registered task and list reflects it', async () => {
  const fixture = await workerFixture();
  try {
    await rpc(fixture, 'session.tasks.register', externalTask('external-task'));
    const updated = await rpc(fixture, 'session.tasks.update', { id: 'external-task', fields: { description: 'patched', totalTokens: 3 } });
    expect(updated).toMatchObject({ ok: true, result: { id: 'external-task', taskStoreId: 'external-task', description: 'patched', kind: 'agent' } });
    const listed = (await rpc(fixture, 'session.tasks.list')).result as { id: string; taskStoreId: string; description: string }[];
    expect(listed.find((task) => task.id === 'external-task')).toMatchObject({ taskStoreId: 'external-task', description: 'patched' });
    expect((await rpc(fixture, 'session.tasks.update', { id: 'ghost', fields: { description: 'x' } })).error).toBe('Agent not found: ghost');
    expect((await rpc(fixture, 'session.tasks.update', { id: 'external-task', fields: { status: 'failed' } })).error).toBe('Invalid session.tasks.update parameters.');
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
  fixture.eventBus.on('reference-assistant:event', (payload) => seen.push((payload as { type: string }).type));
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

test('/subagents saves an edit and the next listing shows it', async () => {
  const fixture = await workerFixture();
  try {
    expect(await fixture.command('subagents', 'effort explore medium')).toEqual([{ message: 'Saved. The change applies to the next subagent.', level: 'info' }]);
    expect((await fixture.command('subagents', ''))[0]?.message).toContain('explore: model default, effort medium, tier inherit');
  } finally {
    await fixture.close();
  }
});

test('/subagents leaves a settings file it cannot parse untouched and reports the error', async () => {
  const fixture = await workerFixture();
  try {
    const file = join(fixture.dir, 'settings.json');
    writeFileSync(file, '{broken');
    const [notice] = await fixture.command('subagents', 'tier explore default');
    expect(notice?.level).toBe('error');
    expect(notice?.message).toContain('Could not save the preference:');
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  } finally {
    await fixture.close();
  }
});

test('/workflows lists nothing before a run and summarizes a completed run', async () => {
  vi.stubEnv('COPILOT_DYNAMIC_WORKFLOWS', '1');
  const fixture = await workerFixture();
  fixture.eventBus.emit('reference-assistant:register-workflow', { name: 'listing-flow', description: 'A run the command can list', run: async () => 'ok' });
  try {
    expect((await fixture.command('workflows', ''))[0]?.message).toBe('No workflow runs.');
    const started = await rpc(fixture, 'session.workflow.run', { name: 'listing-flow' });
    expect(started.ok).toBe(true);
    const id = (started.result as { id: string }).id;
    expect((await fixture.command('workflows', ''))[0]?.message).toBe(`${id} completed attempt 1 subagents 0`);
    expect((await fixture.command('factories', ''))[0]?.message).toBe(`${id} completed attempt 1 subagents 0`);
  } finally {
    await fixture.close();
  }
});

type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

function commandParts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { settings } = parseReference AssistantSettings({ builtInAgents: { rubberDuck: true } });
  return {
    factory: { offered: () => [{ name: 'rubber-duck' }] },
    scheduler: { promoteCurrent: () => undefined, cancel: async (id: string) => ({ id, status: 'cancelled' }), list: () => [] },
    settings: { adopt: () => {}, read: () => ({ settings }) },
    workflows: () => ({ runs: () => [] }),
    ...overrides,
  };
}

function commandHarness(parts: Record<string, unknown>) {
  const handlers = new Map<string, CommandHandler>();
  const sent: string[] = [];
  const pi = {
    registerCommand: (name: string, definition: { handler: CommandHandler }) => handlers.set(name, definition.handler),
    sendUserMessage: (text: string) => sent.push(text),
    events: { on: () => () => {} },
  };
  registerSubagentCommands(pi as never, parts as never);
  const notes: { message: string; level: string | undefined }[] = [];
  const ctx = { ui: { notify: (message: string, level?: string) => notes.push({ message, level }) } };
  return {
    notes,
    sent,
    run: async (name: string, args: string) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`command ${name} was not registered`);
      await handler(args, ctx);
      await Promise.resolve();
    },
  };
}

test('every subagent command is registered with a handler', () => {
  const handlers = new Set<string>();
  const pi = { registerCommand: (name: string) => handlers.add(name), events: { on: () => () => {} } };
  registerSubagentCommands(pi as never, commandParts() as never);
  expect([...handlers].sort()).toEqual(['factories', 'fleet', 'rubber-duck', 'subagents', 'tasks', 'workflows']);
});

test('/tasks background reports the promoted task id', async () => {
  const { run, notes } = commandHarness(commandParts({ scheduler: { promoteCurrent: () => ({ id: 'sync-1' }), cancel: async () => undefined, list: () => [] } }));
  await run('tasks', 'background');
  expect(notes).toEqual([{ message: 'Agent sync-1 moved to the background.', level: 'info' }]);
});

test('/tasks cancel names the agent and reports the status it settles into', async () => {
  const cancelled: string[] = [];
  const { run, notes } = commandHarness(
    commandParts({
      scheduler: {
        promoteCurrent: () => undefined,
        cancel: async (id: string) => {
          cancelled.push(id);
          return { id, status: 'cancelled' };
        },
        list: () => [],
      },
    }),
  );
  await run('tasks', 'cancel agent-9');
  expect(cancelled).toEqual(['agent-9']);
  expect(notes).toEqual([{ message: 'Agent agent-9 is cancelled.', level: 'info' }]);
});

test('/rubber-duck sends the plan with and without a focus', async () => {
  const { run, sent } = commandHarness(commandParts());
  await run('rubber-duck', '');
  await run('rubber-duck', 'the retry plan');
  expect(sent).toEqual([rubberDuckPrompt(''), rubberDuckPrompt('the retry plan')]);
  expect(sent[0]).not.toContain('challenged:');
  expect(sent[1]).toContain('challenged: the retry plan');
});

test('/fleet sends the trimmed goal into the fleet prompt', async () => {
  const { run, sent } = commandHarness(commandParts());
  await run('fleet', '  ship the release  ');
  expect(sent).toEqual([fleetPrompt('ship the release')]);
  expect(sent[0]).toContain('Goal: ship the release');
});
