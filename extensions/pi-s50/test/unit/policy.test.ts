import { describe, expect, test } from 'vitest';
import type { EvidenceState } from '../../src/domain/evidence.ts';
import { apply, preflight } from '../../src/orchestrator/coordinator.ts';
import { gatedAction, grantMatches } from '../../src/policy/authorization.ts';
import { prReadyBlockers, requiredEvidence } from '../../src/policy/completion.ts';
import { canModelInvoke, routeSkills } from '../../src/policy/invocation.ts';
import { fixedClock } from '../support/clock.ts';
import { CLEAN_REPO, freshRun, measured, NO_CAPS, registry, satisfiedAt } from './support.ts';

const CRITERION = 'csv export lists every invoice';

describe('invocation policy', () => {
  test.for([
    ['tdd', { kind: 'allowed' }],
    ['grilling', { kind: 'allowed' }],
    ['triage', { kind: 'user_only', action: '/skill:triage' }],
    ['grill-me', { kind: 'user_only', action: '/skill:grill-me' }],
    ['improve-codebase-architecture', { kind: 'user_only', action: '/skill:improve-codebase-architecture' }],
    ['code-review', { kind: 'not_in_registry' }],
  ] as const)('%s -> %o', ([skill, expected]) => {
    expect(
      canModelInvoke(registry(), skill, [
        { name: 'tdd', contentHash: null },
        { name: 'grilling', contentHash: null },
      ]),
    ).toEqual(expected);
  });

  test('uninstalled model skill yields an install command', () => {
    expect(canModelInvoke(registry(), 'tdd', [])).toEqual({ kind: 'not_installed', install: 'npx skills add mattpocock/skills --skill tdd' });
  });

  test('react constraint adds vercel-react-best-practices in DESIGN', () => {
    expect(routeSkills('DESIGN', { modelChange: false, reactStack: true, webUi: true, browserConsumer: true })).toEqual(['frontend-design', 'vercel-react-best-practices']);
  });

  test('domain-modeling routes only on a model change', () => {
    const facts = { modelChange: false, reactStack: false, webUi: false, browserConsumer: false };
    expect([routeSkills('DOMAIN', facts), routeSkills('DOMAIN', { ...facts, modelChange: true })]).toEqual([[], ['domain-modeling']]);
  });
});

describe('user-only gate', () => {
  test('auto-invoking triage is rejected with the user gate', () => {
    const outcome = apply(freshRun(), { kind: 'invoke_skill', skill: 'triage' }, fixedClock());
    expect(outcome).toEqual({
      kind: 'rejected',
      reason: 'triage is user-only; the user must run /skill:triage',
      gate: { kind: 'user_workflow', skill: 'triage', action: '/skill:triage' },
    });
  });

  test('EXPLICIT_TRIAGE blocks until the user completes triage', () => {
    const state = satisfiedAt('CLASSIFY', 'EXPLICIT_TRIAGE');
    const clock = fixedClock();
    const entered = apply(state, { kind: 'advance', to: 'EXPLICIT_TRIAGE' }, clock);
    if (entered.kind !== 'ok') throw new Error(entered.reason);
    expect(entered.state.run.status).toEqual({ kind: 'blocked', gate: { kind: 'user_workflow', skill: 'triage', action: '/skill:triage' } });
    const wrong = apply(entered.state, { kind: 'complete_user_workflow', skill: 'grill-me' }, clock);
    expect(wrong.kind === 'rejected' && wrong.reason).toBe('no grill-me gate is open');
    const cleared = apply(entered.state, { kind: 'complete_user_workflow', skill: 'triage' }, clock);
    expect(cleared.kind === 'ok' && cleared.state.run.status).toEqual({ kind: 'active' });
  });

  test('external issue without tracker doc needs setup workflow', () => {
    expect(preflight(freshRun({ mode: 'external_issue' }), { ...CLEAN_REPO, issueTrackerDoc: false })).toEqual({
      kind: 'user_workflow',
      skill: 'setup-matt-pocock-skills',
      action: '/skill:setup-matt-pocock-skills',
    });
  });

  test('preflight reports the first missing model skill', () => {
    expect(preflight(freshRun({ capabilities: NO_CAPS }), CLEAN_REPO)).toEqual({
      kind: 'missing_skill',
      skill: 'grilling',
      install: 'npx skills add mattpocock/skills --skill grilling',
    });
  });
});

