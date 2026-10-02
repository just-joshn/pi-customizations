import { expect, test, vi } from 'vitest';
import { sendInboxTool } from '../src/subagents/inbox.ts';
import { type LaunchFacts, SidekickManager, type SidekickPorts, sidekickEnabled, triggerLimitMessage } from '../src/subagents/sidekicks/manager.ts';
import { loadSidekicks, parseSidekick, type SidekickSpec } from '../src/subagents/sidekicks/spec.ts';
import { sidekickDefinition } from '../src/subagents/sidekicks/wiring.ts';
import { workerFixture } from './worker-fixture.ts';

const shipped = loadSidekicks();
const named = (name: string): SidekickSpec => {
  const found = shipped.specs.find((spec) => spec.name === name);
  if (!found) throw new Error(name);
  return found;
};
const ctx = {} as Parameters<SidekickManager['trigger']>[2];

test('five production sidekicks ship, each gated by its flag', () => {
  expect(shipped.errors).toEqual([]);
  expect(shipped.specs.map((spec) => [spec.name, spec.featureFlag])).toEqual([
    ['cloud-session-search', 'CLOUD_SESSION_SEARCH_SIDEKICK_AGENT'],
    ['github-context-memory', 'GITHUB_CONTEXT_SIDEKICK_AGENT'],
    ['github-context', 'GITHUB_CONTEXT_SIDEKICK_AGENT_FULL'],
    ['session-search', 'SESSION_SEARCH_SIDEKICK_AGENT'],
    ['subconscious-agent', 'COPILOT_SUBCONSCIOUS'],
  ]);
  expect(named('subconscious-agent')).toMatchObject({ behavior: 'persistent', triggers: { 'user.message': 20, 'session.memory_changed': 5 } });
});

test('a sidekick file declares triggers, limits and delivery fields', () => {
  expect(named('github-context')).toMatchObject({ behavior: 'restart', cancelOnNewTurn: true, maxSendsPerTurn: 1, inlineForwardMaxChars: 1500, launchConditions: ['github-remote'], triggers: { 'user.message': 50 } });
});

test.for([
  { text: '---\nname: x\n---\nbody', error: 'Failed to parse sidekick bad.md: the frontmatter is missing or invalid fields.' },
  {
    text: '---\nname: x\ndescription: d\nfeatureFlag: F\nbehavior: persistent\ntriggers:\n  user.typed: 1\ncancelOnNewTurn: false\nmaxSendsPerTurn: 1\ninlineForwardMaxChars: 5\nlaunchConditions: []\ntools: []\n---\nbody',
    error: 'Failed to parse sidekick bad.md: unknown trigger user.typed.',
  },
])('a malformed definition is reported: $error', ({ text, error }) => {
  expect(parseSidekick(text, 'bad.md')).toEqual({ error });
});

const facts = (overrides: LaunchFacts = {}): LaunchFacts => ({ 'git-repo': false, 'github-remote': false, ...overrides });

test('a sidekick is enabled by its flag or the debug switch and by its launch conditions', () => {
  const spec = named('github-context');
  expect(sidekickEnabled(spec, {}, facts({ 'github-remote': true }))).toBe(false);
  expect(sidekickEnabled(spec, { GITHUB_CONTEXT_SIDEKICK_AGENT_FULL: '1' }, facts())).toBe(false);
  expect(sidekickEnabled(spec, { GITHUB_CONTEXT_SIDEKICK_AGENT_FULL: '1' }, facts({ 'github-remote': true }))).toBe(true);
  expect(sidekickEnabled(spec, { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'github_context_sidekick_agent_full' }, facts({ 'github-remote': true }))).toBe(true);
  expect(sidekickEnabled(spec, { COPILOT_DEBUG_ENABLE_SIDEKICKS: '1' }, facts({ 'github-remote': true }))).toBe(true);
});

function harness(specs: readonly SidekickSpec[], env: NodeJS.ProcessEnv = { COPILOT_DEBUG_ENABLE_SIDEKICKS: '1' }) {
  const calls: string[] = [];
  const states = new Map<string, 'running' | 'idle'>();
  const delivered: { message: string; truncated: boolean }[] = [];
  const logs: string[] = [];
  let next = 0;
  const ports: SidekickPorts = {
    launch: async (spec, text) => {
      const id = `${spec.name}-${next++}`;
      states.set(id, 'running');
      calls.push(`launch ${id} ${text}`);
      return id;
    },
    send: async (id, text) => {
      calls.push(`send ${id} ${text}`);
    },
    cancel: async (id) => {
      states.delete(id);
      calls.push(`cancel ${id}`);
    },
    state: (id) => states.get(id),
    facts: () => facts({ 'git-repo': true, 'github-remote': true }),
    deliver: (_spec, message, truncated) => delivered.push({ message, truncated }),
    log: (message) => logs.push(message),
  };
  return { manager: new SidekickManager(specs, env, ports), calls, states, delivered, logs };
}

