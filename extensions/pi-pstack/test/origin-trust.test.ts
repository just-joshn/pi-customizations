import { expect, test } from 'vitest';
import type { AgentDefinition, AgentSource } from '../src/subagents/definitions.ts';
import { authorizeDefinition, executableAuthority, hasExecutableConfig } from '../src/subagents/origin-trust.ts';

const hooks = { PreToolUse: [{ hooks: [{ command: 'guard' }] }] } satisfies NonNullable<AgentDefinition['hooks']>;
const mcpServers = [{ kind: 'ref', name: 'github' }] satisfies NonNullable<AgentDefinition['mcpServers']>;

function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return { agentType: 'reviewer', whenToUse: 'reviews', systemPrompt: 'review', source: 'userSettings', baseDir: '/agents', ...overrides };
}

test.for<AgentSource>(['built-in', 'userSettings', 'flagSettings', 'policySettings'])('%s agents may run executable config regardless of project trust', (source) => {
  expect(executableAuthority(definition({ source }), false)).toEqual({ allowed: true });
});

test.for([
  { name: 'trusted project agents are allowed', projectTrusted: true, extra: {}, expected: { allowed: true } },
  { name: 'untrusted project agents are refused', projectTrusted: false, extra: {}, expected: { allowed: false, reason: 'the project folder is not trusted' } },
  { name: 'untrusted additional-directory agents name that directory', projectTrusted: false, extra: { fromAdditionalDirectory: true }, expected: { allowed: false, reason: 'the additional directory is not trusted' } },
] as const)('$name', ({ projectTrusted, extra, expected }) => {
  expect(executableAuthority(definition({ source: 'projectSettings', ...extra }), projectTrusted)).toEqual(expected);
});

test('plugin agents are always refused, even in a trusted project', () => {
  expect(executableAuthority(definition({ source: 'plugin' }), true)).toEqual({ allowed: false, reason: 'plugin agents cannot declare hooks or MCP servers' });
});

test.for([
  { name: 'hooks', overrides: { hooks }, expected: true },
  { name: 'MCP servers', overrides: { mcpServers }, expected: true },
  { name: 'neither', overrides: {}, expected: false },
])('an agent with $name is executable config: $expected', ({ overrides, expected }) => {
  expect(hasExecutableConfig(definition(overrides))).toBe(expected);
});

test('an agent without executable config passes through untouched and silently', () => {
  const logs: string[] = [];
  const plain = definition({ source: 'plugin' });
  expect(authorizeDefinition(plain, false, (message) => logs.push(message))).toBe(plain);
  expect(logs).toEqual([]);
});

test('an authorized agent keeps its hooks and servers', () => {
  const trusted = definition({ source: 'projectSettings', hooks, mcpServers });
  const logs: string[] = [];
  expect(authorizeDefinition(trusted, true, (message) => logs.push(message))).toBe(trusted);
  expect(logs).toEqual([]);
});

test('an unauthorized agent loses hooks and servers, keeps everything else, and the refusal is logged', () => {
  const logs: string[] = [];
  const untrusted = definition({ source: 'plugin', model: 'fast', hooks, mcpServers });
  const result = authorizeDefinition(untrusted, true, (message) => logs.push(message));
  expect(result).toEqual(definition({ source: 'plugin', model: 'fast' }));
  expect('hooks' in result || 'mcpServers' in result).toBe(false);
  expect(logs).toEqual(['[Agent: reviewer] Skipping frontmatter hooks and MCP servers: plugin agents cannot declare hooks or MCP servers']);
  expect(untrusted.hooks).toBe(hooks);
});
