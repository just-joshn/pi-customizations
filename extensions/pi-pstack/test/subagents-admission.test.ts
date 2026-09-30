import { expect, test } from 'vitest';
import { decideAdmission, resolveAgentType } from '../src/subagents/admission.ts';
import { capResultText, concurrencyCap, depthCap, normalizeDescription, sessionSpawnCap, validateName } from '../src/subagents/limits.ts';
import type { AdmissionSnapshot } from '../src/subagents/types.ts';

const base: AdmissionSnapshot = {
  agents: [
    { agentType: 'general-purpose', whenToUse: 'any' },
    { agentType: 'Explore', whenToUse: 'read only' },
  ],
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
};
const request = { description: ' a  b\n c ', prompt: 'p' };

test('[G1-05] description whitespace runs collapse and trim', () => {
  expect(normalizeDescription('  a   b\n c ')).toBe('a b c');
  expect(normalizeDescription('a \n b')).toBe('a b');
  const decision = decideAdmission(base, request);
  expect(decision.ok && decision.plan.description).toBe('a b c');
});

test.each([
  ['-a', false],
  ['a'.repeat(65), false],
  ['a'.repeat(64), true],
  ['a_b-1', true],
  ['main', false],
  ['SYSTEM', false],
  ['User', false],
  ['Team-Lead', false],
  [`agent-${'ab'.repeat(8)}`, false],
])('[G1-06] worker name %s is accepted=%s', (name, accepted) => {
  const refusal = validateName(name);
  expect(refusal === undefined).toBe(accepted);
  if (name === '-a') expect(refusal?.message).toBe('name must start with a letter or digit and contain only letters, digits, underscores, or hyphens (max 64 chars)');
});

test('[G1-10] unknown type returns the sorted available list and no plan', () => {
  const decision = decideAdmission(base, { ...request, subagentType: 'does-not-exist' });
  expect(decision).toEqual({ ok: false, refusal: { code: 'subagent_type_not_found', message: "Agent type 'does-not-exist' not found. Available agents: Explore, general-purpose" } });
  expect(resolveAgentType({ ...base, agents: [], allowedAgentTypes: [] }, 'x')).toEqual({ refusal: { code: 'subagent_type_not_found', message: "Agent type 'x' not found. Available agents: none" } });
});

test('[G1-10] allowed list limits dispatch and omitted type needs general-purpose', () => {
  const allowed = { ...base, allowedAgentTypes: ['Explore'] };
  expect(resolveAgentType(allowed, 'general-purpose')).toMatchObject({ refusal: { code: 'subagent_type_not_found' } });
  const required = resolveAgentType({ ...allowed, forkAvailable: true }, undefined);
  expect('refusal' in required && required.refusal.message).toBe('subagent_type is required: the general-purpose agent is not available in this session. Available agents: fork, Explore');
});

test('[G1-10] normalized and ambiguous type matches', () => {
  expect(resolveAgentType(base, 'explore')).toEqual({ type: 'Explore' });
  const twin = { ...base, agents: [...base.agents, { agentType: 'explore', whenToUse: 'x' }, { agentType: 'EXPLORE', whenToUse: 'y' }] };
  const ambiguous = resolveAgentType(twin, 'Explore ');
  expect('refusal' in ambiguous && ambiguous.refusal.message).toContain('is ambiguous — matches');
});

test('[G1-10] fork resolves only when available', () => {
  expect(resolveAgentType({ ...base, forkAvailable: true }, 'fork')).toEqual({ type: 'fork' });
  expect(resolveAgentType(base, 'fork')).toMatchObject({ refusal: { code: 'subagent_type_not_found' } });
});

