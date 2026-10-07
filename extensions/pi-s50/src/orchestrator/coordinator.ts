import type { EvidenceRecord } from '../domain/evidence.ts';
import type { Finding } from '../domain/findings.ts';
import type { GraphNode } from '../domain/graph.ts';
import type { RegistrySnapshot } from '../domain/registry.ts';
import { type Consumer, type Decision, type DesignCandidate, type DiagnosticLoop, type HostCapabilities, RUN_SCHEMA_VERSION, type Run, type RunState, type Seam } from '../domain/run.ts';
import type { AuthorizationAction, Gate, Mode, Phase, RunStatus } from '../domain/state.ts';
import { invalidate, latestByClaim } from '../evidence/invalidation.ts';
import { type ConsumerRoute, redact, routeConsumer } from '../evidence/verification.ts';
import { grantMatches } from '../policy/authorization.ts';
import { prReadyBlockers, requiredEvidence } from '../policy/completion.ts';
import { canModelInvoke, routeSkills } from '../policy/invocation.ts';
import { captureGuidelines, createFinding, type FindingInput, resolveFinding, sameFinding } from '../review/findings.ts';
import { type ReviewAssurance, type ReviewSurface, reviewAssurance, reviewDimensions } from '../review/reviewer.ts';
import { conflict } from '../scheduler/conflicts.ts';
import { blockedBy, readyFrontier } from '../scheduler/frontier.ts';
import { canRunConcurrently, schedule } from '../scheduler/ownership.ts';
import type { Clock } from './clock.ts';
import { classify } from './routes.ts';
import { isLegalTransition } from './transitions.ts';

export type EvidenceInput = Omit<EvidenceRecord, 'id' | 'recordedAt' | 'supersedes' | 'revision'>;

export type GraphNodeInput = Omit<GraphNode, 'status'>;

export type Command =
  | { readonly kind: 'advance'; readonly to: Phase }
  | { readonly kind: 'invoke_skill'; readonly skill: string }
  | { readonly kind: 'complete_user_workflow'; readonly skill: string }
  | { readonly kind: 'answer_decisions'; readonly decisions: readonly Decision[] }
  | { readonly kind: 'confirm_understanding' }
  | { readonly kind: 'record_domain'; readonly terms: readonly string[]; readonly invariants: readonly string[]; readonly scenarios: readonly string[] }
  | { readonly kind: 'propose_designs'; readonly candidates: readonly DesignCandidate[] }
  | {
      readonly kind: 'choose_design';
      readonly id: string;
      readonly reason: string;
      readonly interfaces: readonly string[];
      readonly seams: readonly string[];
      readonly ownership: readonly string[];
    }
  | { readonly kind: 'record_prototype'; readonly question: string; readonly verdict: string; readonly branch: string; readonly issuePointer: string | null }
  | { readonly kind: 'propose_seams'; readonly seams: readonly Seam[] }
  | { readonly kind: 'confirm_seams'; readonly ids: readonly string[] }
  | { readonly kind: 'record_test'; readonly seam: string; readonly test: 'tdd' }
  | { readonly kind: 'record_diagnostic'; readonly loop: DiagnosticLoop }
  | { readonly kind: 'record_root_cause'; readonly cause: string }
  | { readonly kind: 'promote_diagnostic'; readonly loopId: string; readonly seamId: string }
  | { readonly kind: 'build_graph'; readonly nodes: readonly GraphNodeInput[] }
  | { readonly kind: 'start_nodes'; readonly ids: readonly string[] }
  | { readonly kind: 'complete_node'; readonly id: string; readonly passed: boolean }
  | { readonly kind: 'integrate_node'; readonly id: string; readonly revision: string; readonly changedPaths: readonly string[] }
  | { readonly kind: 'record_evidence'; readonly evidence: EvidenceInput }
  | { readonly kind: 'revision_changed'; readonly revision: string; readonly changedPaths: readonly string[] }
  | { readonly kind: 'record_finding'; readonly finding: FindingInput }
  | { readonly kind: 'resolve_finding'; readonly id: string; readonly resolution: 'resolved' | 'dismissed' }
  | { readonly kind: 'request_authorization'; readonly action: AuthorizationAction; readonly scope: string }
  | { readonly kind: 'grant_authorization'; readonly action: AuthorizationAction; readonly scope: string }
  | { readonly kind: 'freeze_revision' }
  | { readonly kind: 'declare_inconclusive'; readonly missing: string }
  | { readonly kind: 'record_review'; readonly reviewer: string; readonly dimensions: readonly string[]; readonly guidelinesContent: string | null };

export type CommandKind = Command['kind'];

