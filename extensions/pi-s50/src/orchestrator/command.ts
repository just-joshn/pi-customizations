import type { EvidenceRecord } from '../domain/evidence.ts';
import type { GraphNode } from '../domain/graph.ts';
import type { Consumer, Decision, DesignCandidate, DiagnosticLoop, HostCapabilities, Run, RunState, Seam } from '../domain/run.ts';
import type { AuthorizationAction, Gate, Mode, Phase, Question } from '../domain/state.ts';
import type { ConsumerRoute } from '../evidence/verification.ts';
import type { FindingInput } from '../review/findings.ts';
import type { ReviewAssurance } from '../review/reviewer.ts';
import type { Clock } from './clock.ts';
import type { CheckKind } from './routes.ts';

export type EvidenceInput = Omit<EvidenceRecord, 'id' | 'recordedAt' | 'supersedes' | 'revision'>;

export type GraphNodeInput = Omit<GraphNode, 'status'>;

export type Command =
  | { readonly kind: 'advance'; readonly to: Phase }
  | { readonly kind: 'invoke_skill'; readonly skill: string }
  | { readonly kind: 'complete_user_workflow'; readonly skill: string }
  | { readonly kind: 'ask_decisions'; readonly questions: readonly Question[] }
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
  | {
      readonly kind: 'record_test';
      readonly seam: string;
      readonly name: string;
      readonly result: 'red' | 'green';
      readonly command: string;
      readonly observed: string;
      readonly dependencies: readonly string[];
    }
  | { readonly kind: 'record_diagnostic'; readonly loop: DiagnosticLoop }
  | { readonly kind: 'record_root_cause'; readonly cause: string }
  | { readonly kind: 'promote_diagnostic'; readonly loopId: string; readonly seamId: string }
  | { readonly kind: 'build_graph'; readonly nodes: readonly GraphNodeInput[] }
  | { readonly kind: 'start_nodes'; readonly ids: readonly string[] }
  | { readonly kind: 'complete_node'; readonly id: string; readonly passed: boolean }
  | { readonly kind: 'integrate_node'; readonly id: string; readonly revision: string; readonly changedPaths: readonly string[]; readonly integrator: string }
  | { readonly kind: 'record_evidence'; readonly evidence: EvidenceInput }
  | { readonly kind: 'revision_changed'; readonly revision: string; readonly changedPaths: readonly string[] }
  | { readonly kind: 'record_finding'; readonly finding: FindingInput }
  | { readonly kind: 'resolve_finding'; readonly id: string; readonly resolution: 'resolved' | 'dismissed' }
  | { readonly kind: 'request_authorization'; readonly action: AuthorizationAction; readonly scope: string }
  | { readonly kind: 'grant_authorization'; readonly action: AuthorizationAction; readonly scope: string }
  | { readonly kind: 'freeze_revision' }
  | { readonly kind: 'declare_inconclusive'; readonly missing: string }
  | { readonly kind: 'record_review'; readonly reviewer: string; readonly independent: boolean; readonly dimensions: readonly string[]; readonly guidelinesContent: string | null }
  | { readonly kind: 'route_failure'; readonly check: CheckKind; readonly detail: string };

export type CommandKind = Command['kind'];

export type DecisionLog = { readonly at: string; readonly phase: Phase; readonly command: CommandKind | 'preflight'; readonly summary: string };

export type Outcome = { readonly kind: 'ok'; readonly state: RunState; readonly decisions: readonly DecisionLog[] } | { readonly kind: 'rejected'; readonly reason: string; readonly gate: Gate | null };

export type NextAction =
  | { readonly kind: 'human_gate'; readonly gate: Gate }
  | { readonly kind: 'advance'; readonly to: Phase }
  | { readonly kind: 'invoke_skill'; readonly skill: string }
  | { readonly kind: 'start_nodes'; readonly ids: readonly string[]; readonly workspaces: readonly string[] }
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

export function canonical(value: unknown): unknown {
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

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function noop(state: RunState): Outcome {
  return { kind: 'ok', state, decisions: [] };
}

export function reject(reason: string, gate: Gate | null = null): Outcome {
  return { kind: 'rejected', reason, gate };
}

export function done(next: RunState, command: CommandKind, summary: string, clock: Clock): Outcome {
  return { kind: 'ok', state: next, decisions: [{ at: clock.now(), phase: next.run.phase, command, summary }] };
}

export function withRun(state: RunState, patch: Partial<Run>): RunState {
  return { ...state, run: { ...state.run, ...patch } };
}

export function blockedGate(run: Run): Gate | null {
  return run.status.kind === 'blocked' ? run.status.gate : null;
}

export function understood(run: Run): boolean {
  return run.domain.decisions.some((decision) => decision.id === SHARED_UNDERSTANDING_ID);
}

export function isConfirmed(run: Run, seam: string): boolean {
  return run.testContract.confirmedSeams.some((candidate) => candidate.id === seam);
}