describe('authorization', () => {
  test.for([
    ['git push --force origin main', 'force_push'],
    ['git push -f origin feature', 'force_push'],
    ['git push origin +main', 'force_push'],
    ['gh pr merge 64 --squash', 'merge'],
    ['vercel deploy --prod', 'deploy'],
    ['terraform apply -auto-approve', 'deploy'],
    ['git reset --hard HEAD~3', 'destructive_data_deletion'],
    ['psql -c "DROP TABLE invoices"', 'destructive_data_deletion'],
    ['rm -rf ~/data', 'destructive_data_deletion'],
    ['gh pr create --title x', 'public_message'],
    ['bun publish', 'irreversible_action'],
  ] as const)('%s needs %s authorization', ([command, action]) => {
    expect(gatedAction(command)).toBe(action);
  });

  test.for(['git push origin feature', 'git status', 'rm -rf dist', 'bun run test', 'gh pr view 64'])('%s needs no authorization', (command) => {
    expect(gatedAction(command)).toBeNull();
  });

  test('only the exact action with scope clears the gate', () => {
    const clock = fixedClock();
    const requested = apply(freshRun(), { kind: 'request_authorization', action: 'deploy', scope: 'prod' }, clock);
    if (requested.kind !== 'ok') throw new Error(requested.reason);
    const gate = { kind: 'authorization', action: 'deploy', scope: 'prod' } as const;
    expect(grantMatches(gate, 'deploy', 'staging')).toBe(false);
    expect(apply(requested.state, { kind: 'grant_authorization', action: 'deploy', scope: 'staging' }, clock)).toEqual({
      kind: 'rejected',
      reason: 'grant deploy staging does not match pending deploy prod',
      gate,
    });
    const granted = apply(requested.state, { kind: 'grant_authorization', action: 'deploy', scope: 'prod' }, clock);
    expect(granted.kind === 'ok' && granted.state.run.status).toEqual({ kind: 'active' });
  });
});

describe('completion', () => {
  test('requiredEvidence yields one entry per criterion', () => {
    const base = freshRun({ criteria: ['a', 'b'] });
    const state = { ...base, evidence: [measured('a', 'r1')] };
    expect(requiredEvidence(state).map((required) => [required.criterion, required.satisfied])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  test.for(['UNKNOWN', 'INCONCLUSIVE', 'INFERRED', 'STALE', 'FAILED'] satisfies EvidenceState[])('%s never satisfies completion', (evidenceState) => {
    const base = satisfiedAt('REVERIFY_STALE', 'PR_READY');
    const state = { ...base, evidence: [...base.evidence.filter((record) => record.claim !== CRITERION), measured(CRITERION, 'r1', { state: evidenceState })] };
    expect(prReadyBlockers(state)).toEqual([`criterion "${CRITERION}" lacks MEASURED cli evidence at r1 (${evidenceState}@r1)`]);
    expect(apply(state, { kind: 'advance', to: 'PR_READY' }, fixedClock()).kind).toBe('rejected');
  });

  test('PR_READY predicate holds for a satisfied run', () => {
    const state = satisfiedAt('REVERIFY_STALE', 'PR_READY');
    const outcome = apply(state, { kind: 'advance', to: 'PR_READY' }, fixedClock());
    expect([prReadyBlockers(state).length, outcome.kind === 'ok' && outcome.state.run.status]).toEqual([0, { kind: 'pr_ready', revision: 'r1' }]);
  });

  test('PR_READY predicate lists every unmet condition', () => {
    const base = freshRun({ mode: 'bug' });
    const loop = { id: 'l', kind: 'fuzz', command: 'x', symptom: 'y', status: 'red', promotedTo: null, instrumentation: ['console.log in parse()'] } as const;
    expect(prReadyBlockers({ ...base, run: { ...base.run, diagnostics: [loop] } })).toEqual([
      'revision not frozen',
      `criterion "${CRITERION}" lacks MEASURED cli evidence at r1`,
      'no review at r1',
      'graph has no nodes',
      'diagnostic l still red',
      'diagnostic l still has temporary instrumentation: console.log in parse()',
      'bug run lacks root cause',
      'bug run lacks a diagnostic promoted to a confirmed seam',
    ]);
  });

  test('measured evidence at an older revision does not satisfy', () => {
    const base = satisfiedAt('REVERIFY_STALE', 'PR_READY');
    const state = { ...base, run: { ...base.run, currentRevision: 'r2', frozenRevision: 'r2' } };
    expect(prReadyBlockers(state)).toEqual([`criterion "${CRITERION}" lacks MEASURED cli evidence at r2 (MEASURED@r1)`, 'no review at r2']);
  });

  test('a test record alone never stands in for the consumer path', () => {
    const base = satisfiedAt('REVERIFY_STALE', 'PR_READY');
    const state = { ...base, evidence: [...base.evidence.filter((record) => record.claim !== CRITERION), measured(CRITERION, 'r1', { method: 'test' })] };
    expect(prReadyBlockers(state)).toEqual([`criterion "${CRITERION}" lacks MEASURED cli evidence at r1 (MEASURED@r1)`]);
  });
});