export type DecisionLog = { readonly at: string; readonly phase: Phase; readonly command: CommandKind | 'preflight'; readonly summary: string };

export type Outcome = { readonly kind: 'ok'; readonly state: RunState; readonly decisions: readonly DecisionLog[] } | { readonly kind: 'rejected'; readonly reason: string; readonly gate: Gate | null };

export type NextAction =
  | { readonly kind: 'human_gate'; readonly gate: Gate }
  | { readonly kind: 'advance'; readonly to: Phase }
  | { readonly kind: 'invoke_skill'; readonly skill: string }
  | { readonly kind: 'start_nodes'; readonly ids: readonly string[] }
  | { readonly kind: 'verify'; readonly route: ConsumerRoute; readonly criteria: readonly string[] }
  | { readonly kind: 'freeze_revision' }
  | { readonly kind: 'review'; readonly dimensions: readonly string[]; readonly assurance: ReviewAssurance; readonly guidelinesRequired: boolean }
  | { readonly kind: 'work'; readonly phase: Phase; readonly task: string }
  | { readonly kind: 'done'; readonly revision: string };

export type StartInput = {
  readonly mode: Mode;
  readonly objective: string;
  readonly repository: string;
  readonly revision: string;
  readonly consumer: Consumer;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly nonGoals: readonly string[];
  readonly capabilities: HostCapabilities;
};

export const SHARED_UNDERSTANDING_ID = 'shared-understanding';

export const INTEGRATION_OWNER = 'integrator';

const HORIZONTAL_LAYERS = ['database', 'backend', 'frontend', 'tests', 'api', 'ui', 'schema', 'migration'];

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

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function noop(state: RunState): Outcome {
  return { kind: 'ok', state, decisions: [] };
}

function reject(reason: string, gate: Gate | null = null): Outcome {
  return { kind: 'rejected', reason, gate };
}

function done(next: RunState, command: CommandKind, summary: string, clock: Clock): Outcome {
  return { kind: 'ok', state: next, decisions: [{ at: clock.now(), phase: next.run.phase, command, summary }] };
}

function withRun(state: RunState, patch: Partial<Run>): RunState {
  return { ...state, run: { ...state.run, ...patch } };
}

function blockedGate(run: Run): Gate | null {
  return run.status.kind === 'blocked' ? run.status.gate : null;
}

function understood(run: Run): boolean {
  return run.domain.decisions.some((decision) => decision.id === SHARED_UNDERSTANDING_ID);
}

function isConfirmed(run: Run, seam: string): boolean {
  return run.testContract.confirmedSeams.some((candidate) => candidate.id === seam);
}

