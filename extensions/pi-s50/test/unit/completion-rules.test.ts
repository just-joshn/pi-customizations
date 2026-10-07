import { describe, expect, test } from 'vitest';
import type { RunState } from '../../src/domain/run.ts';
import type { Command } from '../../src/orchestrator/command.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { currentReview, prReadyBlockers } from '../../src/policy/completion.ts';
import { REVIEW_DIMENSIONS } from '../../src/review/reviewer.ts';
import { fixedClock } from '../support/clock.ts';
import { applyAll, expectOk, freshRun, graphNode, measured, satisfiedAt } from './support.ts';

const CRITERION = 'csv export lists every invoice';

function satisfied(): RunState {
  return satisfiedAt('REVERIFY_STALE', 'PR_READY');
}

function inPhase(phase: 'CLARIFY' | 'VERIFY' | 'REVIEW' | 'CONFIRM_TDD_SEAMS', state: RunState = freshRun()): RunState {
  return { ...state, run: { ...state.run, phase } };
}

describe('PR_READY needs something to prove', () => {
  test('a run without acceptance criteria is not ready', () => {
    const base = satisfied();
    expect(prReadyBlockers({ ...base, run: { ...base.run, acceptanceCriteria: [] } })).toEqual(['run has no acceptance criteria']);
  });
});

describe('the review covers every later change', () => {
  test('a change outside the graph write sets stales the review', () => {
    const base = inPhase('REVIEW');
    const reviewing = { ...base, graph: { schemaVersion: 1 as const, nodes: [graphNode('a', 'integrated', { writeSet: ['src/a/**'] })] } };
    const review: Command = { kind: 'record_review', reviewer: 'reviewer-1', independent: false, dimensions: [...REVIEW_DIMENSIONS], guidelinesContent: null };
    const { state } = applyAll(reviewing, [review, { kind: 'revision_changed', revision: 'r2', changedPaths: ['lib/new.ts'] }]);
    expect(currentReview(state)).toBeNull();
  });
});

describe('a routed failure is not forgotten', () => {
  test('a consumer failure stales the consumer measurements', () => {
    const { state } = applyAll(satisfied(), [{ kind: 'route_failure', check: 'consumer', detail: 'exit 1 on an empty list' }]);
    const latest = state.evidence.filter((record) => record.claim === CRITERION).at(-1);
    expect([state.run.phase, latest?.state, latest?.observed]).toEqual(['IMPLEMENT', 'STALE', 'stale: consumer failed: exit 1 on an empty list']);
  });

  test('a review failure stales the review', () => {
    const { state } = applyAll(satisfied(), [{ kind: 'route_failure', check: 'review', detail: 'missed an invariant' }]);
    expect(currentReview(state)).toBeNull();
  });
});

describe('diagnostic loops bind every run that records them', () => {
  test('a feature run with an unpromoted loop is not ready', () => {
    const base = satisfied();
    const loop = { id: 'l1', kind: 'failing_test', command: 'bun run test', symptom: 'crash', status: 'green', promotedTo: null, instrumentation: [] } as const;
    expect(prReadyBlockers({ ...base, run: { ...base.run, diagnostics: [loop] } })).toEqual(['diagnosed run lacks a diagnostic promoted to a confirmed seam']);
  });
});

describe('a FAILED measurement blocks until it is superseded', () => {
  test('a RED test that never turned GREEN blocks PR_READY', () => {
    const base = satisfied();
    const red = measured('tdd:seam-cli/empty list', 'r1', { criterion: 'tdd:seam-cli', state: 'FAILED', method: 'test', dependencies: ['src/**'] });
    expect(prReadyBlockers({ ...base, evidence: [...base.evidence, red] })).toEqual(['claim "tdd:seam-cli/empty list" was last measured FAILED']);
  });

  test('a RED test made STALE by a commit still blocks', () => {
    const base = satisfied();
    const red = measured('tdd:seam-cli/empty list', 'r0', { id: 'ev-red', criterion: 'tdd:seam-cli', state: 'FAILED', method: 'test', dependencies: ['src/**'] });
    const stale = { ...red, id: 'ev-stale', state: 'STALE' as const, supersedes: 'ev-red' };
    expect(prReadyBlockers({ ...base, evidence: [...base.evidence, red, stale] })).toEqual(['claim "tdd:seam-cli/empty list" was last measured FAILED']);
  });
});

describe('INCONCLUSIVE resumes only on the missing feedback', () => {
  test('an unrelated measurement leaves the run INCONCLUSIVE', () => {
    const inconclusive = expectOk(apply(inPhase('VERIFY'), { kind: 'declare_inconclusive', missing: 'agent-browser' }, fixedClock()));
    const lint: Command = { kind: 'record_evidence', evidence: { claim: 'lint', criterion: 'lint', state: 'MEASURED', dependencies: ['src/**'], method: 'cli', expected: 'clean', observed: 'clean', artifact: 'lint.log' } };
    expect(expectOk(apply(inconclusive, lint, fixedClock())).run.status).toEqual({ kind: 'inconclusive', missing: 'agent-browser' });
  });
});

describe('TDD tests belong to their seam', () => {
  test('RED at one seam does not unlock GREEN at another', () => {
    const seams = ['seam-a', 'seam-b'].map((id) => ({ id, description: `${id} API`, catches: 'regressions', misses: 'perf' }));
    const { state } = applyAll(inPhase('CONFIRM_TDD_SEAMS'), [
      { kind: 'propose_seams', seams },
      { kind: 'confirm_seams', ids: ['seam-a', 'seam-b'] },
      { kind: 'record_test', seam: 'seam-a', name: 't1', result: 'red', command: 'bun run test', observed: '1 failed', dependencies: [] },
    ]);
    const green: Command = { kind: 'record_test', seam: 'seam-b', name: 't1', result: 'green', command: 'bun run test', observed: '1 passed', dependencies: [] };
    expect(apply(state, green, fixedClock())).toEqual({ kind: 'rejected', reason: 'test t1 has no RED record at seam seam-b; prove it fails before recording GREEN', gate: null });
  });
});

describe('reserved decision ids', () => {
  test('a round cannot ask the shared-understanding id', () => {
    const question = { id: 'shared-understanding', title: 'Agreed?', body: 'Do we agree?', recommendation: 'yes', dependsOn: [] };
    expect(apply(inPhase('CLARIFY'), { kind: 'ask_decisions', questions: [question] }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'question id shared-understanding is reserved for confirm_understanding',
      gate: null,
    });
  });
});
