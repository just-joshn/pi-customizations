import type { EvidenceRecord } from '../domain/evidence.ts';
import type { Finding } from '../domain/findings.ts';
import type { GraphNode } from '../domain/graph.ts';
import type { Decision, DesignCandidate, DiagnosticLoop, Run, RunState, Seam } from '../domain/run.ts';
import type { AuthorizationAction, Phase, RunStatus } from '../domain/state.ts';
import { invalidate, latestByClaim } from '../evidence/invalidation.ts';
import { redact } from '../evidence/verification.ts';
import { grantMatches } from '../policy/authorization.ts';
import { currentReview, REVIEW_CLAIM } from '../policy/completion.ts';
import { canModelInvoke, type routeSkills } from '../policy/invocation.ts';
import { captureGuidelines, createFinding, type FindingInput, resolveFinding, sameFinding } from '../review/findings.ts';
import { type ReviewSurface, reviewAssurance, reviewDimensions } from '../review/reviewer.ts';
import { conflict } from '../scheduler/conflicts.ts';
import { blockedBy, readyFrontier } from '../scheduler/frontier.ts';
import { canRunConcurrently } from '../scheduler/ownership.ts';
import type { Clock } from './clock.ts';
import { blockedGate, type Command, done, type EvidenceInput, type GraphNodeInput, INTEGRATION_OWNER, isConfirmed, noop, type Outcome, reject, SHARED_UNDERSTANDING_ID, same, understood, withRun } from './command.ts';

export const HORIZONTAL_LAYERS = ['database', 'backend', 'frontend', 'tests', 'api', 'ui', 'schema', 'migration'];

