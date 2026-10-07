import type { RegistrySnapshot } from '../domain/registry.ts';
import { RUN_SCHEMA_VERSION, type Run, type RunState } from '../domain/run.ts';
import type { Gate, Mode, Phase, RunStatus } from '../domain/state.ts';
import { redact, routeConsumer } from '../evidence/verification.ts';
import { currentReview, prReadyBlockers, requiredEvidence } from '../policy/completion.ts';
import { canModelInvoke, routeSkills } from '../policy/invocation.ts';
import { reviewAssurance, reviewDimensions } from '../review/reviewer.ts';
import { schedule } from '../scheduler/ownership.ts';
import type { Clock } from './clock.ts';
import { type Command, type NextAction, type Outcome, reject, type StartInput, same, withRun } from './command.ts';
import {
  answerDecisions,
  buildGraph,
  chooseDesign,
  completeNode,
  completeUserWorkflow,
  confirmSeams,
  confirmUnderstanding,
  declareInconclusive,
  freezeRevision,
  grantAuthorization,
  integrateNode,
  invokeSkill,
  promoteDiagnostic,
  proposeDesigns,
  proposeSeams,
  recordDiagnostic,
  recordDomain,
  recordEvidence,
  recordFinding,
  recordPrototype,
  recordReview,
  recordRootCause,
  recordTest,
  requestAuthorization,
  resolve,
  reviewSurface,
  revisionChanged,
  routeFacts,
  startNodes,
} from './handlers.ts';
import { advance, guard } from './phases.ts';
import { classify } from './routes.ts';

const MODE_SKILLS: { readonly [M in Mode]: readonly string[] } = {
  feature: ['grilling', 'codebase-design', 'tdd'],
  frontend: ['grilling', 'codebase-design', 'frontend-design', 'tdd'],
  bug: ['diagnosing-bugs', 'codebase-design', 'tdd'],
  external_issue: ['grilling', 'codebase-design', 'tdd'],
  architecture_survey: ['grilling', 'codebase-design', 'tdd'],
};

const NATURAL_NEXT: { readonly [P in Phase]: Phase | null } = {
  START: 'PREFLIGHT',
  PREFLIGHT: 'CLASSIFY',
  CLASSIFY: null,
  CLARIFY: 'DOMAIN',
  DIAGNOSE: 'DOMAIN',
  EXPLICIT_TRIAGE: 'CLARIFY',
  EXPLICIT_ARCH_REVIEW: 'CLARIFY',
  DOMAIN: 'ARCHITECT',
  ARCHITECT: null,
  PROTOTYPE: 'CONFIRM_TDD_SEAMS',
  DESIGN: 'CONFIRM_TDD_SEAMS',
  CONFIRM_TDD_SEAMS: 'BUILD_GRAPH',
  BUILD_GRAPH: 'IMPLEMENT',
  IMPLEMENT: 'INTEGRATE',
  INTEGRATE: 'REVIEW',
  REVIEW: 'VERIFY',
  VERIFY: 'FREEZE_REVISION',
  FREEZE_REVISION: 'REVERIFY_STALE',
  REVERIFY_STALE: 'PR_READY',
  PR_READY: null,
};

export function startRun(input: StartInput, registry: RegistrySnapshot, clock: Clock): RunState {
  const run: Run = {
    id: clock.id('run'),
    schemaVersion: RUN_SCHEMA_VERSION,
    mode: input.mode,
    objective: input.objective,
    phase: 'START',
    status: { kind: 'active' },
    repository: input.repository,
    baselineRevision: input.revision,
    currentRevision: input.revision,
    frozenRevision: null,
    consumer: input.consumer,
    acceptanceCriteria: input.acceptanceCriteria,
    constraints: input.constraints,
    nonGoals: input.nonGoals,
    domain: { terms: [], invariants: [], scenarios: [], decisions: [] },
    architecture: { candidates: [], chosen: null, interfaces: [], seams: [], ownership: [] },
    testContract: { proposedSeams: [], confirmedSeams: [] },
    diagnostics: [],
    rootCause: null,
    prototypes: [],
    capabilities: input.capabilities,
    skillRegistry: registry,
    blockers: [],
    risks: [],
  };
  return { run, graph: { schemaVersion: 1, nodes: [] }, evidence: [], findings: [] };
}

type CommandOf = { readonly [K in Command['kind']]: Extract<Command, { readonly kind: K }> };