test('a restart sidekick cancels and relaunches on each trigger', async () => {
  const { manager, calls } = harness([named('session-search')]);
  await manager.trigger('user.message', 'one', ctx);
  await manager.trigger('user.message', 'two', ctx);
  expect(calls).toEqual(['launch session-search-0 one', 'cancel session-search-0', 'launch session-search-1 two']);
});

test('a persistent sidekick is messaged instead of relaunched', async () => {
  const { manager, calls } = harness([named('subconscious-agent')]);
  await manager.trigger('user.message', 'one', ctx);
  await manager.trigger('user.message', 'two', ctx);
  await manager.trigger('session.context_changed', 'ignored', ctx);
  expect(calls).toEqual(['launch subconscious-agent-0 one', 'send subconscious-agent-0 two']);
});

test('a trigger past its limit logs "Sidekick trigger limit reached" once and does nothing', async () => {
  const spec: SidekickSpec = { ...named('session-search'), triggers: { 'user.message': 1 }, cancelOnNewTurn: false };
  const { manager, calls, logs } = harness([spec]);
  await manager.trigger('user.message', 'one', ctx);
  await manager.trigger('user.message', 'two', ctx);
  await manager.trigger('user.message', 'three', ctx);
  expect(calls).toHaveLength(1);
  expect(logs).toEqual([`${triggerLimitMessage}: session-search:user.message`]);
});

test('a disabled sidekick never launches', async () => {
  const { manager, calls } = harness([named('session-search')], {});
  await manager.trigger('user.message', 'one', ctx);
  expect(calls.length).toBe(0);
});

test('cancelOnNewTurn cancels a running sidekick before the next trigger and cancelAll stops them all', async () => {
  const spec: SidekickSpec = { ...named('subconscious-agent'), cancelOnNewTurn: true };
  const { manager, calls, states } = harness([spec]);
  await manager.trigger('user.message', 'one', ctx);
  expect(manager.hasActiveWork()).toBe(true);
  await manager.trigger('user.message', 'two', ctx);
  expect(calls).toEqual(['launch subconscious-agent-0 one', 'cancel subconscious-agent-0', 'launch subconscious-agent-1 two']);
  await manager.cancelAll();
  expect([...states.keys()]).toEqual([]);
  expect(manager.hasActiveWork()).toBe(false);
});

test('inbox messages obey maxSendsPerTurn and are cut at the inline limit', async () => {
  const spec: SidekickSpec = { ...named('session-search'), inlineForwardMaxChars: 5, maxSendsPerTurn: 2 };
  const { manager, delivered } = harness([spec]);
  await manager.trigger('user.message', 'one', ctx);
  expect([manager.inbox('session-search-0', 'tiny'), manager.inbox('session-search-0', 'far too long'), manager.inbox('session-search-0', 'third')]).toEqual([true, true, false]);
  expect(delivered).toEqual([
    { message: 'tiny', truncated: false },
    { message: 'far t', truncated: true },
  ]);
  await manager.trigger('user.message', 'again', ctx);
  expect(manager.inbox('unknown', 'x')).toBe(false);
});

test('send_inbox emits to the parent bus inside a sidekick and refuses elsewhere', async () => {
  const emitted: unknown[] = [];
  const child = sendInboxTool(
    (channel, data) => emitted.push([channel, data]),
    () => true,
  );
  expect((await child.execute('1', { message: 'hi' }, undefined, undefined, ctx as never)).content[0]).toEqual({ type: 'text', text: 'Message sent.' });
  expect(emitted).toEqual([['copilot:inbox', { message: 'hi' }]]);
  await expect(
    sendInboxTool(
      () => {},
      () => false,
    ).execute('1', { message: 'hi' }, undefined, undefined, ctx as never),
  ).rejects.toThrow('send_inbox is only available to sidekicks.');
});

test('the sidekick definition is hidden from the model and carries the output channel text', () => {
  const definition = sidekickDefinition(named('session-search'));
  expect(definition).toMatchObject({
    name: 'session-search',
    disableModelInvocation: true,
    userInvocable: false,
    tools: { kind: 'named', names: ['grep', 'find', 'read', 'send_inbox'] },
    promptParts: { includeOutputChannelInstructions: true },
  });
});

test('an enabled sidekick runs on the first user message and its inbox message reaches the parent', async () => {
  vi.stubEnv('COPILOT_DEBUG_ENABLE_SIDEKICKS', '1');
  const fixture = await workerFixture();
  const notices: unknown[] = [];
  fixture.eventBus.on('copilot:event', (payload) => {
    const event = payload as { type: string; data: unknown };
    if (event.type === 'system.notification') notices.push(event.data);
  });
  try {
    await fixture.session.prompt('hello sidekicks');
    await vi.waitFor(() => expect(notices).toEqual(expect.arrayContaining([{ kind: 'new_inbox_message', summary: 'Sidekick session-search sent a message.', sidekick: 'session-search' }])));
    expect(fixture.subagentLogs).toEqual([]);
  } finally {
    await fixture.close();
  }
});
