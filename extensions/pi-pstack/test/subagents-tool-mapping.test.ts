import { expect, test } from 'vitest';
import { namedTools } from '../src/subagents/agent-definition.ts';
import { planTools, zeroToolsMessage } from '../src/subagents/tool-mapping.ts';

const shellList = ['BackgroundShell', 'List'].join('');
const shellStop = ['BackgroundShell', 'Stop'].join('');
const issues = ['mcp', 'github', 'issues'].join('__');
const pulls = ['mcp', 'github', 'pulls'].join('__');
const available = ['read', 'grep', 'find', 'bash', 'edit', 'write', shellList, shellStop, 'task', 'read_agent', issues, pulls, 'session_history'];

test('an all-tools agent inherits what the parent has and hides context tools by default', () => {
  const plan = planTools({ definition: { tools: { kind: 'all' } }, parentTools: ['read', 'bash', 'session_history'], available, contextManagement: false });
  expect(plan).toEqual({ declared: ['*'], effective: ['read', 'bash'], unmatched: [] });
});

test('context tools reach a child only when contextManagementTools is on', () => {
  const plan = planTools({ definition: { tools: { kind: 'all' } }, parentTools: ['read', 'session_history'], available, contextManagement: true });
  expect(plan.effective).toEqual(['read', 'session_history']);
});

test('declared Copilot names map onto pi tool names', () => {
  const plan = planTools({ definition: { tools: namedTools(['grep', 'glob', 'view', 'bash', 'read_bash', 'stop_bash']) }, parentTools: available, available, contextManagement: false });
  expect(plan.effective).toEqual(['grep', 'find', 'read', 'bash', shellList, shellStop]);
  expect(plan.declared).toEqual(['grep', 'glob', 'view', 'bash', 'read_bash', 'stop_bash']);
});

test('declared names with no pi equivalent are dropped and reported', () => {
  const plan = planTools({ definition: { tools: namedTools(['grep', 'lsp', 'powershell']) }, parentTools: available, available, contextManagement: false });
  expect(plan).toEqual({ declared: ['grep', 'lsp', 'powershell'], effective: ['grep'], unmatched: ['lsp', 'powershell'] });
});

test('a server wildcard selects that server tools', () => {
  const plan = planTools({ definition: { tools: namedTools(['github/*']) }, parentTools: available, available, contextManagement: false });
  expect(plan.effective).toEqual([issues, pulls]);
});

test('parent restrictions persist: a child never gains a tool the parent lacks', () => {
  const plan = planTools({ definition: { tools: namedTools(['grep', 'edit', 'write']) }, parentTools: ['grep', 'read'], available, contextManagement: false });
  expect(plan.effective).toEqual(['grep']);
  expect(plan.unmatched).toEqual(['edit', 'write']);
});

test('an agent whose declared tools all vanish is refused with a zero-tools message', () => {
  const plan = planTools({ definition: { tools: namedTools(['lsp']) }, parentTools: available, available, contextManagement: false });
  expect(zeroToolsMessage('mine', plan)).toBe("Agent 'mine' would be spawned with zero tools; refusing. None of its declared tools [lsp] exist in this session.");
  expect(zeroToolsMessage('mine', { declared: ['*'], effective: [], unmatched: [] })).toBe(undefined);
});
