import type { RegistrySnapshot } from '../domain/registry.ts';
import { type Preflight, RUN_SCHEMA_VERSION, type Run, type RunState } from '../domain/run.ts';
import type { Gate, Mode, Phase, RunStatus } from '../domain/state.ts';
import { redact, redactValue, routeConsumer } from '../evidence/verification.ts';
import { currentReview, prReadyBlockers, requiredEvidence } from '../policy/completion.ts';
import { canModelInvoke, installedDrift, routeSkills } from '../policy/invocation.ts';
import { reviewAssurance, reviewDimensions } from '../review/reviewer.ts';
import { schedule } from '../scheduler/ownership.ts';
import type { Clock } from './clock.ts';
import { type Command, type NextAction, type Outcome, reject, type StartInput, same, understood, withRun } from './command.ts';
import { decode } from './decode.ts';
import { MODEL_CHANGE_ID, modelChange, pendingUncertainty, reviewSurface, routeFacts, UNCERTAINTY_ID } from './facts.ts';
import {
  answerDecisions,
  askDecisions,
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
  revisionChanged,
  routeFailure,
  startNodes,
} from './handlers.ts';
import { advance, guard } from './phases.ts';
import { classify } from './routes.ts';
import { command as commandDecoder } from './schema.ts';

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
  PROTOTYPE: null,
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

function withBlockers(state: RunState): RunState {
  const blockers = prReadyBlockers(state);
  return same(blockers, state.run.blockers) ? state : withRun(state, { blockers });
}

export function startRun(input: StartInput, registry: RegistrySnapshot, clock: Clock): RunState {
  const run: Run = {
    id: clock.id('run'),
    schemaVersion: RUN_SCHEMA_VERSION,
    mode: input.mode,
    objective: redact(input.objective),
    phase: 'START',
    status: { kind: 'active' },
    repository: redact(input.repository),
    baselineRevision: input.revision,
    currentRevision: input.revision,
    frozenRevision: null,
    consumer: { kind: input.consumer.kind, userPath: redact(input.consumer.userPath) },
    acceptanceCriteria: input.acceptanceCriteria.map(redact),
    constraints: input.constraints.map(redact),
    nonGoals: input.nonGoals.map(redact),
    domain: { terms: [], invariants: [], scenarios: [], decisions: [] },
    architecture: { candidates: [], chosen: null, interfaces: [], seams: [], ownership: [] },
    testContract: { proposedSeams: [], confirmedSeams: [] },
    diagnostics: [],
    rootCause: null,
    prototypes: [],
    integrationOwner: null,
    preflight: null,
    capabilities: input.capabilities,
    skillRegistry: registry,
    blockers: [],
    risks: [],
  };
  return withBlockers({ run, graph: { schemaVersion: 1, nodes: [] }, evidence: [], findings: [] });
}

type CommandOf = { readonly [K in Command['kind']]: Extract<Command, { readonly kind: K }> };

type Handlers = { readonly [K in keyof CommandOf]: (state: RunState, command: CommandOf[K], clock: Clock) => Outcome };

const HANDLERS: Handlers = {
  advance: (state, command, clock) => advance(state, command.to, clock),
  invoke_skill: (state, command, clock) => invokeSkill(state, command.skill, clock),
  complete_user_workflow: (state, command, clock) => completeUserWorkflow(state, command.skill, clock),
  ask_decisions: (state, command, clock) => askDecisions(state, command.questions, clock),
  answer_decisions: (state, command, clock) => answerDecisions(state, command.decisions, clock),
  confirm_understanding: (state, _command, clock) => confirmUnderstanding(state, clock),
  record_domain: (state, command, clock) => recordDomain(state, command, clock),
  propose_designs: (state, command, clock) => proposeDesigns(state, command.candidates, clock),
  choose_design: (state, command, clock) => chooseDesign(state, command, clock),
  record_prototype: (state, command, clock) => recordPrototype(state, command, clock),
  propose_seams: (state, command, clock) => proposeSeams(state, command.seams, clock),
  confirm_seams: (state, command, clock) => confirmSeams(state, command.ids, clock),
  record_test: (state, command, clock) => recordTest(state, command, clock),
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
  request_authorization: (state, command, clock) => requestAuthorization(state, command.action, command.scope, clock),
  grant_authorization: (state, command, clock) => grantAuthorization(state, command.action, command.scope, clock),
  freeze_revision: (state, _command, clock) => freezeRevision(state, clock),
  declare_inconclusive: (state, command, clock) => declareInconclusive(state, command.missing, clock),
  record_review: (state, command, clock) => recordReview(state, command, clock),
  route_failure: (state, command, clock) => routeFailure(state, command.check, command.detail, clock),
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
  return { ...outcome, state, decisions: [...outcome.decisions, { at: clock.now(), phase: 'REVERIFY_STALE', command: 'advance', summary: `left PR_READY: ${blockers.join('; ')}` }] };
}

// The fetched guideline text is hashed, never stored, so redacting it would only corrupt the digest.
const UNREDACTED_KEYS: ReadonlySet<string> = new Set(['guidelinesContent']);

export function apply(state: RunState, command: Command, clock: Clock): Outcome {
  const clean = decode(commandDecoder, redactValue(command, UNREDACTED_KEYS));
  if (clean.kind === 'invalid') return reject(`invalid command: ${clean.reason}`);
  const outcome = holdReady(dispatch(clean.value.kind, state, clean.value, clock), clock);
  return outcome.kind === 'ok' && outcome.decisions.length > 0 ? { ...outcome, state: withBlockers(outcome.state) } : outcome;
}

