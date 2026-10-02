import { expect, test } from 'vitest';
import { capResultText, concurrencyCap, defaultConcurrencyCap, defaultDepthCap, depthCap, environmentDepthCap, normalizeDescription, resultTextLimit, sessionSpawnCap, validateName } from '../src/subagents/limits.ts';
import { agentHex } from './agent-hex.ts';

test.for(['a', 'Agent_1', 'x-y', 'a'.repeat(64)])('name %s is valid', (name) => {
  expect(validateName(name)).toBe(undefined);
  expect(validateName(`-${name}`)?.code).toBe('subagent_name_invalid');
});

test.for(['', '-lead', '_x', 'has space', 'a'.repeat(65), 'dot.name'])('name %j is rejected for its shape', (name) => {
  expect(validateName(name)).toEqual({ code: 'subagent_name_invalid', message: 'name must start with a letter or digit and contain only letters, digits, underscores, or hyphens (max 64 chars)' });
});

test('the name main is reserved for the main conversation', () => {
  expect(validateName('main')).toEqual({ code: 'subagent_name_invalid', message: '"main" is reserved \u2014 SendMessage routes it to the main conversation' });
});

test.for(['Main', 'TEAM-LEAD', 'User', 'system', `a${agentHex}`, `ahelper-${agentHex}`])('name %s collides with a reserved name or agent id', (name) => {
  expect(validateName(name)?.message).toContain('must not be a reserved name');
});

test('descriptions collapse whitespace and trim', () => {
  expect(normalizeDescription('  a \n\t b   c ')).toBe('a b c');
});

test.for([
  { env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5' }, expected: 5 },
  { env: { PI_MAX_SUBAGENT_SPAWN_DEPTH: ' 7 ' }, expected: 7 },
  { env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '4', PI_MAX_SUBAGENT_SPAWN_DEPTH: '9' }, expected: 4 },
  { env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '0' }, expected: undefined },
  { env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '-2' }, expected: undefined },
  { env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2.5' }, expected: undefined },
  { env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '99999999999999999999' }, expected: undefined },
  { env: {}, expected: undefined },
])('environmentDepthCap of $env is $expected', ({ env, expected }) => {
  expect(environmentDepthCap(env)).toBe(expected);
});

test('the depth cap prefers the environment, then a valid setting, then the default', () => {
  expect(depthCap({ PI_MAX_SUBAGENT_SPAWN_DEPTH: '6' }, 2)).toBe(6);
  expect(depthCap({}, 2)).toBe(2);
  expect(depthCap({}, 0)).toBe(defaultDepthCap);
  expect(depthCap({}, 1.5)).toBe(defaultDepthCap);
  expect(depthCap({ PI_MAX_SUBAGENT_SPAWN_DEPTH: 'abc' })).toBe(defaultDepthCap);
});

test('the concurrency cap reads either variable and defaults to twenty', () => {
  expect(concurrencyCap({ CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '3' })).toBe(3);
  expect(concurrencyCap({ PI_MAX_CONCURRENT_SUBAGENTS: '8' })).toBe(8);
  expect(concurrencyCap({ PI_MAX_CONCURRENT_SUBAGENTS: '0' })).toBe(defaultConcurrencyCap);
  expect(concurrencyCap({})).toBe(20);
});

test('the session spawn cap is optional', () => {
  expect(sessionSpawnCap({ CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '12' })).toBe(12);
  expect(sessionSpawnCap({ PI_MAX_SUBAGENTS_PER_SESSION: '4' })).toBe(4);
  expect(sessionSpawnCap({ PI_MAX_SUBAGENTS_PER_SESSION: 'many' })).toBe(undefined);
  expect(sessionSpawnCap({})).toBe(undefined);
});

test('result text is truncated only beyond the limit', () => {
  const exact = 'x'.repeat(resultTextLimit);
  expect(capResultText(exact)).toBe(exact);
  expect(capResultText(`${exact}y`)).toBe(exact);
});
