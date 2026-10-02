import { expect, test } from 'vitest';
import { duplicateLogs, resolvePrecedence, sanitizeDisplay } from '../src/subagents/agent-precedence.ts';
import type { AgentDefinition } from '../src/subagents/definitions.ts';

const base: AgentDefinition = { agentType: 'a', whenToUse: 'w', systemPrompt: 'p', source: 'userSettings', baseDir: '/u' };
const make = (extra: Partial<AgentDefinition>): AgentDefinition => ({ ...base, ...extra });

test('sanitizeDisplay collapses control characters and whitespace and caps the length at 200', () => {
  expect(sanitizeDisplay(['  a', '\u0000', '\u200B', 'b \n\t c  '].join(''))).toBe('a b c');
  expect(sanitizeDisplay('x'.repeat(250))).toBe('x'.repeat(200));
});

test('every tier overrides the earlier ones in order and the result is sorted by name', () => {
  const tiers: AgentDefinition['source'][] = ['built-in', 'plugin', 'userSettings', 'projectSettings', 'flagSettings', 'policySettings'];
  const candidates = tiers.map((source) => make({ source, systemPrompt: source }));
  expect(resolvePrecedence(candidates).map((agent) => agent.systemPrompt)).toEqual(['policySettings']);
  expect(resolvePrecedence(candidates.slice(0, 4)).map((agent) => agent.systemPrompt)).toEqual(['projectSettings']);
  const names = ['zeta', 'alpha', 'Mid'].map((agentType) => make({ agentType }));
  expect(resolvePrecedence(names).map((agent) => agent.agentType)).toEqual(['alpha', 'Mid', 'zeta']);
});

test('additional-directory agents lose to the deepest project directory regardless of input order', () => {
  const deep = make({ source: 'projectSettings', baseDir: '/repo/pkg/.pi/agents', systemPrompt: 'deep' });
  const shallow = make({ source: 'projectSettings', baseDir: '/repo/.pi/agents', systemPrompt: 'shallow' });
  const extra = make({ source: 'projectSettings', baseDir: '/else', systemPrompt: 'extra', fromAdditionalDirectory: true });
  expect(resolvePrecedence([deep, extra, shallow]).map((agent) => agent.systemPrompt)).toEqual(['deep']);
  expect(resolvePrecedence([extra, shallow]).map((agent) => agent.systemPrompt)).toEqual(['shallow']);
});

test('duplicates report their file paths and mark the active one', () => {
  const first = make({ filePath: '/u/a1.md', systemPrompt: '1' });
  const second = make({ filePath: '/u/a2.md', systemPrompt: '2' });
  expect(duplicateLogs([first, second], resolvePrecedence([first, second]))).toEqual(["[agents] Duplicate agent name 'a' (userSettings): /u/a2.md, /u/a1.md — active: /u/a2.md"]);
});

test('duplicates without a file path fall back to plugin name, base directory and filename, then the source', () => {
  const plugin = [make({ source: 'plugin', plugin: 'kit', baseDir: '/k' }), make({ source: 'plugin', plugin: 'kit', baseDir: '/k' })];
  expect(duplicateLogs(plugin, resolvePrecedence(plugin))).toEqual(["[agents] Duplicate agent name 'a' (plugin): plugin 'kit', plugin 'kit' — active: plugin 'kit'"]);
  const named = [make({ filename: 'x' }), make({ filename: 'y' })];
  expect(duplicateLogs(named, resolvePrecedence(named))).toEqual(["[agents] Duplicate agent name 'a' (userSettings): /u/y.md, /u/x.md — active: /u/y.md"]);
  const bare = [make({ baseDir: '' }), make({ baseDir: '' })];
  expect(duplicateLogs(bare, resolvePrecedence(bare))).toEqual(["[agents] Duplicate agent name 'a' (userSettings): userSettings, userSettings — active: userSettings"]);
});

test('a plugin agent without a plugin name and a file name falls through to its base directory entry', () => {
  const agents = [make({ source: 'plugin', baseDir: '/k', filename: 'f' }), make({ source: 'plugin', baseDir: '/k', filename: 'g' })];
  expect(duplicateLogs(agents, resolvePrecedence(agents))).toEqual(["[agents] Duplicate agent name 'a' (plugin): /k/g.md, /k/f.md — active: /k/g.md"]);
});

test('shadowed duplicate groups are listed without an active marker and groups are sorted by name', () => {
  const lowB = [make({ agentType: 'b', filePath: '/u/b1.md' }), make({ agentType: 'b', filePath: '/u/b2.md' })];
  const lowA = [make({ agentType: 'a', filePath: '/u/a1.md' }), make({ agentType: 'a', filePath: '/u/a2.md' })];
  const policy = [make({ agentType: 'a', source: 'policySettings', baseDir: '/pol', filePath: '/pol/a.md' })];
  const candidates = [...lowB, ...lowA, ...policy];
  expect(duplicateLogs(candidates, resolvePrecedence(candidates))).toEqual(["[agents] Duplicate agent name 'a' (userSettings): /u/a1.md, /u/a2.md", "[agents] Duplicate agent name 'b' (userSettings): /u/b2.md, /u/b1.md — active: /u/b2.md"]);
});

test('built-in agents never produce duplicate logs and display text is sanitized', () => {
  const builtins = [make({ source: 'built-in' }), make({ source: 'built-in' })];
  expect(duplicateLogs(builtins, resolvePrecedence(builtins))).toEqual([]);
  const dirty = [make({ agentType: 'x\u0007y', filePath: '/u/\u0000one.md' }), make({ agentType: 'x\u0007y', filePath: '/u/two.md' })];
  expect(duplicateLogs(dirty, resolvePrecedence(dirty))).toEqual(["[agents] Duplicate agent name 'x y' (userSettings): /u/two.md, /u/ one.md — active: /u/two.md"]);
});
