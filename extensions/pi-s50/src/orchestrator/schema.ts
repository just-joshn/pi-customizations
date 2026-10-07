import { EVIDENCE_STATES, type EvidenceRecord } from '../domain/evidence.ts';
import type { Finding } from '../domain/findings.ts';
import type { Graph, GraphNode, VerificationMethod } from '../domain/graph.ts';
import { CONSUMER_KINDS, type Consumer, type Decision, type DesignCandidate, type DiagnosticLoop, type HostCapabilities, type Prototype, RUN_SCHEMA_VERSION, type Run, type Seam } from '../domain/run.ts';
import { AUTHORIZATION_ACTIONS, type Gate, MODES, PHASES, type Question, type RunStatus } from '../domain/state.ts';
import { registrySnapshot } from '../registry/validate.ts';
import type { Command, DecisionLog, EvidenceInput, GraphNodeInput } from './coordinator.ts';
import { array, bool, type Decoder, nonEmptyStr, nullable, object, oneOf, str, tagged } from './decode.ts';

const strings = array(str);
const phase = oneOf(PHASES);
const authorizationAction = oneOf(AUTHORIZATION_ACTIONS);
const method: Decoder<VerificationMethod> = oneOf(['test', 'browser', 'cli', 'http', 'library', 'native', 'review', 'prototype', 'web_guidelines']);

const decision = object<Decision>({ id: nonEmptyStr, question: str, answer: str, decidedBy: oneOf(['user', 'fact']) });
const candidate = object<DesignCandidate>({ id: nonEmptyStr, summary: str, tradeoffs: str });
const seam = object<Seam>({ id: nonEmptyStr, description: str, catches: str, misses: str });
const loop = object<DiagnosticLoop>({
  id: nonEmptyStr,
  kind: oneOf(['failing_test', 'http', 'cli_fixture', 'browser', 'trace_replay', 'throwaway_program', 'fuzz', 'bisect', 'differential', 'human_assisted']),
  command: str,
  symptom: str,
  status: oneOf(['red', 'green', 'promoted']),
  promotedTo: nullable(str),
});
const prototype = object<Prototype>({ question: str, verdict: str, branch: nonEmptyStr, issuePointer: nullable(str) });
const question = object<Question>({ id: nonEmptyStr, title: str, body: str, recommendation: str });

export const gate: Decoder<Gate> = tagged<Gate>({
  user_workflow: object({ kind: oneOf(['user_workflow']), skill: nonEmptyStr, action: nonEmptyStr }),
  missing_skill: object({ kind: oneOf(['missing_skill']), skill: nonEmptyStr, install: nonEmptyStr }),
  decisions: object({ kind: oneOf(['decisions']), questions: array(question) }),
  shared_understanding: object({ kind: oneOf(['shared_understanding']) }),
  seam_confirmation: object({ kind: oneOf(['seam_confirmation']), seams: strings }),
  authorization: object({ kind: oneOf(['authorization']), action: authorizationAction, scope: str }),
});

const runStatus: Decoder<RunStatus> = tagged<RunStatus>({
  active: object({ kind: oneOf(['active']) }),
  blocked: object({ kind: oneOf(['blocked']), gate }),
  inconclusive: object({ kind: oneOf(['inconclusive']), missing: str }),
  pr_ready: object({ kind: oneOf(['pr_ready']), revision: str }),
});

export const capabilities: Decoder<HostCapabilities> = object<HostCapabilities>({
  independentAgents: bool,
  isolatedWorktrees: bool,
  browserDriver: bool,
  nativeAutomation: bool,
  installedSkills: strings,
});

const consumer = object<Consumer>({ kind: oneOf(CONSUMER_KINDS), userPath: str });

export const run: Decoder<Run> = object<Run>({
  id: nonEmptyStr,
  schemaVersion: oneOf([RUN_SCHEMA_VERSION]),
  mode: oneOf(MODES),
  objective: str,
  phase,
  status: runStatus,
  repository: str,
  baselineRevision: str,
  currentRevision: str,
  frozenRevision: nullable(str),
  consumer,
  acceptanceCriteria: strings,
  constraints: strings,
  nonGoals: strings,
  domain: object<Run['domain']>({ terms: strings, invariants: strings, scenarios: strings, decisions: array(decision) }),
  architecture: object<Run['architecture']>({
    candidates: array(candidate),
    chosen: nullable(object<{ readonly id: string; readonly reason: string }>({ id: str, reason: str })),
    interfaces: strings,
    seams: strings,
    ownership: strings,
  }),
  testContract: object<Run['testContract']>({ proposedSeams: array(seam), confirmedSeams: array(seam) }),
  diagnostics: array(loop),
  rootCause: nullable(str),
  prototypes: array(prototype),
  capabilities,
  skillRegistry: registrySnapshot,
  blockers: strings,
  risks: strings,
});

const nodeFields = {
  id: nonEmptyStr,
  objective: nonEmptyStr,
  dependencies: strings,
  owner: str,
  writeSet: strings,
  schemas: strings,
  migrations: strings,
  definesInterfaces: strings,
  consumesInterfaces: strings,
  runtimeOwnership: strings,
  expectedBehavior: str,
  verification: method,
};

const nodeInput = object<GraphNodeInput>(nodeFields);

