import type { RunState } from '../domain/run.ts';
import type { Phase, RunStatus } from '../domain/state.ts';
import { currentReview, prReadyBlockers, requiredEvidence } from '../policy/completion.ts';
import type { Clock } from './clock.ts';
import { blockedGate, done, noop, type Outcome, reject, understood, withRun } from './command.ts';
import { MODEL_CHANGE_ID, modelChange, pendingUncertainty } from './facts.ts';
import { classify } from './routes.ts';
import { isLegalTransition } from './transitions.ts';

export const DESIGN_BRIEF = [
  'subject',
  'audience',
  'primary_job',
  'visual_direction',
  'information_hierarchy',
  'layout',
  'typography',
  'interaction_model',
  'responsive_behavior',
  'loading_state',
  'empty_state',
  'error_state',
  'accessibility',
] as const;

const ids = (items: readonly { readonly id: string }[]): string => items.map((item) => item.id).join(', ');

function unlessEmpty(prefix: string, items: readonly { readonly id: string }[]): string | null {
  return items.length > 0 ? `${prefix}: ${ids(items)}` : null;
}

function designReady(state: RunState, from: Phase): string | null {
  const { run } = state;
  if (from === 'ARCHITECT' && run.architecture.chosen === null) return 'no design chosen';
  const uncertainty = pendingUncertainty(run);
  if (from === 'ARCHITECT' && uncertainty !== null) return `empirical question needs a prototype first: ${uncertainty}`;
  if (from === 'PROTOTYPE' && run.prototypes.length === 0) return 'no prototype recorded';
  if (from !== 'DESIGN') return null;
  const settled = new Set(run.domain.decisions.map((decision) => decision.id));
  const missing = DESIGN_BRIEF.filter((item) => !settled.has(`design.${item}`));
  return missing.length > 0 ? `design brief incomplete: ${missing.join(', ')}` : null;
}

type Guard = (state: RunState, from: Phase) => string | null;

const open: Guard = () => null;

const GUARDS: { readonly [P in Phase]: Guard } = {
  START: open,
  PREFLIGHT: open,
  CLASSIFY: open,
  CLARIFY: open,
  DIAGNOSE: open,
  EXPLICIT_TRIAGE: open,
  EXPLICIT_ARCH_REVIEW: open,
  ARCHITECT: ({ run }, from) => {
    if (from !== 'DOMAIN') return null;
    const change = modelChange(run);
    if (change === null) return `decide ${MODEL_CHANGE_ID} (yes or no) before leaving DOMAIN`;
    return change && run.domain.terms.length === 0 ? 'the domain model changes but no terms were recorded' : null;
  },
  DOMAIN: ({ run }, from) => {
    if (from === 'CLARIFY' && !understood(run)) return 'shared understanding not confirmed';
    return from === 'DIAGNOSE' && run.rootCause === null ? 'root cause not recorded' : null;
  },
  PROTOTYPE: ({ run }, from) => (from === 'ARCHITECT' && run.architecture.candidates.length < 2 ? 'at least two design candidates required' : null),
  DESIGN: designReady,
  CONFIRM_TDD_SEAMS: designReady,
  BUILD_GRAPH: ({ run }) => (run.testContract.confirmedSeams.length === 0 ? 'no confirmed test seams' : null),
  IMPLEMENT: ({ graph }, from) => (from === 'BUILD_GRAPH' && graph.nodes.length === 0 ? 'graph has no nodes' : null),
  INTEGRATE: ({ graph }) =>
    unlessEmpty(
      'nodes not passed',
      graph.nodes.filter((node) => node.status !== 'passed' && node.status !== 'integrated'),
    ),
  REVIEW: ({ graph }) =>
    unlessEmpty(
      'nodes not integrated',
      graph.nodes.filter((node) => node.status !== 'integrated'),
    ),
  VERIFY: (state, from) => {
    if (from === 'REVIEW' && currentReview(state) === null) return 'no review recorded at the current revision';
    return unlessEmpty(
      'open findings',
      state.findings.filter((finding) => finding.status === 'open'),
    );
  },
  FREEZE_REVISION: (state) => {
    const missing = requiredEvidence(state).filter((required) => !required.satisfied);
    return missing.length > 0 ? `criteria lack MEASURED evidence: ${missing.map((required) => required.criterion).join('; ')}` : null;
  },
  REVERIFY_STALE: ({ run }, from) => (from === 'FREEZE_REVISION' && run.frozenRevision !== run.currentRevision ? 'revision not frozen at current revision' : null),
  PR_READY: (state) => {
    const blockers = prReadyBlockers(state);
    return blockers.length > 0 ? blockers.join('; ') : null;
  },
};

export function guard(state: RunState, to: Phase): string | null {
  const { run } = state;
  if (run.phase !== 'CLASSIFY') return GUARDS[to](state, run.phase);
  const expected = classify(run.mode);
  return to === expected ? null : `mode ${run.mode} routes to ${expected}`;
}

function statusOnEntry(state: RunState, to: Phase): RunStatus {
  switch (to) {
    case 'PR_READY':
      return { kind: 'pr_ready', revision: state.run.currentRevision };
    case 'EXPLICIT_TRIAGE':
      return { kind: 'blocked', gate: { kind: 'user_workflow', skill: 'triage', action: '/skill:triage' } };
    case 'EXPLICIT_ARCH_REVIEW':
      return { kind: 'blocked', gate: { kind: 'user_workflow', skill: 'improve-codebase-architecture', action: '/skill:improve-codebase-architecture' } };
    default:
      return { kind: 'active' };
  }
}

export function advance(state: RunState, to: Phase, clock: Clock): Outcome {
  const from = state.run.phase;
  if (from === to) return noop(state);
  if (!isLegalTransition(from, to)) return reject(`illegal transition ${from} -> ${to}`);
  const gate = blockedGate(state.run);
  if (gate !== null) return reject(`run blocked on ${gate.kind} gate`, gate);
  if (state.run.status.kind === 'inconclusive') return reject(`run is INCONCLUSIVE: missing ${state.run.status.missing}`);
  const reason = guard(state, to);
  if (reason !== null) return reject(`cannot advance ${from} -> ${to}: ${reason}`);
  return done(withRun(state, { phase: to, status: statusOnEntry(state, to) }), 'advance', `advance ${from} -> ${to}`, clock);
}
