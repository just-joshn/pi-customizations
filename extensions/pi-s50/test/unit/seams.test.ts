import { describe, expect, test } from 'vitest';
import type { DiagnosticLoop } from '../../src/domain/run.ts';
import { fixedClock } from '../../src/orchestrator/clock.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { applyAll, expectOk, freshRun } from './support.ts';

const SEAM = { id: 'seam-parser', description: 'parse(input) public API', catches: 'parse errors', misses: 'IO failures' };
const LOOP: DiagnosticLoop = { id: 'repro-1', kind: 'failing_test', command: 'npm test -- parser', symptom: 'throws on empty line', status: 'red', promotedTo: null };

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
    expect(apply(state, { kind: 'record_test', seam: 'seam-parser', test: 'tdd' }, fixedClock())).toEqual({
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

  test('diagnostic recording outside DIAGNOSE is rejected', () => {
    expect(apply(inPhase('CONFIRM_TDD_SEAMS'), { kind: 'record_diagnostic', loop: LOOP }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'diagnostic loops are recorded in DIAGNOSE, not CONFIRM_TDD_SEAMS',
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
      { kind: 'record_test', seam: 'seam-parser', test: 'tdd' },
    ]);
    expect(state.run.diagnostics).toEqual([{ ...LOOP, status: 'promoted', promotedTo: 'seam-parser' }]);
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