export function guard(state: RunState, to: Phase): string | null {
  const { run, graph } = state;
  const from = run.phase;
  if (from === 'CLASSIFY') {
    const expected = classify(run.mode);
    return to === expected ? null : `mode ${run.mode} routes to ${expected}`;
  }
  switch (to) {
    case 'DOMAIN':
      if (from === 'CLARIFY' && !understood(run)) return 'shared understanding not confirmed';
      if (from === 'DIAGNOSE' && run.rootCause === null) return 'root cause not recorded';
      return null;
    case 'PROTOTYPE':
      return from === 'ARCHITECT' && run.architecture.candidates.length < 2 ? 'at least two design candidates required' : null;
    case 'DESIGN':
    case 'CONFIRM_TDD_SEAMS':
      if (from === 'ARCHITECT' && run.architecture.chosen === null) return 'no design chosen';
      if (from === 'PROTOTYPE' && run.prototypes.length === 0) return 'no prototype recorded';
      return null;
    case 'BUILD_GRAPH':
      return run.testContract.confirmedSeams.length === 0 ? 'no confirmed test seams' : null;
    case 'IMPLEMENT':
      return from === 'BUILD_GRAPH' && graph.nodes.length === 0 ? 'graph has no nodes' : null;
    case 'INTEGRATE': {
      const unfinished = graph.nodes.filter((node) => node.status !== 'passed' && node.status !== 'integrated');
      return unfinished.length > 0 ? `nodes not passed: ${unfinished.map((node) => node.id).join(', ')}` : null;
    }
    case 'REVIEW': {
      const pending = graph.nodes.filter((node) => node.status !== 'integrated');
      return pending.length > 0 ? `nodes not integrated: ${pending.map((node) => node.id).join(', ')}` : null;
    }
    case 'VERIFY': {
      if (from === 'REVIEW' && currentReview(state) === null) return 'no review recorded at the current revision';
      const open = state.findings.filter((finding) => finding.status === 'open');
      return open.length > 0 ? `open findings: ${open.map((finding) => finding.id).join(', ')}` : null;
    }
    case 'FREEZE_REVISION': {
      const missing = requiredEvidence(state).filter((required) => !required.satisfied);
      return missing.length > 0 ? `criteria lack MEASURED evidence: ${missing.map((required) => required.criterion).join('; ')}` : null;
    }
    case 'REVERIFY_STALE':
      return from === 'FREEZE_REVISION' && run.frozenRevision !== run.currentRevision ? 'revision not frozen at current revision' : null;
    case 'PR_READY': {
      const blockers = prReadyBlockers(state);
      return blockers.length > 0 ? blockers.join('; ') : null;
    }
    case 'START':
    case 'PREFLIGHT':
    case 'CLASSIFY':
    case 'CLARIFY':
    case 'DIAGNOSE':
    case 'EXPLICIT_TRIAGE':
    case 'EXPLICIT_ARCH_REVIEW':
    case 'ARCHITECT':
      return null;
    default: {
      const _exhaustive: never = to;
      return _exhaustive;
    }
  }
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

function advance(state: RunState, to: Phase, clock: Clock): Outcome {
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

function invokeSkill(state: RunState, skill: string, clock: Clock): Outcome {
  const check = canModelInvoke(state.run.skillRegistry, skill, state.run.capabilities.installedSkills);
  switch (check.kind) {
    case 'allowed':
      return done(state, 'invoke_skill', `invoked ${skill}`, clock);
    case 'user_only':
      return reject(`${skill} is user-only; the user must run ${check.action}`, { kind: 'user_workflow', skill, action: check.action });
    case 'not_in_registry':
      return reject(`${skill} is not in the locked top-50 registry`);
    case 'not_installed':
      return reject(`${skill} is not installed`, { kind: 'missing_skill', skill, install: check.install });
    default: {
      const _exhaustive: never = check;
      return _exhaustive;
    }
  }
}

function completeUserWorkflow(state: RunState, skill: string, clock: Clock): Outcome {
  const gate = blockedGate(state.run);
  if (gate === null) return noop(state);
  if (gate.kind === 'user_workflow' && gate.skill === skill) {
    return done(withRun(state, { status: { kind: 'active' } }), 'complete_user_workflow', `user completed /skill:${skill}`, clock);
  }
  if (gate.kind === 'missing_skill' && gate.skill === skill) {
    const capabilities = { ...state.run.capabilities, installedSkills: [...state.run.capabilities.installedSkills, skill] };
    return done(withRun(state, { status: { kind: 'active' }, capabilities }), 'complete_user_workflow', `user installed ${skill}`, clock);
  }
  return reject(`no ${skill} gate is open`, gate);
}

function answerDecisions(state: RunState, decisions: readonly Decision[], clock: Clock): Outcome {
  const existing = state.run.domain.decisions;
  const merged = [...existing.filter((decision) => !decisions.some((answer) => answer.id === decision.id)), ...decisions];
  if (decisions.every((answer) => existing.some((decision) => same(decision, answer)))) return noop(state);
  const gate = blockedGate(state.run);
  const answered = gate?.kind === 'decisions' && gate.questions.every((question) => merged.some((decision) => decision.id === question.id));
  const status: RunStatus = answered ? { kind: 'active' } : state.run.status;
  return done(withRun(state, { domain: { ...state.run.domain, decisions: merged }, status }), 'answer_decisions', `answered ${decisions.map((decision) => decision.id).join(', ')}`, clock);
}

function confirmUnderstanding(state: RunState, clock: Clock): Outcome {
  const gate = blockedGate(state.run);
  const clears = gate?.kind === 'shared_understanding';
  if (understood(state.run) && !clears) return noop(state);
  const decision: Decision = { id: SHARED_UNDERSTANDING_ID, question: 'Is the shared understanding correct?', answer: 'confirmed', decidedBy: 'user' };
  const decisions = understood(state.run) ? state.run.domain.decisions : [...state.run.domain.decisions, decision];
  const status: RunStatus = clears ? { kind: 'active' } : state.run.status;
  return done(withRun(state, { domain: { ...state.run.domain, decisions }, status }), 'confirm_understanding', 'shared understanding confirmed', clock);
}

function evidenceFrom(state: RunState, input: EvidenceInput, clock: Clock): { readonly record: EvidenceRecord; readonly duplicate: boolean } {
  const claim = redact(input.claim);
  const previous = latestByClaim(state.evidence).find((record) => record.claim === claim);
  const record: EvidenceRecord = {
    ...input,
    claim,
    criterion: redact(input.criterion),
    expected: redact(input.expected),
    observed: redact(input.observed),
    artifact: redact(input.artifact),
    id: '',
    recordedAt: '',
    revision: state.run.currentRevision,
    supersedes: previous?.id ?? null,
  };
  const duplicate = previous !== undefined && same({ ...previous, id: '', recordedAt: '', supersedes: null }, { ...record, supersedes: null });
  return { record: { ...record, id: duplicate ? '' : clock.id('ev'), recordedAt: duplicate ? '' : clock.now() }, duplicate };
}

function recordPrototype(state: RunState, command: Extract<Command, { kind: 'record_prototype' }>, clock: Clock): Outcome {
  if (command.branch.trim() === '') return reject('prototype branch required; prototypes are retained on a branch');
  const prototype = { question: redact(command.question), verdict: redact(command.verdict), branch: command.branch, issuePointer: command.issuePointer };
  if (state.run.prototypes.some((existing) => same(existing, prototype))) return noop(state);
  const { record } = evidenceFrom(
    state,
    { claim: `prototype: ${prototype.question}`, criterion: 'prototype', state: 'MEASURED', dependencies: [], method: 'prototype', expected: prototype.question, observed: prototype.verdict, artifact: command.branch },
    clock,
  );
  const next = { ...withRun(state, { prototypes: [...state.run.prototypes, prototype] }), evidence: [...state.evidence, record] };
  return done(next, 'record_prototype', `prototype retained on branch ${command.branch}`, clock);
}

function proposeSeams(state: RunState, seams: readonly Seam[], clock: Clock): Outcome {
  if (seams.length === 0) return reject('no seams proposed');
  const proposed = state.run.testContract.proposedSeams;
  if (seams.every((seam) => proposed.some((existing) => same(existing, seam)))) return noop(state);
  const merged = [...proposed.filter((existing) => !seams.some((seam) => seam.id === existing.id)), ...seams];
  const unconfirmed = merged.filter((seam) => !isConfirmed(state.run, seam.id)).map((seam) => seam.id);
  const status: RunStatus = state.run.status.kind === 'active' && unconfirmed.length > 0 ? { kind: 'blocked', gate: { kind: 'seam_confirmation', seams: unconfirmed } } : state.run.status;
  return done(withRun(state, { testContract: { ...state.run.testContract, proposedSeams: merged }, status }), 'propose_seams', `proposed seams ${seams.map((seam) => seam.id).join(', ')}`, clock);
}

function confirmSeams(state: RunState, ids: readonly string[], clock: Clock): Outcome {
  const { proposedSeams, confirmedSeams } = state.run.testContract;
  const unknown = ids.find((id) => !proposedSeams.some((seam) => seam.id === id));
  if (unknown !== undefined) return reject(`unknown seam ${unknown}`);
  const fresh = ids.filter((id) => !isConfirmed(state.run, id));
  if (fresh.length === 0) return noop(state);
  const confirmed = [...confirmedSeams, ...proposedSeams.filter((seam) => fresh.includes(seam.id))];
  const gate = blockedGate(state.run);
  let status = state.run.status;
  if (gate?.kind === 'seam_confirmation') {
    const remaining = gate.seams.filter((id) => !confirmed.some((seam) => seam.id === id));
    status = remaining.length === 0 ? { kind: 'active' } : { kind: 'blocked', gate: { kind: 'seam_confirmation', seams: remaining } };
  }
  return done(withRun(state, { testContract: { proposedSeams, confirmedSeams: confirmed }, status }), 'confirm_seams', `confirmed seams ${fresh.join(', ')}`, clock);
}

function recordDiagnostic(state: RunState, loop: DiagnosticLoop, clock: Clock): Outcome {
  if (state.run.phase !== 'DIAGNOSE') return reject(`diagnostic loops are recorded in DIAGNOSE, not ${state.run.phase}`);
  if (loop.status === 'promoted') return reject('promote diagnostics with promote_diagnostic');
  const existing = state.run.diagnostics.find((candidate) => candidate.id === loop.id);
  if (existing?.status === 'promoted') return reject(`diagnostic ${loop.id} already promoted`);
  if (existing !== undefined && same(existing, loop)) return noop(state);
  const clean = { ...loop, symptom: redact(loop.symptom), command: redact(loop.command), promotedTo: null };
  const diagnostics = existing === undefined ? [...state.run.diagnostics, clean] : state.run.diagnostics.map((candidate) => (candidate.id === loop.id ? clean : candidate));
  return done(resumed(withRun(state, { diagnostics })), 'record_diagnostic', `diagnostic ${loop.id} (${loop.kind}) is ${loop.status}`, clock);
}

export const REVIEW_CLAIM = 'review';

function reviewSurface(run: Run): ReviewSurface {
  const facts = routeFacts(run);
  return facts.webUi ? { kind: 'web_ui', react: facts.reactStack } : { kind: 'non_web' };
}

function guidelinesLock(run: Run): string {
  const skill = run.skillRegistry.skills.find((candidate) => candidate.name === 'web-design-guidelines');
  if (skill === undefined) return 'web-design-guidelines@unlocked';
  return skill.lock.kind === 'git_commit' ? `web-design-guidelines@${skill.lock.commit}` : `web-design-guidelines@${skill.lock.contentHash}`;
}

export function currentReview(state: RunState): EvidenceRecord | null {
  const record = latestByClaim(state.evidence).find((candidate) => candidate.claim === REVIEW_CLAIM);
  return record !== undefined && record.state === 'MEASURED' && record.revision === state.run.currentRevision ? record : null;
}

function currentGuidelines(state: RunState): Finding['guidelines'] {
  const review = currentReview(state);
  if (review === null || !review.artifact.startsWith('sha256:')) return null;
  return { contentHash: review.artifact, skillLock: guidelinesLock(state.run) };
}

// A review covers the code the graph wrote; with no write sets it cannot bound itself, so any change stales it.
function reviewedPaths(state: RunState): readonly string[] {
  const paths = [...new Set(state.graph.nodes.flatMap((node) => node.writeSet))];
  return paths.length === 0 ? ['**'] : paths;
}

function recordReview(state: RunState, command: Extract<Command, { kind: 'record_review' }>, clock: Clock): Outcome {
  if (state.run.phase !== 'REVIEW' && state.run.phase !== 'REVERIFY_STALE') return reject(`reviews are recorded in REVIEW or REVERIFY_STALE, not ${state.run.phase}`);
  const surface = reviewSurface(state.run);
  const missing = reviewDimensions(surface).filter((dimension) => !command.dimensions.includes(dimension));
  if (missing.length > 0) return reject(`review misses dimensions: ${missing.join(', ')}`);
  if (surface.kind === 'web_ui' && command.guidelinesContent === null) return reject('web UI review needs the fetched web-design-guidelines content');
  const guidelines = command.guidelinesContent === null ? null : captureGuidelines(command.guidelinesContent, guidelinesLock(state.run));
  const assurance = reviewAssurance(state.run.capabilities);
  const label = assurance.kind === 'independent' ? 'independent' : `reduced: ${assurance.reason}`;
  const input: EvidenceInput = {
    claim: REVIEW_CLAIM,
    criterion: REVIEW_CLAIM,
    state: 'MEASURED',
    dependencies: reviewedPaths(state),
    method: 'review',
    expected: reviewDimensions(surface).join(','),
    observed: `${redact(command.reviewer)} (${label})${guidelines === null ? '' : ` guidelines ${guidelines.skillLock}`}`,
    artifact: guidelines?.contentHash ?? `review by ${redact(command.reviewer)}`,
  };
  const { record, duplicate } = evidenceFrom(state, input, clock);
  if (duplicate) return noop(state);
  return done({ ...state, evidence: [...state.evidence, record] }, 'record_review', `review at ${record.revision}: ${label}`, clock);
}

const INCONCLUSIVE_PHASES: readonly Phase[] = ['DIAGNOSE', 'VERIFY', 'REVERIFY_STALE'];

function declareInconclusive(state: RunState, missing: string, clock: Clock): Outcome {
  const clean = redact(missing);
  if (same(state.run.status, { kind: 'inconclusive', missing: clean })) return noop(state);
  if (!INCONCLUSIVE_PHASES.includes(state.run.phase)) return reject(`inconclusive is declared in ${INCONCLUSIVE_PHASES.join(', ')}, not ${state.run.phase}`);
  return done(withRun(state, { status: { kind: 'inconclusive', missing: clean } }), 'declare_inconclusive', `INCONCLUSIVE: missing ${clean}`, clock);
}

// New feedback (a loop or a measurement) means the missing access was obtained, so the run resumes.
function resumed(state: RunState): RunState {
  return state.run.status.kind === 'inconclusive' ? withRun(state, { status: { kind: 'active' } }) : state;
}

function recordRootCause(state: RunState, cause: string, clock: Clock): Outcome {
  const clean = redact(cause);
  if (state.run.rootCause === clean) return noop(state);
  if (!state.run.diagnostics.some((loop) => loop.status === 'red')) return reject('root cause requires a red diagnostic loop');
  return done(withRun(state, { rootCause: clean }), 'record_root_cause', `root cause: ${clean}`, clock);
}

function promoteDiagnostic(state: RunState, loopId: string, seamId: string, clock: Clock): Outcome {
  const loop = state.run.diagnostics.find((candidate) => candidate.id === loopId);
  if (loop === undefined) return reject(`unknown diagnostic ${loopId}`);
  if (loop.status === 'promoted' && loop.promotedTo === seamId) return noop(state);
  if (!isConfirmed(state.run, seamId)) return reject(`seam ${seamId} is not confirmed`, { kind: 'seam_confirmation', seams: [seamId] });
  const diagnostics = state.run.diagnostics.map((candidate): DiagnosticLoop => (candidate.id === loopId ? { ...candidate, status: 'promoted', promotedTo: seamId } : candidate));
  return done(withRun(state, { diagnostics }), 'promote_diagnostic', `diagnostic ${loopId} promoted to seam ${seamId}`, clock);
}

export function validateGraph(nodes: readonly GraphNodeInput[]): string | null {
  if (nodes.length === 0) return 'graph needs at least one node';
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) return `duplicate node id ${node.id}`;
    ids.add(node.id);
    if (HORIZONTAL_LAYERS.includes(node.objective.trim().toLowerCase())) return `node ${node.id} objective "${node.objective}" is a horizontal layer; slice vertically`;
    if (node.writeSet.length === 0) return `node ${node.id} has an empty write set`;
  }
  for (const node of nodes) {
    const unknown = node.dependencies.find((dependency) => !ids.has(dependency));
    if (unknown !== undefined) return `node ${node.id} depends on unknown node ${unknown}`;
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): string | null => {
    if (visiting.has(id)) return id;
    if (visited.has(id)) return null;
    visiting.add(id);
    for (const dependency of nodes.find((node) => node.id === id)?.dependencies ?? []) {
      const cycle = visit(dependency);
      if (cycle !== null) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle !== null) return `dependency cycle through ${cycle}`;
  }
  return null;
}

