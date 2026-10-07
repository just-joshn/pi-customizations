import { describe, expect, test } from 'vitest';
import type { DiagnosticLoop } from '../../src/domain/run.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { fixedClock } from '../support/clock.ts';
import { applyAll, expectOk, freshRun } from './support.ts';

const SEAM = { id: 'seam-parser', description: 'parse(input) public API', catches: 'parse errors', misses: 'IO failures' };
const LOOP: DiagnosticLoop = { id: 'repro-1', kind: 'failing_test', command: 'bun run test -- parser', symptom: 'throws on empty line', status: 'red', promotedTo: null, instrumentation: ['log in parse()'] };

const tddTest = (result: 'red' | 'green') =>
  ({ kind: 'record_test', seam: 'seam-parser', name: 'empty line parses', result, command: 'bun run test -- parser', observed: result === 'red' ? 'TypeError' : '1 passed', dependencies: ['src/parser/**'] }) as const;

function inPhase(phase: 'DIAGNOSE' | 'CONFIRM_TDD_SEAMS') {
  const base = freshRun({ mode: 'bug' });
  return { ...base, run: { ...base.run, phase } };
}

describe('seam confirmation', () => {
  test('proposing seams blocks on user confirmation', () => {
    const state = expectOk(apply(inPhase('CONFIRM_TDD_SEAMS'), { kind: 'propose_seams', seams: [SEAM] }, fixedClock()));
    expect(state.run.status).toEqual({ kind: 'blocked', gate: { kind: 'seam_confirmation', seams: ['seam-parser'] } });
  });

  test('confirming the seam clears the gate', () => {
    const { state } = applyAll(inPhase('CONFIRM_TDD_SEAMS'), [
      { kind: 'propose_seams', seams: [SEAM] },
      { kind: 'confirm_seams', ids: ['seam-parser'] },
    ]);
    expect(state.run.status).toEqual({ kind: 'active' });
    expect(state.run.testContract.confirmedSeams).toEqual([SEAM]);
  });

  test('re-confirming a seam logs no decision', () => {
    const { state } = applyAll(inPhase('CONFIRM_TDD_SEAMS'), [
      { kind: 'propose_seams', seams: [SEAM] },
      { kind: 'confirm_seams', ids: ['seam-parser'] },
    ]);
    expect(apply(state, { kind: 'confirm_seams', ids: ['seam-parser'] }, fixedClock())).toEqual({ kind: 'ok', state, decisions: [] });
  });

  test('confirming an unknown seam is rejected', () => {
    expect(apply(inPhase('CONFIRM_TDD_SEAMS'), { kind: 'confirm_seams', ids: ['nope'] }, fixedClock())).toEqual({ kind: 'rejected', reason: 'unknown seam nope', gate: null });
  });
});

describe('TDD seams with diagnostics', () => {
  test('TDD test at an unconfirmed seam is rejected', () => {
    const state = expectOk(apply(inPhase('CONFIRM_TDD_SEAMS'), { kind: 'propose_seams', seams: [SEAM] }, fixedClock()));
    expect(apply(state, tddTest('red'), fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'seam seam-parser is not confirmed; TDD tests need a confirmed seam',
      gate: { kind: 'seam_confirmation', seams: ['seam-parser'] },
    });
  });

  test('diagnostic repro is accepted before any seam confirmation', () => {
    const outcome = apply(inPhase('DIAGNOSE'), { kind: 'record_diagnostic', loop: LOOP }, fixedClock());
    const state = expectOk(outcome);
    expect(state.run.testContract.confirmedSeams).toEqual([]);
    expect(state.run.diagnostics).toEqual([LOOP]);
    expect(outcome.kind === 'ok' && outcome.decisions[0]?.summary).toBe('diagnostic repro-1 (failing_test) is red');
  });

  test('a new diagnostic loop outside DIAGNOSE is rejected', () => {
    expect(apply(inPhase('CONFIRM_TDD_SEAMS'), { kind: 'record_diagnostic', loop: LOOP }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'new diagnostic loops are recorded in DIAGNOSE, not CONFIRM_TDD_SEAMS',
      gate: null,
    });
  });

  test('root cause needs a red diagnostic loop', () => {
    expect(apply(inPhase('DIAGNOSE'), { kind: 'record_root_cause', cause: 'x' }, fixedClock())).toEqual({ kind: 'rejected', reason: 'root cause requires a red diagnostic loop', gate: null });
  });

  test('diagnostic promotes into a confirmed seam', () => {
    const diagnosed = applyAll(inPhase('DIAGNOSE'), [{ kind: 'record_diagnostic', loop: LOOP }]).state;
    const seamPhase = { ...diagnosed, run: { ...diagnosed.run, phase: 'CONFIRM_TDD_SEAMS' as const } };
    const unconfirmed = apply(seamPhase, { kind: 'promote_diagnostic', loopId: 'repro-1', seamId: 'seam-parser' }, fixedClock());
    expect(unconfirmed).toEqual({ kind: 'rejected', reason: 'seam seam-parser is not confirmed', gate: { kind: 'seam_confirmation', seams: ['seam-parser'] } });
    const { state } = applyAll(seamPhase, [
      { kind: 'propose_seams', seams: [SEAM] },
      { kind: 'confirm_seams', ids: ['seam-parser'] },
      { kind: 'promote_diagnostic', loopId: 'repro-1', seamId: 'seam-parser' },
    ]);
    expect(state.run.diagnostics).toEqual([{ ...LOOP, promotedTo: 'seam-parser' }]);
  });

  test('the original reproducer turns green after the fix', () => {
    const diagnosed = applyAll(inPhase('DIAGNOSE'), [{ kind: 'record_diagnostic', loop: LOOP }]).state;
    const fixed = { ...diagnosed, run: { ...diagnosed.run, phase: 'VERIFY' as const } };
    const { state } = applyAll(fixed, [{ kind: 'record_diagnostic', loop: { ...LOOP, status: 'green', instrumentation: [] } }]);
    expect(state.run.diagnostics).toEqual([{ ...LOOP, status: 'green', instrumentation: [] }]);
  });
});