type Handlers = { readonly [K in keyof CommandOf]: (state: RunState, command: CommandOf[K], clock: Clock) => Outcome };

const HANDLERS: Handlers = {
  advance: (state, command, clock) => advance(state, command.to, clock),
  invoke_skill: (state, command, clock) => invokeSkill(state, command.skill, clock),
  complete_user_workflow: (state, command, clock) => completeUserWorkflow(state, command.skill, clock),
  answer_decisions: (state, command, clock) => answerDecisions(state, command.decisions, clock),
  confirm_understanding: (state, _command, clock) => confirmUnderstanding(state, clock),
  record_domain: (state, command, clock) => recordDomain(state, command, clock),
  propose_designs: (state, command, clock) => proposeDesigns(state, command.candidates, clock),
  choose_design: (state, command, clock) => chooseDesign(state, { ...command, reason: redact(command.reason) }, clock),
  record_prototype: (state, command, clock) => recordPrototype(state, command, clock),
  propose_seams: (state, command, clock) => proposeSeams(state, command.seams, clock),
  confirm_seams: (state, command, clock) => confirmSeams(state, command.ids, clock),
  record_test: (state, command, clock) => recordTest(state, command.seam, clock),
  record_diagnostic: (state, command, clock) => recordDiagnostic(state, command.loop, clock),
  record_root_cause: (state, command, clock) => recordRootCause(state, command.cause, clock),
  promote_diagnostic: (state, command, clock) => promoteDiagnostic(state, command.loopId, command.seamId, clock),
  build_graph: (state, command, clock) => buildGraph(state, command.nodes, clock),
  start_nodes: (state, command, clock) => startNodes(state, command.ids, clock),
  complete_node: (state, command, clock) => completeNode(state, command.id, command.passed, clock),
  integrate_node: (state, command, clock) => integrateNode(state, command, clock),
  record_evidence: (state, command, clock) => recordEvidence(state, command.evidence, clock),
  revision_changed: (state, command, clock) => revisionChanged(state, command.revision, command.changedPaths, clock),
  record_finding: (state, command, clock) => recordFinding(state, command.finding, clock),
  resolve_finding: (state, command, clock) => resolve(state, command.id, command.resolution, clock),
  request_authorization: (state, command, clock) => requestAuthorization(state, command.action, redact(command.scope), clock),
  grant_authorization: (state, command, clock) => grantAuthorization(state, command.action, redact(command.scope), clock),
  freeze_revision: (state, _command, clock) => freezeRevision(state, clock),
  declare_inconclusive: (state, command, clock) => declareInconclusive(state, command.missing, clock),
  record_review: (state, command, clock) => recordReview(state, command, clock),
};

function dispatch<K extends keyof CommandOf>(kind: K, state: RunState, command: CommandOf[K], clock: Clock): Outcome {
  return HANDLERS[kind](state, command, clock);
}

// PR_READY is a live predicate: a new finding, a failed measurement, or any other change that reopens a blocker sends the run back to REVERIFY_STALE.
// A pending human gate (such as merge authorization) pauses the predicate instead of erasing the gate.
function holdReady(outcome: Outcome, clock: Clock): Outcome {
  if (outcome.kind === 'rejected' || outcome.state.run.phase !== 'PR_READY' || outcome.state.run.status.kind === 'blocked') return outcome;
  const blockers = prReadyBlockers(outcome.state);
  if (blockers.length === 0) {
    const ready = { kind: 'pr_ready', revision: outcome.state.run.currentRevision } as const;
    return same(outcome.state.run.status, ready) ? outcome : { ...outcome, state: withRun(outcome.state, { status: ready }) };
  }
  const state = withRun(outcome.state, { phase: 'REVERIFY_STALE', status: { kind: 'active' } });
  return { ...outcome, state, decisions: [...outcome.decisions, { at: clock.now(), phase: 'REVERIFY_STALE', command: 'advance', summary: `left PR_READY: ${redact(blockers.join('; '))}` }] };
}

export function apply(state: RunState, command: Command, clock: Clock): Outcome {
  return holdReady(dispatch(command.kind, state, command, clock), clock);
}

export type RepoFacts = {
  readonly issueTrackerDoc: boolean;
  readonly dirty: boolean;
  readonly packageManager: string;
  readonly instructions: readonly string[];
  readonly glossary: readonly string[];
  readonly adrs: number;
};

