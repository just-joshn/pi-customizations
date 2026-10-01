import { expect, test } from 'vitest';
import { parseRegistration, RuntimeAgents } from '../src/subagents/runtime-agents.ts';

test.for([
  { title: 'a non-object payload', payload: 'agent' },
  { title: 'null', payload: null },
  { title: 'a missing plugin', payload: { name: 'n', spec: {} } },
  { title: 'an empty plugin', payload: { plugin: '', name: 'n', spec: {} } },
  { title: 'a non-string name', payload: { plugin: 'p', name: 3, spec: {} } },
  { title: 'an empty name', payload: { plugin: 'p', name: '', spec: {} } },
  { title: 'a missing spec', payload: { plugin: 'p', name: 'n' } },
  { title: 'a null spec', payload: { plugin: 'p', name: 'n', spec: null } },
])('parseRegistration rejects $title', ({ payload }) => {
  expect(parseRegistration(payload)).toBe(undefined);
  expect(parseRegistration({ plugin: 'p', name: 'n', spec: {} })).toEqual({ plugin: 'p', name: 'n', spec: {} });
});

test('parseRegistration keeps a loader function and drops other load values', async () => {
  const registration = parseRegistration({ plugin: 'p', name: 'n', spec: { description: 'd' }, load: async () => ({ description: 'd', prompt: 'x' }) });
  expect(await registration?.load?.()).toEqual({ description: 'd', prompt: 'x' });
  expect(parseRegistration({ plugin: 'p', name: 'n', spec: {}, load: 'nope' })).not.toHaveProperty('load');
});

test('registered specs become plugin definitions namespaced by plugin and name', () => {
  const agents = new RuntimeAgents();
  agents.register({ plugin: 'ext', name: 'helper', spec: { description: 'Runtime helper', prompt: 'Help.', tools: ['read'] } });
  const warnings: string[] = [];
  expect(agents.definitions((message) => warnings.push(message))).toEqual([
    { agentType: 'ext:helper', whenToUse: 'Runtime helper', systemPrompt: 'Help.', tools: ['read'], source: 'plugin', baseDir: 'plugin', plugin: 'ext', filename: 'helper', registeredAtRunTime: true },
  ]);
  expect(warnings).toEqual([]);
});

test('registering the same plugin and name again replaces the earlier registration and unregistering removes it', () => {
  const agents = new RuntimeAgents();
  agents.register({ plugin: 'ext', name: 'a', spec: { description: 'one', prompt: 'first' } });
  agents.register({ plugin: 'ext', name: 'a', spec: { description: 'two', prompt: 'second' } });
  agents.register({ plugin: 'ext', name: 'b', spec: { description: 'bee', prompt: 'b' } });
  expect(agents.definitions(() => {}).map((agent) => [agent.agentType, agent.systemPrompt])).toEqual([
    ['ext:a', 'second'],
    ['ext:b', 'b'],
  ]);
  agents.unregister('ext', 'a');
  agents.unregister('ext', 'missing');
  expect(agents.definitions(() => {}).map((agent) => agent.agentType)).toEqual(['ext:b']);
});

test('runtime definitions drop permissionMode and mcpServers and warn about each', () => {
  const agents = new RuntimeAgents();
  agents.register({ plugin: 'ext', name: 'bold', spec: { description: 'd', prompt: 'p', permissionMode: 'plan', mcpServers: ['docs'] } });
  const warnings: string[] = [];
  const [agent] = agents.definitions((message) => warnings.push(message));
  expect(agent).not.toHaveProperty('permissionMode');
  expect(agent).not.toHaveProperty('mcpServers');
  expect(warnings).toEqual(['Plugin agent ext:bold sets mcpServers, which is ignored for plugin agents.', 'Plugin agent ext:bold sets permissionMode, which is ignored for plugin agents.']);
});

test('an invalid spec is reported and skipped without hiding valid registrations', () => {
  const agents = new RuntimeAgents();
  agents.register({ plugin: 'ext', name: 'bad', spec: { description: 'only description' } });
  agents.register({ plugin: 'ext', name: 'good', spec: { description: 'd', prompt: 'p' } });
  const warnings: string[] = [];
  expect(agents.definitions((message) => warnings.push(message)).map((agent) => agent.agentType)).toEqual(['ext:good']);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatch(/^Failed to register agent ext:bad: ext:bad: /);
});

test('a registration with a loader yields a placeholder that loads the real definition on demand', async () => {
  const agents = new RuntimeAgents();
  agents.register({ plugin: 'ext', name: 'lazy', spec: { description: 'Lazy one' }, load: async () => ({ description: 'Real', prompt: 'Loaded.' }) });
  const [placeholder] = agents.definitions(() => {});
  expect(placeholder).toMatchObject({ agentType: 'ext:lazy', whenToUse: 'Lazy one', systemPrompt: '', source: 'plugin', registeredAtRunTime: true });
  expect(await placeholder?.loadDefinition?.()).toMatchObject({ agentType: 'ext:lazy', whenToUse: 'Real', systemPrompt: 'Loaded.', source: 'plugin', plugin: 'ext', filename: 'lazy' });
});

test('a lazy placeholder without a string description gets a generated one and a loader that returns nothing loads nothing', async () => {
  const agents = new RuntimeAgents();
  agents.register({ plugin: 'ext', name: 'none', spec: {}, load: async () => undefined });
  const [placeholder] = agents.definitions(() => {});
  expect(placeholder?.whenToUse).toBe('Agent from ext plugin');
  expect(await placeholder?.loadDefinition?.()).toBe(undefined);
});

test('a lazy loader may rename the agent within the plugin namespace', async () => {
  const agents = new RuntimeAgents();
  agents.register({ plugin: 'ext', name: 'lazy', spec: {}, load: async () => ({ name: 'other', description: 'd', prompt: 'p' }) });
  const [placeholder] = agents.definitions(() => {});
  expect(await placeholder?.loadDefinition?.()).toMatchObject({ agentType: 'ext:other', filename: 'lazy' });
});