export function invokeSkill(state: RunState, skill: string, clock: Clock): Outcome {
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

export function completeUserWorkflow(state: RunState, skill: string, clock: Clock): Outcome {
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

export function answerDecisions(state: RunState, decisions: readonly Decision[], clock: Clock): Outcome {
  const existing = state.run.domain.decisions;
  const merged = [...existing.filter((decision) => !decisions.some((answer) => answer.id === decision.id)), ...decisions];
  if (decisions.every((answer) => existing.some((decision) => same(decision, answer)))) return noop(state);
  const gate = blockedGate(state.run);
  const answered = gate?.kind === 'decisions' && gate.questions.every((question) => merged.some((decision) => decision.id === question.id));
  const status: RunStatus = answered ? { kind: 'active' } : state.run.status;
  return done(withRun(state, { domain: { ...state.run.domain, decisions: merged }, status }), 'answer_decisions', `answered ${decisions.map((decision) => decision.id).join(', ')}`, clock);
}

export function confirmUnderstanding(state: RunState, clock: Clock): Outcome {
  const gate = blockedGate(state.run);
  const clears = gate?.kind === 'shared_understanding';
  if (understood(state.run) && !clears) return noop(state);
  const decision: Decision = { id: SHARED_UNDERSTANDING_ID, question: 'Is the shared understanding correct?', answer: 'confirmed', decidedBy: 'user' };
  const decisions = understood(state.run) ? state.run.domain.decisions : [...state.run.domain.decisions, decision];
  const status: RunStatus = clears ? { kind: 'active' } : state.run.status;
  return done(withRun(state, { domain: { ...state.run.domain, decisions }, status }), 'confirm_understanding', 'shared understanding confirmed', clock);
}

export function evidenceFrom(state: RunState, input: EvidenceInput, clock: Clock): { readonly record: EvidenceRecord; readonly duplicate: boolean } {
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

export function recordPrototype(state: RunState, command: Extract<Command, { kind: 'record_prototype' }>, clock: Clock): Outcome {
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

export function proposeSeams(state: RunState, seams: readonly Seam[], clock: Clock): Outcome {
  if (seams.length === 0) return reject('no seams proposed');
  const proposed = state.run.testContract.proposedSeams;
  if (seams.every((seam) => proposed.some((existing) => same(existing, seam)))) return noop(state);
  const merged = [...proposed.filter((existing) => !seams.some((seam) => seam.id === existing.id)), ...seams];
  const unconfirmed = merged.filter((seam) => !isConfirmed(state.run, seam.id)).map((seam) => seam.id);
  const status: RunStatus = state.run.status.kind === 'active' && unconfirmed.length > 0 ? { kind: 'blocked', gate: { kind: 'seam_confirmation', seams: unconfirmed } } : state.run.status;
  return done(withRun(state, { testContract: { ...state.run.testContract, proposedSeams: merged }, status }), 'propose_seams', `proposed seams ${seams.map((seam) => seam.id).join(', ')}`, clock);
}

export function confirmSeams(state: RunState, ids: readonly string[], clock: Clock): Outcome {
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

export function recordDiagnostic(state: RunState, loop: DiagnosticLoop, clock: Clock): Outcome {
  if (state.run.phase !== 'DIAGNOSE') return reject(`diagnostic loops are recorded in DIAGNOSE, not ${state.run.phase}`);
  if (loop.status === 'promoted') return reject('promote diagnostics with promote_diagnostic');
  const existing = state.run.diagnostics.find((candidate) => candidate.id === loop.id);
  if (existing?.status === 'promoted') return reject(`diagnostic ${loop.id} already promoted`);
  if (existing !== undefined && same(existing, loop)) return noop(state);
  const clean = { ...loop, symptom: redact(loop.symptom), command: redact(loop.command), promotedTo: null };
  const diagnostics = existing === undefined ? [...state.run.diagnostics, clean] : state.run.diagnostics.map((candidate) => (candidate.id === loop.id ? clean : candidate));
  return done(resumed(withRun(state, { diagnostics })), 'record_diagnostic', `diagnostic ${loop.id} (${loop.kind}) is ${loop.status}`, clock);
}

export function reviewSurface(run: Run): ReviewSurface {
  const facts = routeFacts(run);
  return facts.webUi ? { kind: 'web_ui', react: facts.reactStack } : { kind: 'non_web' };
}

export function guidelinesLock(run: Run): string {
  const skill = run.skillRegistry.skills.find((candidate) => candidate.name === 'web-design-guidelines');
  if (skill === undefined) return 'web-design-guidelines@unlocked';
  return skill.lock.kind === 'git_commit' ? `web-design-guidelines@${skill.lock.commit}` : `web-design-guidelines@${skill.lock.contentHash}`;
}

export function currentGuidelines(state: RunState): Finding['guidelines'] {
  const review = currentReview(state);
  if (review === null || !review.artifact.startsWith('sha256:')) return null;
  return { contentHash: review.artifact, skillLock: guidelinesLock(state.run) };
}

// A review covers the code the graph wrote; with no write sets it cannot bound itself, so any change stales it.
export function reviewedPaths(state: RunState): readonly string[] {
  const paths = [...new Set(state.graph.nodes.flatMap((node) => node.writeSet))];
  return paths.length === 0 ? ['**'] : paths;
}

export function recordReview(state: RunState, command: Extract<Command, { kind: 'record_review' }>, clock: Clock): Outcome {
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

export const INCONCLUSIVE_PHASES: readonly Phase[] = ['DIAGNOSE', 'VERIFY', 'REVERIFY_STALE'];

export function declareInconclusive(state: RunState, missing: string, clock: Clock): Outcome {
  const clean = redact(missing);
  if (same(state.run.status, { kind: 'inconclusive', missing: clean })) return noop(state);
  if (!INCONCLUSIVE_PHASES.includes(state.run.phase)) return reject(`inconclusive is declared in ${INCONCLUSIVE_PHASES.join(', ')}, not ${state.run.phase}`);
  return done(withRun(state, { status: { kind: 'inconclusive', missing: clean } }), 'declare_inconclusive', `INCONCLUSIVE: missing ${clean}`, clock);
}

// New feedback (a loop or a measurement) means the missing access was obtained, so the run resumes.
export function resumed(state: RunState): RunState {
  return state.run.status.kind === 'inconclusive' ? withRun(state, { status: { kind: 'active' } }) : state;
}

export function recordRootCause(state: RunState, cause: string, clock: Clock): Outcome {
  const clean = redact(cause);
  if (state.run.rootCause === clean) return noop(state);
  if (!state.run.diagnostics.some((loop) => loop.status === 'red')) return reject('root cause requires a red diagnostic loop');
  return done(withRun(state, { rootCause: clean }), 'record_root_cause', `root cause: ${clean}`, clock);
}

export function promoteDiagnostic(state: RunState, loopId: string, seamId: string, clock: Clock): Outcome {
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

export function buildGraph(state: RunState, nodes: readonly GraphNodeInput[], clock: Clock): Outcome {
  if (state.run.phase !== 'BUILD_GRAPH') return reject(`build_graph requires BUILD_GRAPH, not ${state.run.phase}`);
  const invalid = validateGraph(nodes);
  if (invalid !== null) return reject(invalid);
  const graphNodes = nodes.map((node): GraphNode => ({ ...node, status: 'pending' }));
  if (same(graphNodes, state.graph.nodes)) return noop(state);
  return done({ ...state, graph: { schemaVersion: 1, nodes: graphNodes } }, 'build_graph', `graph with ${nodes.length} vertical slices`, clock);
}

export function setNodeStatus(state: RunState, ids: readonly string[], status: GraphNode['status']): RunState {
  return { ...state, graph: { ...state.graph, nodes: state.graph.nodes.map((node) => (ids.includes(node.id) ? { ...node, status } : node)) } };
}

export function startNodes(state: RunState, ids: readonly string[], clock: Clock): Outcome {
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

export function completeNode(state: RunState, id: string, passed: boolean, clock: Clock): Outcome {
  const node = state.graph.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) return reject(`unknown node ${id}`);
  const target = passed ? 'passed' : 'failed';
  if (node.status === target) return noop(state);
  if (node.status !== 'running') return reject(`node ${id} is ${node.status}, not running`);
  return done(setNodeStatus(state, [id], target), 'complete_node', `node ${id} ${target}`, clock);
}

export function changeRevision(state: RunState, revision: string, changedPaths: readonly string[], clock: Clock): RunState {
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

export function integrateNode(state: RunState, command: Extract<Command, { kind: 'integrate_node' }>, clock: Clock): Outcome {
  if (state.run.phase !== 'IMPLEMENT' && state.run.phase !== 'INTEGRATE') return reject(`integrate_node requires IMPLEMENT or INTEGRATE, not ${state.run.phase}`);
  const node = state.graph.nodes.find((candidate) => candidate.id === command.id);
  if (node === undefined) return reject(`unknown node ${command.id}`);
  if (node.status === 'integrated' && state.run.currentRevision === command.revision) return noop(state);
  if (node.status !== 'passed') return reject(`node ${command.id} is ${node.status}, not passed`);
  const next = changeRevision(setNodeStatus(state, [command.id], 'integrated'), command.revision, command.changedPaths, clock);
  return done(next, 'integrate_node', `${INTEGRATION_OWNER} integrated ${command.id} at ${command.revision}`, clock);
}

export function revisionChanged(state: RunState, revision: string, changedPaths: readonly string[], clock: Clock): Outcome {
  if (revision === state.run.currentRevision) return noop(state);
  const next = changeRevision(state, revision, changedPaths, clock);
  const stale = next.evidence.length - state.evidence.length;
  return done(next, 'revision_changed', `revision ${state.run.currentRevision} -> ${revision}; ${stale} records rebound or staled`, clock);
}

export function recordEvidence(state: RunState, input: EvidenceInput, clock: Clock): Outcome {
  const { record, duplicate } = evidenceFrom(state, input, clock);
  if (duplicate) return noop(state);
  const next = { ...state, evidence: [...state.evidence, record] };
  return done(record.state === 'MEASURED' ? resumed(next) : next, 'record_evidence', `${record.state} ${record.claim} at ${record.revision}`, clock);
}

export function recordFinding(state: RunState, input: FindingInput, clock: Clock): Outcome {
  const probe = createFinding({ ...input, guidelines: input.guidelines ?? currentGuidelines(state) }, '', state.run.currentRevision);
  if (state.findings.some((finding) => finding.status === 'open' && sameFinding(finding, probe))) return noop(state);
  const finding = { ...probe, id: clock.id('finding') };
  return done({ ...state, findings: [...state.findings, finding] }, 'record_finding', `${finding.severity} finding ${finding.id} by ${finding.reviewer}`, clock);
}

export function resolve(state: RunState, id: string, resolution: 'resolved' | 'dismissed', clock: Clock): Outcome {
  const finding = state.findings.find((candidate) => candidate.id === id);
  if (finding === undefined) return reject(`unknown finding ${id}`);
  if (finding.status === resolution) return noop(state);
  const findings = state.findings.map((candidate): Finding => (candidate.id === id ? resolveFinding(candidate, resolution) : candidate));
  return done({ ...state, findings }, 'resolve_finding', `finding ${id} ${resolution}`, clock);
}

export function requestAuthorization(state: RunState, action: AuthorizationAction, scope: string, clock: Clock): Outcome {
  const gate = blockedGate(state.run);
  if (gate !== null && grantMatches(gate, action, scope)) return noop(state);
  if (gate !== null) return reject(`run already blocked on ${gate.kind} gate`, gate);
  return done(withRun(state, { status: { kind: 'blocked', gate: { kind: 'authorization', action, scope } } }), 'request_authorization', `authorization requested: ${action} ${scope}`, clock);
}

export function grantAuthorization(state: RunState, action: AuthorizationAction, scope: string, clock: Clock): Outcome {
  const gate = blockedGate(state.run);
  if (gate === null || gate.kind !== 'authorization') return reject('no authorization pending', gate);
  if (!grantMatches(gate, action, scope)) return reject(`grant ${action} ${scope} does not match pending ${gate.action} ${gate.scope}`, gate);
  return done(withRun(state, { status: { kind: 'active' } }), 'grant_authorization', `authorization granted: ${action} ${scope}`, clock);
}

export function routeFacts(run: Run): Parameters<typeof routeSkills>[1] {
  const web = run.consumer.kind === 'browser' || run.consumer.kind === 'electron';
  return { modelChange: run.domain.terms.length === 0, reactStack: run.constraints.some((constraint) => /\b(react|next)\b/i.test(constraint)), webUi: web, browserConsumer: web };
}

export function recordDomain(state: RunState, command: Extract<Command, { kind: 'record_domain' }>, clock: Clock): Outcome {
  const domain = { ...state.run.domain, terms: command.terms, invariants: command.invariants, scenarios: command.scenarios };
  if (same(domain, state.run.domain)) return noop(state);
  return done(withRun(state, { domain }), 'record_domain', `domain: ${command.terms.length} terms, ${command.invariants.length} invariants`, clock);
}

export function proposeDesigns(state: RunState, candidates: readonly DesignCandidate[], clock: Clock): Outcome {
  if (candidates.length < 2) return reject('at least two design candidates required');
  if (same(candidates, state.run.architecture.candidates)) return noop(state);
  const chosen = state.run.architecture.chosen;
  const keep = chosen !== null && candidates.some((candidate) => candidate.id === chosen.id) ? chosen : null;
  return done(withRun(state, { architecture: { ...state.run.architecture, candidates, chosen: keep } }), 'propose_designs', `${candidates.length} design candidates`, clock);
}

export function chooseDesign(state: RunState, command: Extract<Command, { kind: 'choose_design' }>, clock: Clock): Outcome {
  if (!state.run.architecture.candidates.some((candidate) => candidate.id === command.id)) return reject(`unknown design ${command.id}`);
  const architecture = { ...state.run.architecture, chosen: { id: command.id, reason: command.reason }, interfaces: command.interfaces, seams: command.seams, ownership: command.ownership };
  if (same(architecture, state.run.architecture)) return noop(state);
  return done(withRun(state, { architecture }), 'choose_design', `chose ${command.id}: ${command.reason}`, clock);
}

export function recordTest(state: RunState, seam: string, clock: Clock): Outcome {
  if (!isConfirmed(state.run, seam)) return reject(`seam ${seam} is not confirmed; TDD tests need a confirmed seam`, { kind: 'seam_confirmation', seams: [seam] });
  return done(state, 'record_test', `tdd test at seam ${seam}`, clock);
}

export function freezeRevision(state: RunState, clock: Clock): Outcome {
  if (state.run.frozenRevision === state.run.currentRevision) return noop(state);
  return done(withRun(state, { frozenRevision: state.run.currentRevision }), 'freeze_revision', `froze ${state.run.currentRevision}`, clock);
}