function buildGraph(state: RunState, nodes: readonly GraphNodeInput[], clock: Clock): Outcome {
  if (state.run.phase !== 'BUILD_GRAPH') return reject(`build_graph requires BUILD_GRAPH, not ${state.run.phase}`);
  const invalid = validateGraph(nodes);
  if (invalid !== null) return reject(invalid);
  const graphNodes = nodes.map((node): GraphNode => ({ ...node, status: 'pending' }));
  if (same(graphNodes, state.graph.nodes)) return noop(state);
  return done({ ...state, graph: { schemaVersion: 1, nodes: graphNodes } }, 'build_graph', `graph with ${nodes.length} vertical slices`, clock);
}

function setNodeStatus(state: RunState, ids: readonly string[], status: GraphNode['status']): RunState {
  return { ...state, graph: { ...state.graph, nodes: state.graph.nodes.map((node) => (ids.includes(node.id) ? { ...node, status } : node)) } };
}

function startNodes(state: RunState, ids: readonly string[], clock: Clock): Outcome {
  if (state.run.phase !== 'IMPLEMENT') return reject(`start_nodes requires IMPLEMENT, not ${state.run.phase}`);
  if (ids.length === 0 || new Set(ids).size !== ids.length) return reject('start_nodes needs distinct node ids');
  const nodes = ids.map((id) => state.graph.nodes.find((node) => node.id === id));
  if (nodes.every((node) => node?.status === 'running')) return noop(state);
  const frontier = readyFrontier(state.graph);
  const picked: GraphNode[] = [];
  for (const [index, node] of nodes.entries()) {
    if (node === undefined) return reject(`unknown node ${ids[index] ?? ''}`);
    if (!frontier.includes(node)) {
      const waiting = blockedBy(state.graph, node);
      return reject(`node ${node.id} is not ready${waiting.length > 0 ? `; blocked by ${waiting.join(', ')}` : ` (${node.status})`}`);
    }
    picked.push(node);
  }
  if (picked.length > 1) {
    if (!canRunConcurrently(state.run.capabilities)) return reject('serialized: concurrent nodes require independent agents with isolated worktrees');
    for (const [index, a] of picked.entries()) {
      for (const b of picked.slice(index + 1)) {
        const reason = conflict(a, b);
        if (reason !== null) return reject(`serialized: ${a.id} conflicts with ${b.id}: ${reason}`);
      }
    }
  }
  return done(setNodeStatus(state, ids, 'running'), 'start_nodes', `started ${ids.join(', ')}`, clock);
}