function describeFacts(run: Run, facts: RepoFacts): string {
  const list = (items: readonly string[]): string => (items.length === 0 ? 'none' : items.join(','));
  return `preflight rev=${run.currentRevision} dirty=${facts.dirty} pm=${facts.packageManager} instructions=${list(facts.instructions)} glossary=${list(facts.glossary)} adrs=${facts.adrs} installed=${list(run.capabilities.installedSkills)} registry=${run.skillRegistry.snapshotTime}`;
}

export function preflight(state: RunState, facts: RepoFacts): Extract<Gate, { kind: 'user_workflow' | 'missing_skill' }> | null {
  const { run } = state;
  if (run.mode === 'external_issue' && !facts.issueTrackerDoc) return { kind: 'user_workflow', skill: 'setup-matt-pocock-skills', action: '/skill:setup-matt-pocock-skills' };
  const browser = (run.consumer.kind === 'browser' || run.consumer.kind === 'electron') && run.capabilities.browserDriver ? ['agent-browser'] : [];
  for (const skill of [...MODE_SKILLS[run.mode], ...browser]) {
    const check = canModelInvoke(run.skillRegistry, skill, run.capabilities.installedSkills);
    if (check.kind === 'not_installed') return { kind: 'missing_skill', skill, install: check.install };
  }
  return null;
}

export function applyPreflight(state: RunState, facts: RepoFacts, clock: Clock): Outcome {
  if (state.run.phase !== 'PREFLIGHT') return reject(`preflight runs in PREFLIGHT, not ${state.run.phase}`);
  const gate = preflight(state, facts);
  const risk = 'working tree dirty at preflight';
  const risks = facts.dirty && !state.run.risks.includes(risk) ? [...state.run.risks, risk] : state.run.risks;
  const status: RunStatus = gate === null ? state.run.status : { kind: 'blocked', gate };
  const summary = gate === null ? describeFacts(state.run, facts) : `${describeFacts(state.run, facts)}; blocked on ${gate.kind} gate`;
  return { kind: 'ok', state: withRun(state, { status, risks }), decisions: [{ at: clock.now(), phase: 'PREFLIGHT', command: 'preflight', summary }] };
}

export function nextAction(state: RunState): NextAction {
  const { run } = state;
  switch (run.status.kind) {
    case 'blocked':
      return { kind: 'human_gate', gate: run.status.gate };
    case 'pr_ready':
      return { kind: 'done', revision: run.status.revision };
    case 'inconclusive':
      return { kind: 'work', phase: run.phase, task: `inconclusive: ${run.status.missing}` };
    case 'active':
      break;
    default: {
      const _exhaustive: never = run.status;
      return _exhaustive;
    }
  }
  const target = run.phase === 'CLASSIFY' ? classify(run.mode) : run.phase === 'ARCHITECT' ? (run.mode === 'frontend' ? 'DESIGN' : 'CONFIRM_TDD_SEAMS') : NATURAL_NEXT[run.phase];
  if (target !== null && guard(state, target) === null) return { kind: 'advance', to: target };
  if (run.phase === 'IMPLEMENT') {
    const batch = schedule(state.graph, run.capabilities);
    if (batch.nodes.length > 0) return { kind: 'start_nodes', ids: batch.nodes.map((node) => node.id) };
  }
  if (run.phase === 'VERIFY' || run.phase === 'REVERIFY_STALE') {
    const missing = requiredEvidence(state)
      .filter((required) => !required.satisfied)
      .map((required) => required.criterion);
    if (missing.length > 0) return { kind: 'verify', route: routeConsumer(run.consumer.kind, run.capabilities), criteria: missing };
  }
  if ((run.phase === 'REVIEW' || run.phase === 'REVERIFY_STALE') && currentReview(state) === null) {
    const surface = reviewSurface(run);
    return { kind: 'review', dimensions: reviewDimensions(surface), assurance: reviewAssurance(run.capabilities), guidelinesRequired: surface.kind === 'web_ui' };
  }
  if ((run.phase === 'FREEZE_REVISION' || run.phase === 'REVERIFY_STALE') && run.frozenRevision !== run.currentRevision) return { kind: 'freeze_revision' };
  const skill = routeSkills(run.phase, routeFacts(run)).find((candidate) => canModelInvoke(run.skillRegistry, candidate, run.capabilities.installedSkills).kind === 'allowed');
  if (skill !== undefined) return { kind: 'invoke_skill', skill };
  return { kind: 'work', phase: run.phase, task: target === null ? `choose next phase from ${run.phase}` : (guard(state, target) ?? `advance to ${target}`) };
}