describe('TDD red then green', () => {
  function confirmed() {
    return applyAll(inPhase('CONFIRM_TDD_SEAMS'), [
      { kind: 'propose_seams', seams: [SEAM] },
      { kind: 'confirm_seams', ids: ['seam-parser'] },
    ]).state;
  }

  test('GREEN without a RED record is rejected', () => {
    expect(apply(confirmed(), tddTest('green'), fixedClock())).toEqual({ kind: 'rejected', reason: 'test empty line parses has no RED record at seam seam-parser; prove it fails before recording GREEN', gate: null });
  });

  test('RED then GREEN records failing then measured evidence', () => {
    const { state } = applyAll(confirmed(), [tddTest('red'), tddTest('green')]);
    expect(state.evidence.map((record) => [record.claim, record.criterion, record.state, record.observed])).toEqual([
      ['tdd:seam-parser/empty line parses', 'tdd:seam-parser', 'FAILED', 'TypeError'],
      ['tdd:seam-parser/empty line parses', 'tdd:seam-parser', 'MEASURED', '1 passed'],
    ]);
  });

  test('a GREEN test cannot be recorded RED at the same revision', () => {
    const { state } = applyAll(confirmed(), [tddTest('red'), tddTest('green')]);
    expect(apply(state, tddTest('red'), fixedClock())).toEqual({ kind: 'rejected', reason: 'test empty line parses is GREEN at this revision; write a new failing behavior test', gate: null });
  });

  test('a stale GREEN test can be recorded GREEN again', () => {
    const { state } = applyAll(confirmed(), [tddTest('red'), tddTest('green'), { kind: 'revision_changed', revision: 'r2', changedPaths: ['src/parser/split.ts'] }, tddTest('green')]);
    expect(state.evidence.map((record) => [record.state, record.revision])).toEqual([
      ['FAILED', 'r1'],
      ['MEASURED', 'r1'],
      ['STALE', 'r1'],
      ['MEASURED', 'r2'],
    ]);
  });

  test('TDD evidence cannot be forged through record_evidence', () => {
    const forged = { claim: 'tdd:seam-parser/empty line parses', criterion: 'tdd:seam-parser', state: 'MEASURED', dependencies: [], method: 'test', expected: '', observed: '', artifact: '' } as const;
    expect(apply(confirmed(), { kind: 'record_evidence', evidence: forged }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'review, prototype, and TDD evidence come only from record_review, record_prototype, and record_test',
      gate: null,
    });
  });
});

describe('diagnosis without a feedback loop', () => {
  const NO_LOOP = { kind: 'declare_inconclusive', missing: 'production log access' } as const;

  test('no feedback loop leaves the bug run INCONCLUSIVE', () => {
    const state = expectOk(apply(inPhase('DIAGNOSE'), NO_LOOP, fixedClock()));
    expect(state.run.status).toEqual({ kind: 'inconclusive', missing: 'production log access' });
  });

  test('an INCONCLUSIVE run cannot advance past diagnosis', () => {
    const state = expectOk(apply(inPhase('DIAGNOSE'), NO_LOOP, fixedClock()));
    expect(apply(state, { kind: 'advance', to: 'DOMAIN' }, fixedClock())).toEqual({ kind: 'rejected', reason: 'run is INCONCLUSIVE: missing production log access', gate: null });
  });

  test('a new red loop resumes the INCONCLUSIVE run', () => {
    const state = expectOk(apply(inPhase('DIAGNOSE'), NO_LOOP, fixedClock()));
    expect(expectOk(apply(state, { kind: 'record_diagnostic', loop: LOOP }, fixedClock())).run.status).toEqual({ kind: 'active' });
  });

  test('INCONCLUSIVE cannot be declared during implementation', () => {
    expect(apply(inPhase('CONFIRM_TDD_SEAMS'), NO_LOOP, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'inconclusive is declared in DIAGNOSE, VERIFY, REVERIFY_STALE, not CONFIRM_TDD_SEAMS',
      gate: null,
    });
  });
});

describe('frontend design brief', () => {
  test('DESIGN cannot hand off with an incomplete brief', () => {
    const base = freshRun({ mode: 'frontend' });
    const decisions = [{ id: 'design.subject', question: 'subject?', answer: 'invoice table', decidedBy: 'user' as const }];
    const state = { ...base, run: { ...base.run, phase: 'DESIGN' as const, domain: { ...base.run.domain, decisions } } };
    expect(apply(state, { kind: 'advance', to: 'CONFIRM_TDD_SEAMS' }, fixedClock())).toEqual({
      kind: 'rejected',
      reason:
        'cannot advance DESIGN -> CONFIRM_TDD_SEAMS: design brief incomplete: audience, primary_job, visual_direction, information_hierarchy, layout, typography, interaction_model, responsive_behavior, loading_state, empty_state, error_state, accessibility',
      gate: null,
    });
  });
});
