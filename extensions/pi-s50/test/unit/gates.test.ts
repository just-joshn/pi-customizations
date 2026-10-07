import { describe, expect, test } from 'vitest';
import type { Command } from '../../src/orchestrator/command.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { fixedClock } from '../support/clock.ts';
import { applyAll, expectOk, freshRun, node, satisfiedAt } from './support.ts';

function ready() {
  return expectOk(apply(satisfiedAt('REVERIFY_STALE', 'PR_READY'), { kind: 'advance', to: 'PR_READY' }, fixedClock()));
}

function inPhase(phase: 'CLARIFY' | 'VERIFY' | 'CONFIRM_TDD_SEAMS') {
  const base = freshRun();
  return { ...base, run: { ...base.run, phase } };
}

const FINDING: Extract<Command, { kind: 'record_finding' }>['finding'] = {
  severity: 'high',
  trigger: 'negative totals',
  consequence: 'CSV totals wrong',
  evidence: 'artifacts/totals.log',
  owner: 'IMPLEMENT',
  reviewer: 'reviewer-agent',
};

describe('reserved records', () => {
  test('a review cannot be forged through record_evidence', () => {
    const forged: Command = {
      kind: 'record_evidence',
      evidence: { claim: 'review', criterion: 'review', state: 'MEASURED', dependencies: [], method: 'cli', expected: '', observed: '', artifact: '' },
    };
    expect(apply(inPhase('VERIFY'), forged, fixedClock())).toEqual({ kind: 'rejected', reason: 'review, prototype, and TDD evidence come only from record_review, record_prototype, and record_test', gate: null });
  });

  test('shared understanding cannot be forged through answer_decisions', () => {
    const forged: Command = { kind: 'answer_decisions', decisions: [{ id: 'shared-understanding', question: 'ok?', answer: 'yes', decidedBy: 'user' }] };
    expect(apply(inPhase('CLARIFY'), forged, fixedClock())).toEqual({ kind: 'rejected', reason: 'shared-understanding is recorded only by confirm_understanding', gate: null });
  });

  test('a confirmed seam cannot be rewritten under its id', () => {
    const seam = { id: 's1', description: 'export CLI', catches: 'format', misses: 'perf' };
    const confirmed = expectOk(apply(expectOk(apply(inPhase('CONFIRM_TDD_SEAMS'), { kind: 'propose_seams', seams: [seam] }, fixedClock())), { kind: 'confirm_seams', ids: ['s1'] }, fixedClock()));
    expect(apply(confirmed, { kind: 'propose_seams', seams: [{ ...seam, description: 'internal helper' }] }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'confirmed seam s1 cannot change; propose it under a new id',
      gate: null,
    });
  });
});

describe('human gates', () => {
  test('declaring INCONCLUSIVE cannot erase an authorization gate', () => {
    const gated = expectOk(apply(inPhase('VERIFY'), { kind: 'request_authorization', action: 'deploy', scope: 'staging' }, fixedClock()));
    expect(apply(gated, { kind: 'declare_inconclusive', missing: 'browser' }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'run blocked on authorization gate',
      gate: { kind: 'authorization', action: 'deploy', scope: 'staging' },
    });
  });

  test('merge authorization in PR_READY keeps the gate', () => {
    const gated = expectOk(apply(ready(), { kind: 'request_authorization', action: 'merge', scope: 'PR 12' }, fixedClock()));
    expect([gated.run.phase, gated.run.status]).toEqual(['PR_READY', { kind: 'blocked', gate: { kind: 'authorization', action: 'merge', scope: 'PR 12' } }]);
  });

  test('granting merge authorization returns the run to pr_ready', () => {
    const gated = expectOk(apply(ready(), { kind: 'request_authorization', action: 'merge', scope: 'PR 12' }, fixedClock()));
    expect(expectOk(apply(gated, { kind: 'grant_authorization', action: 'merge', scope: 'PR 12' }, fixedClock())).run.status).toEqual({ kind: 'pr_ready', revision: 'r1' });
  });
});

