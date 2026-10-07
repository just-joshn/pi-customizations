import { describe, expect, test } from 'vitest';
import type { Phase } from '../../src/domain/state.ts';
import type { Command } from '../../src/orchestrator/command.ts';
import { apply, applyPreflight, nextAction, startRun } from '../../src/orchestrator/coordinator.ts';
import { fixedClock } from '../support/clock.ts';
import { applyAll, CLEAN_REPO, expectOk, freshRun, graphNode, INSTALLED, measured, NO_CAPS, node, registry, satisfiedAt } from './support.ts';

function inPhase(phase: Phase, mode: 'feature' | 'frontend' | 'bug' = 'feature') {
  const base = freshRun({ mode });
  return { ...base, run: { ...base.run, phase } };
}

const QUESTION = { id: 'q-format', title: 'Export format', body: 'CSV or TSV?', recommendation: 'CSV', dependsOn: [] };

describe('clarification frontier', () => {
  test('a decision round blocks on the decisions gate', () => {
    const state = expectOk(apply(inPhase('CLARIFY'), { kind: 'ask_decisions', questions: [QUESTION] }, fixedClock()));
    expect(state.run.status).toEqual({ kind: 'blocked', gate: { kind: 'decisions', questions: [QUESTION] } });
  });

  test('a question that depends on an open one belongs to a later round', () => {
    const later = { ...QUESTION, id: 'q-delimiter', dependsOn: ['q-format'] };
    expect(apply(inPhase('CLARIFY'), { kind: 'ask_decisions', questions: [QUESTION, later] }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'question q-delimiter depends on an undecided question; it belongs to a later round',
      gate: null,
    });
  });

  test('answering the whole round clears the gate', () => {
    const { state } = applyAll(inPhase('CLARIFY'), [
      { kind: 'ask_decisions', questions: [QUESTION] },
      { kind: 'answer_decisions', decisions: [{ id: 'q-format', question: 'CSV or TSV?', answer: 'CSV', decidedBy: 'user' }] },
    ]);
    expect(state.run.status).toEqual({ kind: 'active' });
  });

  test('an empty round asks for shared understanding', () => {
    const state = expectOk(apply(inPhase('CLARIFY'), { kind: 'ask_decisions', questions: [] }, fixedClock()));
    expect(state.run.status).toEqual({ kind: 'blocked', gate: { kind: 'shared_understanding' } });
  });

  test('understanding cannot be confirmed before it is asked', () => {
    expect(apply(inPhase('CLARIFY'), { kind: 'confirm_understanding' }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'no shared-understanding confirmation was asked; ask_decisions with an empty round asks for it',
      gate: null,
    });
  });

  test('CLARIFY cannot hand off before understanding is confirmed', () => {
    expect(apply(inPhase('CLARIFY'), { kind: 'advance', to: 'DOMAIN' }, fixedClock())).toEqual({ kind: 'rejected', reason: 'cannot advance CLARIFY -> DOMAIN: shared understanding not confirmed', gate: null });
  });
});

describe('skill invocation per phase', () => {
  test('an invoked skill hands the phase over to its work', () => {
    const state = expectOk(apply(inPhase('CLARIFY'), { kind: 'invoke_skill', skill: 'grilling' }, fixedClock()));
    expect(nextAction(state)).toEqual({
      kind: 'work',
      phase: 'CLARIFY',
      task: 'ask the whole unblocked decision frontier with ask_decisions; when no question is left, ask_decisions with an empty round',
    });
  });

  test('invoking the same skill twice in a phase is a no-op', () => {
    const state = expectOk(apply(inPhase('CLARIFY'), { kind: 'invoke_skill', skill: 'grilling' }, fixedClock()));
    expect(apply(state, { kind: 'invoke_skill', skill: 'grilling' }, fixedClock())).toEqual({ kind: 'ok', state, decisions: [] });
  });

  test('leaving a phase forgets the skills it invoked', () => {
    const { state } = applyAll(satisfiedAt('DOMAIN', 'ARCHITECT'), [
      { kind: 'invoke_skill', skill: 'domain-modeling' },
      { kind: 'advance', to: 'ARCHITECT' },
    ]);
    expect([state.run.phase, state.run.invokedSkills]).toEqual(['ARCHITECT', []]);
  });
});

