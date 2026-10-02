import { expect, test, vi } from 'vitest';
import type { AgentDefinition } from '../src/subagents/definitions.ts';
import { canonicalTool, inheritedPool, toolAllowList, unrecognizedTools, zeroToolsError } from '../src/subagents/tool-pool.ts';

const all = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'Agent', 'mcp__foo__a', 'mcp__foo__b', 'mcp__bar__c', 'SubagentHandback'];
const base: AgentDefinition = { agentType: 't', whenToUse: '', systemPrompt: '', source: 'userSettings', baseDir: '/' };
const def = (extra: Partial<AgentDefinition>): AgentDefinition => ({ ...base, ...extra });

test.for([
  { name: 'Read', expected: 'read' },
  { name: 'Glob', expected: 'find' },
  { name: 'Bash(git status:*)', expected: 'bash' },
  { name: 'LS', expected: 'ls' },
  { name: 'Task', expected: 'Agent' },
  { name: 'agent', expected: 'Agent' },
  { name: 'MCP__FOO__A', expected: 'mcp__foo__a' },
  { name: 'Nope', expected: undefined },
])('canonicalTool resolves $name to $expected', ({ name, expected }) => {
  expect(canonicalTool(name, all)).toBe(expected);
});

test('an exact tool name wins over aliasing', () => {
  expect(canonicalTool('Glob', ['Glob', 'find'])).toBe('Glob');
});

test('the inherited pool keeps parent tools plus the handback tool', () => {
  expect(inheritedPool(all, ['read', 'Agent'])).toEqual(['read', 'Agent', 'SubagentHandback']);
  expect(inheritedPool(all, undefined)).toEqual(all);
});

test('an explicit inherited pool replaces the full pool for unrestricted agents but not for named tools', () => {
  expect(toolAllowList(def({}), all, ['read', 'ls'])).toEqual(['read', 'ls']);
  expect(toolAllowList(def({ tools: ['*'] }), all, ['read'])).toEqual(['read']);
  expect(toolAllowList(def({ tools: ['grep'] }), all, ['read'])).toEqual(['grep']);
});

test('the Agent alias resolves only when the session offers it and denying it also denies Task', () => {
  expect(toolAllowList(def({ tools: ['Task'] }), all)).toEqual(['Agent']);
  expect(toolAllowList(def({ tools: ['Task'] }), ['read'])).toEqual([]);
  expect(toolAllowList(def({ disallowedTools: ['Agent'] }), ['read', 'Agent', 'Task'])).toEqual(['read']);
});

test('a bare MCP prefix or trailing wildcard selects every tool of that server', () => {
  expect(toolAllowList(def({ tools: ['mcp__foo__*'] }), all)).toEqual(['mcp__foo__a', 'mcp__foo__b']);
  expect(toolAllowList(def({ tools: ['mcp__bar'] }), all)).toEqual(['mcp__bar__c']);
});

test('malformed MCP patterns are unrecognized, not treated as server groups', () => {
  expect(unrecognizedTools(def({ tools: ['mcp__fo*o', 'mcp__foo__a__b', 'mcp__', 'mcp__fo*__*'] }), all)).toEqual(['mcp__fo*o', 'mcp__foo__a__b', 'mcp__', 'mcp__fo*__*']);
  expect(unrecognizedTools(def({ tools: ['*', 'Read', 'mcp__gone__*', 'mcp__gone'] }), all)).toEqual([]);
});

test('memory adds read, write and edit to a restricted pool unless memory is disabled', () => {
  const memory = def({ tools: ['grep'], memory: 'project' });
  expect(toolAllowList(memory, all)).toEqual(['grep', 'read', 'write', 'edit']);
  vi.stubEnv('PI_DISABLE_AGENT_MEMORY', '1');
  expect(toolAllowList(memory, all)).toEqual(['grep']);
});

test('memory only adds tools the session actually has', () => {
  expect(toolAllowList(def({ tools: ['grep'], memory: 'user' }), ['grep', 'read'])).toEqual(['grep', 'read']);
});

test('zero-tools refusal names both unrecognized and unmatched entries', () => {
  const message = zeroToolsError(def({ tools: ['Nope', 'mcp__gone__*'] }), all);
  expect(message).toBe(
    "Agent 't' would be spawned with zero tools; refusing. Its tools list resolved to nothing: unrecognized [Nope]; recognized but matched no tools in this session [mcp__gone__*]. Fix the agent's tools frontmatter or pass a different subagent_type.",
  );
});

test.for([
  { title: 'continuations', definition: def({ tools: ['Nope'] }), pool: all, continuation: true },
  { title: 'empty pools', definition: def({ tools: ['Nope'] }), pool: [], continuation: false },
  { title: 'wildcards', definition: def({ tools: ['*', 'Nope'] }), pool: all, continuation: false },
  { title: 'denied-only tools', definition: def({ tools: ['Read'], disallowedTools: ['Read'] }), pool: all, continuation: false },
])('zero-tools refusal is skipped for $title', ({ definition, pool, continuation }) => {
  expect(zeroToolsError(definition, pool, continuation)).toBe(undefined);
});