describe('live PR_READY predicate', () => {
  test('a new finding moves PR_READY back to REVERIFY_STALE', () => {
    const outcome = apply(ready(), { kind: 'record_finding', finding: FINDING }, fixedClock());
    const state = expectOk(outcome);
    expect([state.run.phase, state.run.status]).toEqual(['REVERIFY_STALE', { kind: 'active' }]);
    expect(outcome.kind === 'ok' && outcome.decisions.map((decision) => decision.summary)).toEqual(['high finding finding-1 by reviewer-agent', 'left PR_READY: open high finding finding-1']);
  });

  test('a FAILED measurement moves PR_READY back to REVERIFY_STALE', () => {
    const failed: Command = {
      kind: 'record_evidence',
      evidence: { claim: 'csv export lists every invoice', criterion: 'csv export lists every invoice', state: 'FAILED', dependencies: ['src/**'], method: 'cli', expected: 'rows', observed: 'none', artifact: 'a.log' },
    };
    expect(expectOk(apply(ready(), failed, fixedClock())).run.phase).toBe('REVERIFY_STALE');
  });
});

describe('redaction of stored text', () => {
  test('redaction covers finding free text', () => {
    // biome-ignore lint/security/noSecrets: synthetic test values
    const [evidence, consequence] = [['curl -H', 'Bearer', 'abcdef123456'].join(' '), ['login with', ['password', 'hunter2'].join('=')].join(' ')];
    const state = expectOk(apply(inPhase('VERIFY'), { kind: 'record_finding', finding: { ...FINDING, evidence, consequence } }, fixedClock()));
    expect([state.findings[0]?.evidence, state.findings[0]?.consequence]).toEqual(['curl -H Bearer <REDACTED>', `login with ${'password'}=<REDACTED>`]);
  });

  test('identifiers that look like secrets stay distinct', () => {
    const base = inPhase('VERIFY');
    const nodes = ['sk-login-flow', 'sk-signup-flow'].map((id) => node(id));
    const state = expectOk(apply({ ...base, run: { ...base.run, phase: 'BUILD_GRAPH' } }, { kind: 'build_graph', nodes }, fixedClock()));
    expect(state.graph.nodes.map((item) => item.id)).toEqual(['sk-login-flow', 'sk-signup-flow']);
  });
});

describe('user decisions', () => {
  const ASKED: Command = { kind: 'ask_decisions', questions: [{ id: 'q1', title: 'Format', body: 'CSV?', recommendation: 'CSV', dependsOn: [] }] };

  function clarifying() {
    const base = freshRun();
    return { ...base, run: { ...base.run, phase: 'CLARIFY' as const } };
  }

  test('a question put to the user cannot be answered as a fact', () => {
    const asked = expectOk(apply(clarifying(), ASKED, fixedClock()));
    expect(apply(asked, { kind: 'answer_decisions', decisions: [{ id: 'q1', question: 'CSV?', answer: 'CSV', decidedBy: 'fact' }] }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: "question q1 was put to the user; only the user's answer records it",
      gate: null,
    });
  });

  test('a fact cannot replace a user decision', () => {
    const { state } = applyAll(clarifying(), [ASKED, { kind: 'answer_decisions', decisions: [{ id: 'q1', question: 'CSV?', answer: 'CSV', decidedBy: 'user' }] }]);
    expect(apply(state, { kind: 'answer_decisions', decisions: [{ id: 'q1', question: 'CSV?', answer: 'TSV', decidedBy: 'fact' }] }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: "decision q1 is the user's; a fact cannot replace it",
      gate: null,
    });
  });
});

describe('INCONCLUSIVE runs', () => {
  test('an INCONCLUSIVE run refuses an authorization request', () => {
    const inconclusive = expectOk(apply(inPhase('VERIFY'), { kind: 'declare_inconclusive', missing: 'agent-browser' }, fixedClock()));
    expect(apply(inconclusive, { kind: 'request_authorization', action: 'deploy', scope: 'prod' }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'run is INCONCLUSIVE: missing agent-browser; resolve it before an irreversible action',
      gate: null,
    });
  });
});
