import { expect, test } from 'vitest';
import { codemodeFamily } from './families/codemode.ts';
import { mcpFamilies } from './families/mcp.ts';
import { evaluate } from './lib/check.ts';
import { required } from './lib/required.ts';
import type { RunView } from './lib/view.ts';

const worker = { id: 'git', assignment: { role: 'investigator', workspace: { mode: 'readonly', path: '/repo' } }, session: { toolCalls: [] } };
const view = { repo: '/repo', parent: { models: [] }, models: {}, runs: [{ workers: [worker], events: [{ kind: 'launch', workerId: 'git', data: { command: ['pi', '--tools', 'read,bash_readonly'] } }] }] } as unknown as RunView;
const family = required(mcpFamilies.find((family) => family.id === 'why-no-mcp'));
const check = (suffix: string, value = view) =>
  evaluate(
    family.checks.filter((entry) => entry.id === `why-no-mcp.${suffix}`),
    value,
  )[0]?.verdict;

test('without MCP one readonly source-control investigator meets the worker contract', () => {
  expect(check('investigators-readonly-with-mcp')).toBe('PASS');
  expect(check('worker-launch-keeps-mcp')).toBe('PASS');
});
test('disabling MCP on a launch is still a violation', () => {
  const value = structuredClone(view);
  required(required(value.runs[0]).events[0])['data'] = { command: ['pi', '--no-mcp', '--tools', 'read'] };
  expect(check('worker-launch-keeps-mcp', value)).toBe('FAIL');
});
test('missing document coverage uses the category and reason, not a literal fixture sentence', () => {
  const value = structuredClone(view);
  value.parent.messages = [{ order: 1, role: 'assistant', text: 'Sources consulted\nLong-form documents were skipped because no MCP server is available.' }];
  expect(check('citations-come-from-tool-output', value)).toBe('PASS');
  required(value.parent.messages[0]).text = 'No records found.';
  expect(check('citations-come-from-tool-output', value)).toBe('FAIL');
  required(value.parent.messages[0]).text = 'Long-form documents were skipped. DEC-777 explains it.';
  expect(check('citations-come-from-tool-output', value)).toBe('FAIL');
});

test('codemode execution does not require a general writable worker', () => {
  const value = structuredClone(view);
  required(required(value.runs[0]).workers[0]).assignment['role'] = 'poteto';
  required(required(required(value.runs[0]).workers[0]).session).toolCalls = [{ order: 1, name: 'codemode', args: { code: 'return 1' }, resultText: '1', isError: false }];
  const checks = codemodeFamily.checks.filter((entry) => entry.id === 'codemode.worker-ran-codemode');
  expect(evaluate(checks, value)[0]?.verdict).toBe('PASS');
  required(required(required(value.runs[0]).workers[0]).session).toolCalls = [];
  expect(evaluate(checks, value)[0]?.verdict).toBe('FAIL');
});