test('[G1-12] depth cap defaults to 3 and honors the environment', () => {
  expect(depthCap({})).toBe(3);
  expect(depthCap({ CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5' })).toBe(5);
  expect(depthCap({}, 7)).toBe(7);
  expect(depthCap({ CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '0' })).toBe(3);
});

test('[G1-12] depth refusal message and counter', () => {
  const decision = decideAdmission({ ...base, depth: 3 }, request);
  expect(decision).toMatchObject({ ok: false, counter: 'depth_limit', refusal: { code: 'subagent_depth_cap' } });
  expect(!decision.ok && decision.refusal.message.startsWith('Subagent nesting limit reached (depth 3 of 3). Complete this task directly using your tools instead of spawning another agent.')).toBe(true);
  expect(!decision.ok && decision.refusal.message).toContain('CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH');
  const ok = decideAdmission({ ...base, depth: 2 }, request);
  expect(ok.ok && ok.plan.depth).toBe(3);
});

test('[G1-13] top level plan depth is one', () => {
  const decision = decideAdmission(base, request);
  expect(decision.ok && decision.plan.depth).toBe(1);
});

test('[G1-14] concurrency cap defaults to 20 and refuses at the cap', () => {
  expect(concurrencyCap({})).toBe(20);
  expect(concurrencyCap({ CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '2' })).toBe(2);
  const decision = decideAdmission({ ...base, running: 20 }, request);
  expect(decision).toEqual({
    ok: false,
    counter: 'concurrency_limit',
    refusal: {
      code: 'subagent_concurrency_limit',
      message: 'Concurrent subagent limit reached. You can run 20 subagents at once. Do not retry. If the user wants more concurrent subagents, ask them to increase CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS.',
    },
  });
});

test('[G1-15] concurrency bypass admits beyond the cap', () => {
  expect(decideAdmission({ ...base, running: 25, concurrencyBypass: true }, request).ok).toBe(true);
});

test.each([
  [5, 5, 'Budget limit reached ($5.00 spent of the $5 maximum). New agents cannot be started.'],
  [1.5, 1, 'Budget limit reached ($1.50 spent of the $1 maximum). New agents cannot be started.'],
])('[G1-17] budget %s of %s refuses', (spent, max, prefix) => {
  const decision = decideAdmission({ ...base, spentUsd: spent, maxBudgetUsd: max }, request);
  expect(decision).toMatchObject({ ok: false, counter: 'budget' });
  expect(!decision.ok && decision.refusal.message.startsWith(prefix)).toBe(true);
});

test('[G1-18] session spawn cap refuses the third spawn and counts as budget', () => {
  expect(sessionSpawnCap({ CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '2' })).toBe(2);
  expect(decideAdmission({ ...base, sessionSpawnCap: 2, spawnedThisSession: 2 }, request)).toMatchObject({ ok: false, counter: 'budget' });
  expect(decideAdmission({ ...base, sessionSpawnCap: 2, spawnedThisSession: 1 }, request).ok).toBe(true);
});

test('[G1-11] preconditions refuse before a plan exists', () => {
  expect(decideAdmission({ ...base, hasProject: false }, request)).toEqual({
    ok: false,
    refusal: { code: 'subagent_no_directory_in_cwd_scope', message: 'A subagent cannot be started from here in this session. Do the task without a subagent.' },
  });
  expect(decideAdmission({ ...base, stopPending: true }, request)).toMatchObject({ ok: false, refusal: { code: 'subagent_stop_pending' } });
  expect(decideAdmission(base, { ...request, cwd: '/x', isolation: 'worktree' })).toMatchObject({ ok: false, refusal: { code: 'subagent_isolation_conflict' } });
});

test('[G1-11] omitted background flag plans a background run', () => {
  const omitted = decideAdmission(base, request);
  const foreground = decideAdmission(base, { ...request, runInBackground: false });
  expect(omitted.ok && omitted.plan.background).toBe(true);
  expect(foreground.ok && foreground.plan.background).toBe(false);
});

test('[G1-07] result text is capped at 100000 characters', () => {
  expect(capResultText('x'.repeat(100001))).toHaveLength(100000);
  expect(capResultText('short')).toBe('short');
});