function completeNode(state: RunState, id: string, passed: boolean, clock: Clock): Outcome {
  const node = state.graph.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) return reject(`unknown node ${id}`);
  const target = passed ? 'passed' : 'failed';
  if (node.status === target) return noop(state);
  if (node.status !== 'running') return reject(`node ${id} is ${node.status}, not running`);
  return done(setNodeStatus(state, [id], target), 'complete_node', `node ${id} ${target}`, clock);
}

function changeRevision(state: RunState, revision: string, changedPaths: readonly string[], clock: Clock): RunState {
  if (revision === state.run.currentRevision) return state;
  const evidence = invalidate(state.evidence, changedPaths, revision, clock);
  const leavingReady = state.run.phase === 'PR_READY';
  const run: Run = {
    ...state.run,
    currentRevision: revision,
    phase: leavingReady ? 'REVERIFY_STALE' : state.run.phase,
    status: state.run.status.kind === 'pr_ready' ? { kind: 'active' } : state.run.status,
  };
  return { ...state, run, evidence };
}

function integrateNode(state: RunState, command: Extract<Command, { kind: 'integrate_node' }>, clock: Clock): Outcome {
  if (state.run.phase !== 'IMPLEMENT' && state.run.phase !== 'INTEGRATE') return reject(`integrate_node requires IMPLEMENT or INTEGRATE, not ${state.run.phase}`);
  const node = state.graph.nodes.find((candidate) => candidate.id === command.id);
  if (node === undefined) return reject(`unknown node ${command.id}`);
  if (node.status === 'integrated' && state.run.currentRevision === command.revision) return noop(state);
  if (node.status !== 'passed') return reject(`node ${command.id} is ${node.status}, not passed`);
  const next = changeRevision(setNodeStatus(state, [command.id], 'integrated'), command.revision, command.changedPaths, clock);
  return done(next, 'integrate_node', `${INTEGRATION_OWNER} integrated ${command.id} at ${command.revision}`, clock);
}

