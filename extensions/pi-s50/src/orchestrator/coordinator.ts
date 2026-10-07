import type { RegistrySnapshot } from '../domain/registry.ts';
import { type InstalledSkill, type Preflight, RUN_SCHEMA_VERSION, type Run, type RunState } from '../domain/run.ts';
import type { Gate, Mode, Phase, RunStatus } from '../domain/state.ts';
import { redact, redactValue, routeConsumer } from '../evidence/verification.ts';
import { currentReview, prReadyBlockers, requiredEvidence } from '../policy/completion.ts';
import { canModelInvoke, installedDrift, routeSkills } from '../policy/invocation.ts';
import { verifySnapshot } from '../registry/validate.ts';
import { reviewAssurance, reviewDimensions } from '../review/reviewer.ts';
import { schedule } from '../scheduler/ownership.ts';
import type { Clock } from './clock.ts';
import { type Command, type DecisionLog, type NextAction, type Outcome, reject, type StartInput, same, understood, withRun } from './command.ts';
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
import { command as commandDecoder, preflight as preflightDecoder } from './schema.ts';

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
    invokedSkills: [],
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

// Identifiers link one command to the next, so redacting them could merge two ids or break a lookup.
// Criteria stay redacted on both sides because startRun redacts the run's acceptance criteria the same way.
// The fetched guideline text is hashed and never stored, so redacting it would only corrupt the digest.
const UNREDACTED_KEYS: ReadonlySet<string> = new Set([
  'guidelinesContent',
  'id',
  'ids',
  'loopId',
  'seamId',
  'seam',
  'dependsOn',
  'dependencies',
  'claim',
  'name',
  'owner',
  'reviewer',
  'integrator',
  'revision',
  'changedPaths',
  'writeSet',
  'schemas',
  'migrations',
  'definesInterfaces',
  'consumesInterfaces',
  'runtimeOwnership',
  'skill',
]);

const NOTHING_KEPT: ReadonlySet<string> = new Set();

// Routed skills are invoked once per phase visit, so leaving a phase forgets which skills it loaded.
// Stored blockers and PR_READY are derived; a migration or a rule change can make them wrong, so every load re-derives them.
export function reconcile(state: RunState, clock: Clock): { readonly state: RunState; readonly decisions: readonly DecisionLog[] } {
  const held = holdReady({ kind: 'ok', state, decisions: [] }, clock);
  return held.kind === 'ok' ? { state: withBlockers(held.state), decisions: held.decisions } : { state, decisions: [] };
}

function settle(before: RunState, after: RunState): RunState {
  const moved = after.run.phase !== before.run.phase && after.run.invokedSkills.length > 0 ? withRun(after, { invokedSkills: [] }) : after;
  return withBlockers(moved);
}

export function apply(state: RunState, command: Command, clock: Clock): Outcome {
  const clean = decode(commandDecoder, redactValue(command, UNREDACTED_KEYS));
  if (clean.kind === 'invalid') return reject(`invalid command: ${clean.reason}`);
  const outcome = holdReady(dispatch(clean.value.kind, state, clean.value, clock), clock);
  return outcome.kind === 'ok' && outcome.decisions.length > 0 ? { ...outcome, state: settle(state, outcome.state) } : outcome;
}

function describePreflight(run: Run, facts: Preflight): string {
  const list = (items: readonly string[]): string => (items.length === 0 ? 'none' : items.join(','));
  const caps = run.capabilities;
  const lockProblems = verifySnapshot(run.skillRegistry);
  return [
    `preflight root=${facts.repositoryRoot} remote=${facts.remote ?? 'none'} rev=${facts.revision} dirty=${facts.dirty}`,
    `languages=${list(facts.languages)} pm=${facts.packageManager} test=${list(facts.testCommands)} build=${list(facts.buildCommands)}`,
    `instructions=${list(facts.instructions)} glossary=${list(facts.glossary)} adrs=${facts.adrs} react=${facts.reactStack}`,
    `installed=${list(run.capabilities.installedSkills.map((skill) => skill.name))} registry=${run.skillRegistry.snapshotTime} lock=${lockProblems.length === 0 ? 'verified' : 'unverified'}`,
    `agents=${caps.independentAgents} worktrees=${caps.isolatedWorktrees} browser=${caps.browserDriver} native=${caps.nativeAutomation} consumer=${routeConsumer(run.consumer.kind, caps).kind}`,
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

// Installing a missing skill happens outside S50, so the host is asked again while that gate is open; the next missing skill, if any, takes its place.
export function hostSkills(state: RunState, installed: readonly InstalledSkill[], clock: Clock): { readonly state: RunState; readonly decisions: readonly DecisionLog[] } {
  const { run } = state;
  if (run.status.kind !== 'blocked' || run.status.gate.kind !== 'missing_skill' || run.preflight === null) return { state, decisions: [] };
  const added = installed.filter((skill) => !run.capabilities.installedSkills.some((known) => known.name === skill.name));
  if (added.length === 0) return { state, decisions: [] };
  const capabilities = { ...run.capabilities, installedSkills: [...run.capabilities.installedSkills, ...added] };
  const next = withRun(state, { capabilities });
  const gate = preflight(next, run.preflight);
  const status: RunStatus = gate === null ? { kind: 'active' } : { kind: 'blocked', gate };
  const summary = `host reports ${added.map((skill) => skill.name).join(',')} installed${gate === null ? '' : `; still blocked on ${gate.kind} ${gate.skill}`}`;
  return { state: withBlockers(withRun(next, { status })), decisions: [{ at: clock.now(), phase: run.phase, command: 'preflight', summary }] };
}

function preflightRisks(run: Run, facts: Preflight): readonly string[] {
  const route = routeConsumer(run.consumer.kind, run.capabilities);
  const found = [
    ...(facts.dirty ? ['working tree dirty at preflight'] : []),
    ...(route.kind === 'inconclusive' ? [`consumer verification will be INCONCLUSIVE: ${route.missing}`] : []),
    ...(facts.testCommands.length === 0 ? ['no test command found'] : []),
    ...installedDrift(run.skillRegistry, run.capabilities.installedSkills),
    ...verifySnapshot(run.skillRegistry).map((problem) => `locked registry does not verify: ${problem}`),
  ];
  return [...run.risks, ...found.filter((risk) => !run.risks.includes(risk))];
}

export function applyPreflight(state: RunState, input: Preflight, clock: Clock): Outcome {
  if (state.run.phase !== 'PREFLIGHT') return reject(`preflight runs in PREFLIGHT, not ${state.run.phase}`);
  const clean = decode(preflightDecoder, redactValue(input, NOTHING_KEPT));
  if (clean.kind === 'invalid') return reject(`invalid preflight facts: ${clean.reason}`);
  const facts = clean.value;
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
  if (run.phase === 'CONFIRM_TDD_SEAMS' && run.testContract.confirmedSeams.length === 0) return 'propose_seams at public interfaces, each with what it catches and misses; the user confirms them';
  if (run.phase === 'BUILD_GRAPH' && state.graph.nodes.length === 0) return 'build_graph with vertical-slice nodes, each with an owner, a write set, and expected behavior';
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
  const skill = routeSkills(run.phase, routeFacts(run)).find((candidate) => !run.invokedSkills.includes(candidate) && canModelInvoke(run.skillRegistry, candidate, run.capabilities.installedSkills).kind === 'allowed');
  if (skill !== undefined) return { kind: 'invoke_skill', skill };
  return { kind: 'work', phase: run.phase, task: phaseWork(state, target) };
}
