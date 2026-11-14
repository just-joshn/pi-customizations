import { expect, test } from 'vitest';

import { codemodeFamily } from './families/codemode.ts';
import { mcpFamilies } from './families/mcp.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const worker = { id: 'git', assignment: { role: 'investigator', workspace: { mode: 'readonly', path: '/repo' } }, session: { toolCalls: [] } };
const view = { repo: '/repo', parent: { models: [] }, models: {}, runs: [{ workers: [worker], events: [{ kind: 'launch', workerId: 'git', data: { command: ['pi', '--tools', 'read,bash_readonly'] } }] }] } as unknown as RunView;
const family = mcpFamilies.find((family) => family.id === 'why-no-mcp')!;
const check = (suffix: string, value = view) => evaluate(family.checks.filter((entry) => entry.id === `why-no-mcp.${suffix}`), value)[0]?.verdict;

test('without MCP one readonly source-control investigator meets the worker contract', () => {
  expect(check('investigators-readonly-with-mcp')).toBe('PASS');
  expect(check('worker-launch-keeps-mcp')).toBe('PASS');
});
test('disabling MCP on a launch is still a violation', () => {
  const value = structuredClone(view);
  value.runs[0]!.events[0]!['data'] = { command: ['pi', '--no-mcp', '--tools', 'read'] };
  expect(check('worker-launch-keeps-mcp', value)).toBe('FAIL');
});
test('codemode execution does not require a general writable worker', () => {
  const value = structuredClone(view);
  value.runs[0]!.workers[0]!.assignment['role'] = 'poteto';
  value.runs[0]!.workers[0]!.session!.toolCalls = [{ order: 1, name: 'codemode', args: { code: 'return 1' }, resultText: '1', isError: false }];
  const checks = codemodeFamily.checks.filter((entry) => entry.id === 'codemode.worker-ran-codemode');
  expect(evaluate(checks, value)[0]?.verdict).toBe('PASS');
  value.runs[0]!.workers[0]!.session!.toolCalls = [];
  expect(evaluate(checks, value)[0]?.verdict).toBe('FAIL');
});