function revisionChanged(state: RunState, revision: string, changedPaths: readonly string[], clock: Clock): Outcome {
  if (revision === state.run.currentRevision) return noop(state);
  const next = changeRevision(state, revision, changedPaths, clock);
  const stale = next.evidence.length - state.evidence.length;
  return done(next, 'revision_changed', `revision ${state.run.currentRevision} -> ${revision}; ${stale} records rebound or staled`, clock);
}

function recordEvidence(state: RunState, input: EvidenceInput, clock: Clock): Outcome {
  const { record, duplicate } = evidenceFrom(state, input, clock);
  if (duplicate) return noop(state);
  const next = { ...state, evidence: [...state.evidence, record] };
  return done(record.state === 'MEASURED' ? resumed(next) : next, 'record_evidence', `${record.state} ${record.claim} at ${record.revision}`, clock);
}

function recordFinding(state: RunState, input: FindingInput, clock: Clock): Outcome {
  const probe = createFinding({ ...input, guidelines: input.guidelines ?? currentGuidelines(state) }, '', state.run.currentRevision);
  if (state.findings.some((finding) => finding.status === 'open' && sameFinding(finding, probe))) return noop(state);
  const finding = { ...probe, id: clock.id('finding') };
  return done({ ...state, findings: [...state.findings, finding] }, 'record_finding', `${finding.severity} finding ${finding.id} by ${finding.reviewer}`, clock);
}

