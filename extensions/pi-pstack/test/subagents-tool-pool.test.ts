import { expect, test } from 'vitest';
import { builtinAgents } from '../src/subagents/builtins.ts';
import type { AgentDefinition } from '../src/subagents/definitions.ts';
import { toolAllowList, unrecognizedTools, zeroToolsError } from '../src/subagents/tool-pool.ts';

const all = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'Agent', 'mcp__foo__a', 'mcp__foo__b', 'mcp__bar__c'];
const base = { agentType: 't', whenToUse: '', systemPrompt: '', source: 'userSettings', baseDir: '/' } as const;
const def = (extra: Partial<AgentDefinition>): AgentDefinition => ({ ...base, ...extra }) as AgentDefinition;

test('[G2-22] definition tools restrict the child pool and unknown names never appear', () => {
  expect(toolAllowList(def({ tools: ['Read'] }), all)).toEqual(['read']);
  expect(toolAllowList(def({ tools: ['Read', 'Nope'] }), all)).toEqual(['read']);
  expect(toolAllowList(def({}), all)).toEqual(all);
  expect(toolAllowList(def({ disallowedTools: ['bash'] }), all)).not.toContain('bash');
});

test('[G2-22] Explore and Plan cannot call edit, write or the Agent tool', () => {
  for (const name of ['Explore', 'Plan']) {
    const pool = toolAllowList(builtinAgents({}).find((entry) => entry.agentType === name) as AgentDefinition, all);
    expect(pool.toSorted()).toEqual(['bash', 'find', 'grep', 'ls', 'read']);
  }
});

test('[G2-23] disallowed rules remove aliases and whole MCP server groups', () => {
  expect(toolAllowList(def({ disallowedTools: ['mcp__foo'] }), all)).toEqual(all.filter((name) => !name.startsWith('mcp__foo')));
  expect(toolAllowList(def({ disallowedTools: ['Glob', 'Write'] }), all)).toEqual(all.filter((name) => name !== 'find' && name !== 'write'));
  expect(toolAllowList(def({ tools: ['Write'], disallowedTools: ['Write'] }), all)).toEqual([]);
});

test.for([
  { rule: 'mcp__foo__*', allowed: ['mcp__foo__a', 'mcp__foo__b'], denied: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'Agent', 'mcp__bar__c'] },
  { rule: 'mcp__*', allowed: ['mcp__foo__a', 'mcp__foo__b', 'mcp__bar__c'], denied: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'Agent'] },
  { rule: 'mcp__foo', allowed: ['mcp__foo__a', 'mcp__foo__b'], denied: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'Agent', 'mcp__bar__c'] },
])('[G2-23] $rule resolves server groups in allow and deny lists', ({ rule, allowed, denied }) => {
  expect(toolAllowList(def({ tools: [rule] }), all)).toEqual(allowed);
  expect(toolAllowList(def({ disallowedTools: [rule] }), all)).toEqual(denied);
});

test('[G2-24] absent MCP server patterns are recognized but match no tools', () => {
  const missing = def({ tools: ['mcp__absent__*'] });
  expect(unrecognizedTools(missing, all)).toStrictEqual([]);
  expect(zeroToolsError(missing, all)).toContain('recognized but matched no tools in this session [mcp__absent__*]');
});

test('[G2-24] a tools list that resolves to nothing is refused with the unrecognized names', () => {
  const nothing = def({ tools: ['Nope'] });
  expect(unrecognizedTools(nothing, all)).toEqual(['Nope']);
  const message = zeroToolsError(nothing, all);
  expect(message).toContain('unrecognized [Nope]');
  expect(message).toContain('Its tools list resolved to nothing');
  expect(zeroToolsError(def({ tools: ['Read'] }), all)).toBeUndefined();
  expect(zeroToolsError(def({}), all)).toBeUndefined();
});
