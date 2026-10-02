import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { decideAdmission, resolveAgentType } from '../src/subagents/admission.ts';
import { forkAvailability, forkGateEnabled } from '../src/subagents/fork-gate.ts';
import type { AdmissionSnapshot } from '../src/subagents/types.ts';
import { scratchDir } from './support/scratch.ts';

const agents = [{ agentType: 'general-purpose', whenToUse: 'any' }];
const snapshot: AdmissionSnapshot = { agents, forkAvailable: true, depth: 0, depthCap: 3, running: 0, concurrencyCap: 20, concurrencyBypass: false, spawnedThisSession: 0, spentUsd: 0, hasProject: true, stopPending: false };

const gateOnFor = (root: string) => ({ CLAUDE_CODE_FORK_SUBAGENT: '1', HOME: root });

test.for([
  { label: 'unset', env: {}, enabled: false },
  { label: 'claude flag', env: { CLAUDE_CODE_FORK_SUBAGENT: '1' }, enabled: true },
  { label: 'claude flag zero', env: { CLAUDE_CODE_FORK_SUBAGENT: '0' }, enabled: false },
  { label: 'pi flag', env: { PI_FORK_SUBAGENT: 'true' }, enabled: true },
])('[B31] fork gate reads $label', ({ env, enabled }) => {
  expect(forkGateEnabled(env)).toBe(enabled);
});

test('[A74] fork is unavailable without the gate', () => {
  const emptyRoot = scratchDir('fork-gate-');
  expect(forkAvailability({ env: { HOME: emptyRoot }, root: emptyRoot, agents, allowedAgentTypes: undefined })).toEqual({ available: false });
});

test('[A74] fork is available with the gate and no conflicting agent', () => {
  const emptyRoot = scratchDir('fork-gate-');
  const gateOn = gateOnFor(emptyRoot);
  expect(forkAvailability({ env: gateOn, root: emptyRoot, agents, allowedAgentTypes: undefined })).toEqual({ available: true });
});

test('[A74] an active agent named fork (normalized) disables the fork type', () => {
  const emptyRoot = scratchDir('fork-gate-');
  const gateOn = gateOnFor(emptyRoot);
  expect(forkAvailability({ env: gateOn, root: emptyRoot, agents: [...agents, { agentType: 'Fork', whenToUse: '' }], allowedAgentTypes: undefined })).toEqual({ available: false });
});

test('[A74] an allowed list must permit fork', () => {
  const emptyRoot = scratchDir('fork-gate-');
  const gateOn = gateOnFor(emptyRoot);
  expect(forkAvailability({ env: gateOn, root: emptyRoot, agents, allowedAgentTypes: ['general-purpose'] })).toEqual({ available: false });
  expect(forkAvailability({ env: gateOn, root: emptyRoot, agents, allowedAgentTypes: ['fork'] })).toEqual({ available: true });
});

test('[A74] an Agent(fork) deny rule in project settings blocks fork and names its source', () => {
  const root = scratchDir('fork-deny-');
  const gateOn = gateOnFor(scratchDir('fork-gate-'));
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude/settings.json'), JSON.stringify({ permissions: { deny: ['Agent(fork)'] } }));
  expect(forkAvailability({ env: gateOn, root, agents, allowedAgentTypes: undefined })).toEqual({ available: false, denied: { rule: 'Agent(fork)', source: 'projectSettings' } });
});

test('[A74] requesting a denied fork is refused with the permission rule message', () => {
  const denied = { ...snapshot, forkAvailable: false, forkDenial: { rule: 'Agent(fork)', source: 'projectSettings' } };
  expect(resolveAgentType(denied, 'fork')).toEqual({ refusal: { code: 'subagent_type_denied', message: "Agent type 'fork' has been denied by permission rule 'Agent(fork)' from projectSettings." } });
});

test('[A74] fork type matching ignores case and separators', () => {
  expect(resolveAgentType(snapshot, 'Fork')).toEqual({ type: 'fork' });
});

test('[A74] fork refuses remote isolation', () => {
  expect(decideAdmission(snapshot, { description: 'd', prompt: 'p', subagentType: 'fork', isolation: 'remote' })).toEqual({
    ok: false,
    refusal: {
      code: 'subagent_fork_remote_isolation',
      message: 'Fork cannot use isolation: "remote" — a remote session cannot inherit the conversation context. Omit isolation (or use "worktree"), or spawn a named agent type for remote work.',
    },
  });
});

test('[A74] fork refuses to run inside a forked worker', () => {
  expect(decideAdmission({ ...snapshot, insideFork: true }, { description: 'd', prompt: 'p', subagentType: 'fork' })).toEqual({
    ok: false,
    refusal: { code: 'subagent_recursive_fork', message: 'Fork is not available inside a forked worker. Complete your task directly using your tools.' },
  });
});

test('[A74] worktree isolation is allowed for fork', () => {
  const decision = decideAdmission(snapshot, { description: 'd', prompt: 'p', subagentType: 'fork', isolation: 'worktree' });
  expect(decision.ok && decision.plan.agentType).toBe('fork');
});