export const graph: Decoder<Graph> = object<Graph>({
  schemaVersion: oneOf([1]),
  nodes: array(object<GraphNode>({ ...nodeFields, status: oneOf(['pending', 'running', 'passed', 'failed', 'integrated']) })),
});

const evidenceInputFields = {
  claim: nonEmptyStr,
  criterion: str,
  state: oneOf(EVIDENCE_STATES),
  dependencies: strings,
  method,
  expected: str,
  observed: str,
  artifact: str,
};

export const evidenceRecord: Decoder<EvidenceRecord> = object<EvidenceRecord>({
  ...evidenceInputFields,
  id: nonEmptyStr,
  revision: str,
  recordedAt: str,
  supersedes: nullable(str),
});

const severity = oneOf(['critical', 'high', 'medium', 'low']);
const guidelines = nullable(object<NonNullable<Finding['guidelines']>>({ contentHash: str, skillLock: str }));
const findingInputFields = { severity, trigger: str, consequence: str, evidence: str, owner: str, reviewer: nonEmptyStr, guidelines };

export const finding: Decoder<Finding> = object<Finding>({
  ...findingInputFields,
  id: nonEmptyStr,
  revision: str,
  status: oneOf(['open', 'resolved', 'dismissed']),
});

const LOGGED_COMMANDS = [
  'advance',
  'invoke_skill',
  'complete_user_workflow',
  'answer_decisions',
  'confirm_understanding',
  'record_domain',
  'propose_designs',
  'choose_design',
  'record_prototype',
  'propose_seams',
  'confirm_seams',
  'record_test',
  'record_diagnostic',
  'record_root_cause',
  'promote_diagnostic',
  'build_graph',
  'start_nodes',
  'complete_node',
  'integrate_node',
  'record_evidence',
  'revision_changed',
  'record_finding',
  'resolve_finding',
  'request_authorization',
  'grant_authorization',
  'freeze_revision',
  'declare_inconclusive',
  'record_review',
  'preflight',
] as const satisfies readonly DecisionLog['command'][];

export const decisionLog: Decoder<DecisionLog> = object<DecisionLog>({
  at: str,
  phase,
  command: oneOf(LOGGED_COMMANDS),
  summary: str,
});

const k = <K extends string>(kind: K) => oneOf([kind]);

export const command: Decoder<Command> = tagged<Command>({
  advance: object({ kind: k('advance'), to: phase }),
  invoke_skill: object({ kind: k('invoke_skill'), skill: nonEmptyStr }),
  complete_user_workflow: object({ kind: k('complete_user_workflow'), skill: nonEmptyStr }),
  answer_decisions: object({ kind: k('answer_decisions'), decisions: array(decision) }),
  confirm_understanding: object({ kind: k('confirm_understanding') }),
  record_domain: object({ kind: k('record_domain'), terms: strings, invariants: strings, scenarios: strings }),
  propose_designs: object({ kind: k('propose_designs'), candidates: array(candidate) }),
  choose_design: object({ kind: k('choose_design'), id: nonEmptyStr, reason: str, interfaces: strings, seams: strings, ownership: strings }),
  record_prototype: object({ kind: k('record_prototype'), question: str, verdict: str, branch: str, issuePointer: nullable(str) }),
  propose_seams: object({ kind: k('propose_seams'), seams: array(seam) }),
  confirm_seams: object({ kind: k('confirm_seams'), ids: strings }),
  record_test: object({ kind: k('record_test'), seam: nonEmptyStr, test: k('tdd') }),
  record_diagnostic: object({ kind: k('record_diagnostic'), loop }),
  record_root_cause: object({ kind: k('record_root_cause'), cause: nonEmptyStr }),
  promote_diagnostic: object({ kind: k('promote_diagnostic'), loopId: nonEmptyStr, seamId: nonEmptyStr }),
  build_graph: object({ kind: k('build_graph'), nodes: array(nodeInput) }),
  start_nodes: object({ kind: k('start_nodes'), ids: strings }),
  complete_node: object({ kind: k('complete_node'), id: nonEmptyStr, passed: bool }),
  integrate_node: object({ kind: k('integrate_node'), id: nonEmptyStr, revision: nonEmptyStr, changedPaths: strings }),
  record_evidence: object({ kind: k('record_evidence'), evidence: object<EvidenceInput>(evidenceInputFields) }),
  revision_changed: object({ kind: k('revision_changed'), revision: nonEmptyStr, changedPaths: strings }),
  record_finding: object({ kind: k('record_finding'), finding: object<Omit<Finding, 'id' | 'status' | 'revision'>>(findingInputFields) }),
  resolve_finding: object({ kind: k('resolve_finding'), id: nonEmptyStr, resolution: oneOf(['resolved', 'dismissed']) }),
  request_authorization: object({ kind: k('request_authorization'), action: authorizationAction, scope: str }),
  grant_authorization: object({ kind: k('grant_authorization'), action: authorizationAction, scope: str }),
  freeze_revision: object({ kind: k('freeze_revision') }),
  declare_inconclusive: object({ kind: k('declare_inconclusive'), missing: nonEmptyStr }),
  record_review: object({ kind: k('record_review'), reviewer: nonEmptyStr, dimensions: strings, guidelinesContent: nullable(str) }),
});
