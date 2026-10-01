import { expect, test } from 'vitest';
import { normalizeAgentType, resolveAgentType } from '../src/subagents/admission.ts';
import type { AdmissionSnapshot } from '../src/subagents/types.ts';

const snapshot = (types: readonly string[], allowedAgentTypes?: readonly string[]): AdmissionSnapshot => ({
  agents: types.map((agentType) => ({ agentType, whenToUse: '' })),
  ...(allowedAgentTypes ? { allowedAgentTypes } : {}),
  forkAvailable: false,
  depth: 0,
  depthCap: 3,
  running: 0,
  concurrencyCap: 20,
  concurrencyBypass: false,
  spawnedThisSession: 0,
  spentUsd: 0,
  hasProject: true,
  stopPending: false,
});

test.for([
  { input: 'General Purpose', expected: 'generalpurpose' },
  { input: 'Ｅｘｐｌｏｒｅ', expected: 'explore' },
  { input: 'general–purpose', expected: 'generalpurpose' },
  { input: 'code_ review—bot', expected: 'codereviewbot' },
])('normalization is NFKC, lowercase, without whitespace, dashes or underscores: $input', ({ input, expected }) => {
  expect(normalizeAgentType(input)).toBe(expected);
});

test.for([
  { requested: 'Ｅｘｐｌｏｒｅ', type: 'Explore' },
  { requested: 'general–purpose', type: 'general-purpose' },
])('a single normalized match resolves: $requested', ({ requested, type }) => {
  expect(resolveAgentType(snapshot(['Explore', 'general-purpose']), requested)).toEqual({ type });
});

test('an ambiguous match lists unavailable candidates and names only the available ones', () => {
  expect(resolveAgentType(snapshot(['code-review', 'Code_Review', 'Plan'], ['code-review', 'Plan']), 'codereview')).toEqual({
    refusal: { code: 'subagent_type_ambiguous', message: "Agent type 'codereview' is ambiguous — matches code-review, Code_Review (unavailable). Use the exact name: code-review" },
  });
});

test('an ambiguous match with no available candidate lists the available agents', () => {
  expect(resolveAgentType(snapshot(['code-review', 'Code_Review', 'Plan'], ['Plan']), 'codereview')).toEqual({
    refusal: { code: 'subagent_type_ambiguous', message: "Agent type 'codereview' is ambiguous — matches code-review (unavailable), Code_Review (unavailable). None of these are available. Available agents: Plan" },
  });
});

test('a single normalized match outside the dispatchable pool is not found', () => {
  expect(resolveAgentType(snapshot(['code-review', 'Plan'], ['Plan']), 'Code Review')).toEqual({ refusal: { code: 'subagent_type_not_found', message: "Agent type 'Code Review' not found. Available agents: Plan" } });
});