describe('routing after clarification', () => {
  const unchanged: Command = { kind: 'answer_decisions', decisions: [{ id: 'domain.model_change', question: 'model change?', answer: 'no', decidedBy: 'fact' }] };

  test('an unchanged model consumes the glossary without domain-modeling', () => {
    const state = expectOk(apply(inPhase('DOMAIN'), unchanged, fixedClock()));
    expect(nextAction(state)).toEqual({ kind: 'advance', to: 'ARCHITECT' });
  });

  test('an open empirical question routes ARCHITECT to PROTOTYPE', () => {
    const base = satisfiedAt('ARCHITECT', 'CONFIRM_TDD_SEAMS');
    const question: Command = { kind: 'answer_decisions', decisions: [{ id: 'architecture.uncertainty', question: 'what to observe?', answer: 'does streaming keep memory flat?', decidedBy: 'fact' }] };
    const state = expectOk(apply({ ...base, run: { ...base.run, prototypes: [] } }, question, fixedClock()));
    expect([nextAction(state), apply(state, { kind: 'advance', to: 'CONFIRM_TDD_SEAMS' }, fixedClock()).kind]).toEqual([{ kind: 'advance', to: 'PROTOTYPE' }, 'rejected']);
  });

  test.fails('a run without web UI cannot enter DESIGN', () => {
    const base = satisfiedAt('ARCHITECT', 'DESIGN');
    expect(apply(base, { kind: 'advance', to: 'DESIGN' }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'cannot advance ARCHITECT -> DESIGN: DESIGN is only for web UI runs (frontend mode or a browser or Electron consumer)',
      gate: null,
    });
  });

  test('a web UI run routes ARCHITECT to DESIGN', () => {
    const base = satisfiedAt('ARCHITECT', 'DESIGN');
    expect(nextAction({ ...base, run: { ...base.run, mode: 'frontend' } })).toEqual({ kind: 'advance', to: 'DESIGN' });
  });
});

describe('failure routing', () => {
  test('a failed consumer check routes VERIFY back to IMPLEMENT', () => {
    const outcome = apply(inPhase('VERIFY'), { kind: 'route_failure', check: 'consumer', detail: 'exit 1 on empty input' }, fixedClock());
    expect([expectOk(outcome).run.phase, outcome.kind === 'ok' && outcome.decisions.at(-1)?.summary]).toEqual(['IMPLEMENT', 'consumer failed in VERIFY; routed to IMPLEMENT: exit 1 on empty input']);
  });

  test('a failure whose owner is not reachable is rejected', () => {
    expect(apply(inPhase('VERIFY'), { kind: 'route_failure', check: 'architecture', detail: 'cycle' }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'architecture failure belongs to ARCHITECT: illegal transition VERIFY -> ARCHITECT',
      gate: null,
    });
  });
});

describe('integration ownership', () => {
  function passed() {
    const base = inPhase('IMPLEMENT');
    return { ...base, graph: { schemaVersion: 1 as const, nodes: [graphNode('a', 'passed', { definesInterfaces: ['Exporter'] }), graphNode('b', 'passed')] } };
  }

  test('a second integrator is rejected', () => {
    const { state } = applyAll(passed(), [{ kind: 'integrate_node', id: 'a', revision: 'r2', changedPaths: ['src/a/x.ts'], integrator: 'lead' }]);
    expect(apply(state, { kind: 'integrate_node', id: 'b', revision: 'r3', changedPaths: ['src/b/x.ts'], integrator: 'other' }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'lead owns integration; other cannot integrate',
      gate: null,
    });
  });

  test('a node owner cannot merge work into the integrated tree', () => {
    expect(apply(passed(), { kind: 'integrate_node', id: 'a', revision: 'r2', changedPaths: ['src/a/x.ts'], integrator: 'worker' }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'worker owns a graph node; workers do not merge into one another',
      gate: null,
    });
  });

  test('integration stales node dependencies with interface dependencies', () => {
    const base = passed();
    const state = { ...base, evidence: [measured('worker-a', 'r1', { dependencies: ['node:a'] }), measured('consumer-b', 'r1', { dependencies: ['interface:Exporter'] }), measured('other', 'r1', { dependencies: ['node:b'] })] };
    const next = expectOk(apply(state, { kind: 'integrate_node', id: 'a', revision: 'r1', changedPaths: [], integrator: 'lead' }, fixedClock()));
    expect(next.evidence.slice(3).map((record) => [record.claim, record.state, record.observed])).toEqual([
      ['worker-a', 'STALE', 'stale: integrated a'],
      ['consumer-b', 'STALE', 'stale: integrated a'],
    ]);
  });
});