function describePreflight(run: Run, facts: Preflight): string {
  const list = (items: readonly string[]): string => (items.length === 0 ? 'none' : items.join(','));
  return [
    `preflight root=${facts.repositoryRoot} remote=${facts.remote ?? 'none'} rev=${facts.revision} dirty=${facts.dirty}`,
    `languages=${list(facts.languages)} pm=${facts.packageManager} test=${list(facts.testCommands)} build=${list(facts.buildCommands)}`,
    `instructions=${list(facts.instructions)} glossary=${list(facts.glossary)} adrs=${facts.adrs} react=${facts.reactStack}`,
    `installed=${list(run.capabilities.installedSkills.map((skill) => skill.name))} registry=${run.skillRegistry.snapshotTime} consumer=${routeConsumer(run.consumer.kind, run.capabilities).kind}`,
  ].join(' ');
}

export function preflight(state: RunState, facts: Preflight): Extract<Gate, { kind: 'user_workflow' | 'missing_skill' }> | null {
  const { run } = state;
  if (run.mode === 'external_issue' && !facts.issueTrackerDoc) return { kind: 'user_workflow', skill: 'setup-matt-pocock-skills', action: '/skill:setup-matt-pocock-skills' };
  const browser = (run.consumer.kind === 'browser' || run.consumer.kind === 'electron') && run.capabilities.browserDriver ? ['agent-browser'] : [];
  for (const skill of [...MODE_SKILLS[run.mode], ...browser]) {
    const check = canModelInvoke(run.skillRegistry, skill, run.capabilities.installedSkills);
    if (check.kind === 'not_installed') return { kind: 'missing_skill', skill, install: check.install };
  }
  return null;
}

function preflightRisks(run: Run, facts: Preflight): readonly string[] {
  const route = routeConsumer(run.consumer.kind, run.capabilities);
  const found = [
    ...(facts.dirty ? ['working tree dirty at preflight'] : []),
    ...(route.kind === 'inconclusive' ? [`consumer verification will be INCONCLUSIVE: ${route.missing}`] : []),
    ...(facts.testCommands.length === 0 ? ['no test command found'] : []),
    ...installedDrift(run.skillRegistry, run.capabilities.installedSkills),
  ];
  return [...run.risks, ...found.filter((risk) => !run.risks.includes(risk))];
}

export function applyPreflight(state: RunState, input: Preflight, clock: Clock): Outcome {
  if (state.run.phase !== 'PREFLIGHT') return reject(`preflight runs in PREFLIGHT, not ${state.run.phase}`);
  const facts: Preflight = { ...input, repositoryRoot: redact(input.repositoryRoot), remote: input.remote === null ? null : redact(input.remote) };
  const gate = preflight(state, facts);
  const status: RunStatus = gate === null ? state.run.status : { kind: 'blocked', gate };
  const summary = gate === null ? describePreflight(state.run, facts) : `${describePreflight(state.run, facts)}; blocked on ${gate.kind} gate`;
  const next = withBlockers(withRun(state, { status, risks: preflightRisks(state.run, facts), preflight: facts }));
  return { kind: 'ok', state: next, decisions: [{ at: clock.now(), phase: 'PREFLIGHT', command: 'preflight', summary }] };
}

function architectTarget(run: Run): Phase {
  if (pendingUncertainty(run) !== null) return 'PROTOTYPE';
  return routeFacts(run).webUi ? 'DESIGN' : 'CONFIRM_TDD_SEAMS';
}

function nextPhase(run: Run): Phase | null {
  switch (run.phase) {
    case 'CLASSIFY':
      return classify(run.mode);
    case 'ARCHITECT':
      return architectTarget(run);
    case 'PROTOTYPE':
      return 'ARCHITECT';
    default:
      return NATURAL_NEXT[run.phase];
  }
}

function phaseWork(state: RunState, target: Phase | null): string {
  const { run } = state;
  if (run.phase === 'CLARIFY' && !understood(run)) {
    return 'ask the whole unblocked decision frontier with ask_decisions; when no question is left, ask_decisions with an empty round';
  }
  if (run.phase === 'DOMAIN' && modelChange(run) === null) {
    return `answer_decisions ${MODEL_CHANGE_ID} yes or no; read ${run.preflight?.glossary.join(', ') || 'no glossary'} first`;
  }
  if (run.phase === 'ARCHITECT' && run.architecture.chosen === null) {
    return `propose at least two structurally different designs, choose one with a reason; record ${UNCERTAINTY_ID} when a question needs observation`;
  }
  if (run.phase === 'PROTOTYPE') return `record_prototype answering: ${pendingUncertainty(run) ?? 'the open question'}`;
  return target === null ? `choose next phase from ${run.phase}` : (guard(state, target) ?? `advance to ${target}`);
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
  const target = nextPhase(run);
  if (target !== null && guard(state, target) === null) return { kind: 'advance', to: target };
  if (run.phase === 'IMPLEMENT') {
    const batch = schedule(state.graph, run.capabilities);
    if (batch.nodes.length > 0) return { kind: 'start_nodes', ids: batch.nodes.map((node) => node.id), workspaces: batch.nodes.map((node) => node.workspace) };
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
  return { kind: 'work', phase: run.phase, task: phaseWork(state, target) };
}
