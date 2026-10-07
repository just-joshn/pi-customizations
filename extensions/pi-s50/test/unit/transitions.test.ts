import { describe, expect, test } from 'vitest';
import { PHASES, type Phase } from '../../src/domain/state.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { TRANSITIONS } from '../../src/orchestrator/transitions.ts';
import { fixedClock } from '../support/clock.ts';
import { freshRun, satisfiedAt } from './support.ts';

const legal = PHASES.flatMap((from) => TRANSITIONS[from].map((to): [Phase, Phase] => [from, to]));
const illegal = PHASES.flatMap((from) => PHASES.filter((to) => to !== from && !TRANSITIONS[from].includes(to)).map((to): [Phase, Phase] => [from, to]));

const expectedStatus = (to: Phase): string => {
  if (to === 'PR_READY') return 'pr_ready';
  if (to === 'EXPLICIT_TRIAGE' || to === 'EXPLICIT_ARCH_REVIEW') return 'blocked';
  return 'active';
};

describe('legal transitions', () => {
  test('table has 38 legal edges', () => {
    expect(legal.length).toBe(38);
  });

  test.for(legal)('%s -> %s is accepted with guards satisfied', ([from, to]) => {
    const outcome = apply(satisfiedAt(from, to), { kind: 'advance', to }, fixedClock());
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.state.run.phase).toBe(to);
    expect(outcome.state.run.status.kind).toBe(expectedStatus(to));
    expect(outcome.decisions.map((decision) => decision.summary)).toEqual([`advance ${from} -> ${to}`]);
  });
});

describe('illegal transitions', () => {
  test.for(illegal)('%s -> %s is rejected', ([from, to]) => {
    const outcome = apply(satisfiedAt(from, to), { kind: 'advance', to }, fixedClock());
    expect(outcome).toEqual({ kind: 'rejected', reason: `illegal transition ${from} -> ${to}`, gate: null });
  });

  test('advancing to the current phase is a no-op', () => {
    const state = satisfiedAt('DOMAIN', 'ARCHITECT');
    expect(apply(state, { kind: 'advance', to: 'DOMAIN' }, fixedClock())).toEqual({ kind: 'ok', state, decisions: [] });
  });
});

describe('transition guards', () => {
  test('CLARIFY -> DOMAIN needs shared understanding', () => {
    const state = { ...freshRun(), run: { ...freshRun().run, phase: 'CLARIFY' as const } };
    expect(apply(state, { kind: 'advance', to: 'DOMAIN' }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'cannot advance CLARIFY -> DOMAIN: shared understanding not confirmed',
      gate: null,
    });
  });

  test('CLASSIFY routes a feature run away from DIAGNOSE', () => {
    const state = { ...freshRun(), run: { ...freshRun().run, phase: 'CLASSIFY' as const } };
    const outcome = apply(state, { kind: 'advance', to: 'DIAGNOSE' }, fixedClock());
    expect(outcome).toEqual({ kind: 'rejected', reason: 'cannot advance CLASSIFY -> DIAGNOSE: mode feature routes to CLARIFY', gate: null });
  });

  test('blocked run cannot advance', () => {
    const base = satisfiedAt('DOMAIN', 'ARCHITECT');
    const gate = { kind: 'shared_understanding' } as const;
    const state = { ...base, run: { ...base.run, status: { kind: 'blocked' as const, gate } } };
    expect(apply(state, { kind: 'advance', to: 'ARCHITECT' }, fixedClock())).toEqual({ kind: 'rejected', reason: 'run blocked on shared_understanding gate', gate });
  });
});