function resolve(state: RunState, id: string, resolution: 'resolved' | 'dismissed', clock: Clock): Outcome {
  const finding = state.findings.find((candidate) => candidate.id === id);
  if (finding === undefined) return reject(`unknown finding ${id}`);
  if (finding.status === resolution) return noop(state);
  const findings = state.findings.map((candidate): Finding => (candidate.id === id ? resolveFinding(candidate, resolution) : candidate));
  return done({ ...state, findings }, 'resolve_finding', `finding ${id} ${resolution}`, clock);
}

function requestAuthorization(state: RunState, action: AuthorizationAction, scope: string, clock: Clock): Outcome {
  const gate = blockedGate(state.run);
  if (gate !== null && grantMatches(gate, action, scope)) return noop(state);
  if (gate !== null) return reject(`run already blocked on ${gate.kind} gate`, gate);
  return done(withRun(state, { status: { kind: 'blocked', gate: { kind: 'authorization', action, scope } } }), 'request_authorization', `authorization requested: ${action} ${scope}`, clock);
}

function grantAuthorization(state: RunState, action: AuthorizationAction, scope: string, clock: Clock): Outcome {
  const gate = blockedGate(state.run);
  if (gate === null || gate.kind !== 'authorization') return reject('no authorization pending', gate);
  if (!grantMatches(gate, action, scope)) return reject(`grant ${action} ${scope} does not match pending ${gate.action} ${gate.scope}`, gate);
  return done(withRun(state, { status: { kind: 'active' } }), 'grant_authorization', `authorization granted: ${action} ${scope}`, clock);
}