describe('graph declarations', () => {
  test.for(['../escape', 'a b', 'a/b'])('node id %j is refused', (id) => {
    expect(apply(inPhase('BUILD_GRAPH'), { kind: 'build_graph', nodes: [node(id)] }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: `node id ${JSON.stringify(id)} must be letters, digits, dots, dashes, or underscores`,
      gate: null,
    });
  });

  test.for([
    [{ owner: ' ' }, 'node a has no owner'],
    [{ expectedBehavior: '' }, 'node a has no expected behavior'],
  ] as const)('%o is rejected', ([overrides, reason]) => {
    expect(apply(inPhase('BUILD_GRAPH'), { kind: 'build_graph', nodes: [node('a', overrides)] }, fixedClock())).toEqual({ kind: 'rejected', reason, gate: null });
  });
});

describe('boundary redaction', () => {
  test('start input is redacted before it is stored', () => {
    const state = startRun(
      {
        mode: 'feature',
        // biome-ignore lint/security/noSecrets: synthetic token assembled at runtime
        objective: `rotate ${['ghp', 'abcdefghijklmnopqrstuvwxyz0123'].join('_')}`,
        repository: '/repo',
        revision: 'r1',
        consumer: { kind: 'http', userPath: `https://${['admin', 'hunter2'].join(':')}@api.example.test/health` },
        acceptanceCriteria: [`login with ${['password', 'hunter2'].join('=')}`],
        constraints: [],
        nonGoals: [],
        capabilities: { ...NO_CAPS, installedSkills: INSTALLED },
      },
      registry(),
      fixedClock(),
    );
    expect([state.run.objective, state.run.consumer.userPath, state.run.acceptanceCriteria]).toEqual(['rotate <REDACTED>', 'https://<REDACTED>@api.example.test/health', [`login with ${'password'}=<REDACTED>`]]);
  });

  test('graph node text is redacted before it is stored', () => {
    const behavior = `calls with Bearer ${['abcdef', '123456'].join('')}`;
    const state = expectOk(apply(inPhase('BUILD_GRAPH'), { kind: 'build_graph', nodes: [node('a', { expectedBehavior: behavior })] }, fixedClock()));
    expect(state.graph.nodes[0]?.expectedBehavior).toBe('calls with Bearer <REDACTED>');
  });

  test('a preflight remote loses its credentials', () => {
    const base = inPhase('PREFLIGHT');
    const facts = { ...CLEAN_REPO, remote: `https://${['bot', 'token123'].join(':')}@github.com/org/repo.git` };
    expect(expectOk(applyPreflight(base, facts, fixedClock())).run.preflight?.remote).toBe('https://<REDACTED>@github.com/org/repo.git');
  });
});

describe('preflight risks', () => {
  test('an installed skill that differs from the lock is a risk', () => {
    const drifted = { name: 'tdd', contentHash: `sha256:${'0'.repeat(64)}` };
    const base = freshRun({ capabilities: { ...NO_CAPS, installedSkills: [...INSTALLED.filter((skill) => skill.name !== 'tdd'), drifted] } });
    const state = expectOk(applyPreflight({ ...base, run: { ...base.run, phase: 'PREFLIGHT' } }, CLEAN_REPO, fixedClock()));
    expect(state.run.risks).toEqual(['installed tdd (sha256:000000000000) differs from locked mattpocock/skills@dd400c3']);
  });

  test('an unavailable consumer driver is a risk', () => {
    const base = freshRun({ consumer: { kind: 'native', userPath: 'open the app' } });
    const state = expectOk(applyPreflight({ ...base, run: { ...base.run, phase: 'PREFLIGHT' } }, CLEAN_REPO, fixedClock()));
    expect(state.run.risks).toEqual(['consumer verification will be INCONCLUSIVE: native automation unavailable']);
  });
});

describe('run blockers', () => {
  test('run.blockers tracks the PR_READY predicate', () => {
    const state = expectOk(apply(satisfiedAt('REVERIFY_STALE', 'PR_READY'), { kind: 'request_authorization', action: 'merge', scope: 'PR 9' }, fixedClock()));
    expect(state.run.blockers).toEqual(['blocked on authorization gate']);
  });
});
