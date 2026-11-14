import { expect, test } from 'vitest';
import { codemodeFamily } from './families/codemode.ts';
import { historyFamilies } from './families/history.ts';
import { mcpFamilies } from './families/mcp.ts';
import { evaluate } from './lib/check.ts';
import { required } from './lib/required.ts';
import type { RunView } from './lib/view.ts';

const empty = { driver: 'real', sandbox: '/absent', repo: '/absent/repo', parent: { messages: [], toolCalls: [] }, runs: [] } as unknown as RunView;

test('real codemode runs do not fail for unrequested scripted slot and large-output probes', () => {
  const checks = codemodeFamily.checks.filter((check) => /isolated|concurrent|sessions-do-not-share|large-output/.test(check.id));
  expect(evaluate(checks, empty).map((result) => [result.scope, result.verdict])).toEqual(Array.from({ length: 6 }, () => ['adaptation', 'INCONCLUSIVE']));
});
test('a real trail need not invent the scripted tests-green correction row', () => {
  const checks = required(historyFamilies.find((family) => family.id === 'show-me-your-work')).checks.filter((check) => check.id === 'trail.append-only-wrong-call-gets-a-superseding-row');
  expect(evaluate(checks, empty).map((result) => [result.scope, result.verdict])).toEqual([['adaptation', 'INCONCLUSIVE']]);
});

test('real why runs do not claim control-worker and write-refusal probes were exercised', () => {
  const checks = required(mcpFamilies.find((family) => family.id === 'why-no-mcp')).checks.filter((check) => /worker-discovers-and-calls|readonly-holds-beside-mcp/.test(check.id));
  expect(evaluate(checks, empty).map((result) => [result.scope, result.verdict])).toEqual([
    ['adaptation', 'INCONCLUSIVE'],
    ['adaptation', 'INCONCLUSIVE'],
  ]);
});