export function apply(state: RunState, command: Command, clock: Clock): Outcome {
  switch (command.kind) {
    case 'advance':
      return advance(state, command.to, clock);
    case 'invoke_skill':
      return invokeSkill(state, command.skill, clock);
    case 'complete_user_workflow':
      return completeUserWorkflow(state, command.skill, clock);
    case 'answer_decisions':
      return answerDecisions(state, command.decisions, clock);
    case 'confirm_understanding':
      return confirmUnderstanding(state, clock);
    case 'record_domain': {
      const domain = { ...state.run.domain, terms: command.terms, invariants: command.invariants, scenarios: command.scenarios };
      if (same(domain, state.run.domain)) return noop(state);
      return done(withRun(state, { domain }), 'record_domain', `domain: ${command.terms.length} terms, ${command.invariants.length} invariants`, clock);
    }
    case 'propose_designs': {
      if (command.candidates.length < 2) return reject('at least two design candidates required');
      if (same(command.candidates, state.run.architecture.candidates)) return noop(state);
      const chosen = state.run.architecture.chosen;
      const keep = chosen !== null && command.candidates.some((candidate) => candidate.id === chosen.id) ? chosen : null;
      return done(withRun(state, { architecture: { ...state.run.architecture, candidates: command.candidates, chosen: keep } }), 'propose_designs', `${command.candidates.length} design candidates`, clock);
    }
    case 'choose_design': {
      if (!state.run.architecture.candidates.some((candidate) => candidate.id === command.id)) return reject(`unknown design ${command.id}`);
      const architecture = { ...state.run.architecture, chosen: { id: command.id, reason: command.reason }, interfaces: command.interfaces, seams: command.seams, ownership: command.ownership };
      if (same(architecture, state.run.architecture)) return noop(state);
      return done(withRun(state, { architecture }), 'choose_design', `chose ${command.id}: ${command.reason}`, clock);
    }
    case 'record_prototype':
      return recordPrototype(state, command, clock);
    case 'propose_seams':
      return proposeSeams(state, command.seams, clock);
    case 'confirm_seams':
      return confirmSeams(state, command.ids, clock);
    case 'record_test':
      if (!isConfirmed(state.run, command.seam)) return reject(`seam ${command.seam} is not confirmed; TDD tests need a confirmed seam`, { kind: 'seam_confirmation', seams: [command.seam] });
      return done(state, 'record_test', `tdd test at seam ${command.seam}`, clock);
    case 'record_diagnostic':
      return recordDiagnostic(state, command.loop, clock);
    case 'record_root_cause':
      return recordRootCause(state, command.cause, clock);
    case 'promote_diagnostic':
      return promoteDiagnostic(state, command.loopId, command.seamId, clock);
    case 'build_graph':
      return buildGraph(state, command.nodes, clock);
    case 'start_nodes':
      return startNodes(state, command.ids, clock);
    case 'complete_node':
      return completeNode(state, command.id, command.passed, clock);
    case 'integrate_node':
      return integrateNode(state, command, clock);
    case 'record_evidence':
      return recordEvidence(state, command.evidence, clock);
    case 'revision_changed':
      return revisionChanged(state, command.revision, command.changedPaths, clock);
    case 'record_finding':
      return recordFinding(state, command.finding, clock);
    case 'resolve_finding':
      return resolve(state, command.id, command.resolution, clock);
    case 'request_authorization':
      return requestAuthorization(state, command.action, command.scope, clock);
    case 'grant_authorization':
      return grantAuthorization(state, command.action, command.scope, clock);
    case 'freeze_revision':
      if (state.run.frozenRevision === state.run.currentRevision) return noop(state);
      return done(withRun(state, { frozenRevision: state.run.currentRevision }), 'freeze_revision', `froze ${state.run.currentRevision}`, clock);
    case 'declare_inconclusive':
      return declareInconclusive(state, command.missing, clock);
    case 'record_review':
      return recordReview(state, command, clock);
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
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

function routeFacts(run: Run): Parameters<typeof routeSkills>[1] {
  const web = run.consumer.kind === 'browser' || run.consumer.kind === 'electron';
  return { modelChange: run.domain.terms.length === 0, reactStack: run.constraints.some((constraint) => /\b(react|next)\b/i.test(constraint)), webUi: web, browserConsumer: web };
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
