import type { Finding } from './findings.ts';
import type { EvidenceRecord } from './evidence.ts';
import type { Graph } from './graph.ts';
import type { RegistrySnapshot } from './registry.ts';
import type { Mode, Phase, RunStatus } from './state.ts';

export const RUN_SCHEMA_VERSION = 2;

export const CONSUMER_KINDS = ['browser', 'electron', 'cli', 'tui', 'http', 'rpc', 'library', 'native'] as const;

export type ConsumerKind = (typeof CONSUMER_KINDS)[number];

export type Consumer = { readonly kind: ConsumerKind; readonly userPath: string };

export type Decision = { readonly id: string; readonly question: string; readonly answer: string; readonly decidedBy: 'user' | 'fact' };

export type DesignCandidate = { readonly id: string; readonly summary: string; readonly tradeoffs: string };

export type Seam = { readonly id: string; readonly description: string; readonly catches: string; readonly misses: string };

export type DiagnosticLoop = {
  readonly id: string;
  readonly kind: 'failing_test' | 'http' | 'cli_fixture' | 'browser' | 'trace_replay' | 'throwaway_program' | 'fuzz' | 'bisect' | 'differential' | 'human_assisted';
  readonly command: string;
  readonly symptom: string;
  readonly status: 'red' | 'green' | 'promoted';
  readonly promotedTo: string | null;
};

export type Prototype = { readonly question: string; readonly verdict: string; readonly branch: string; readonly issuePointer: string | null };

export type HostCapabilities = {
  readonly independentAgents: boolean;
  readonly isolatedWorktrees: boolean;
  readonly browserDriver: boolean;
  readonly nativeAutomation: boolean;
  readonly installedSkills: readonly string[];
};

export type Run = {
  readonly id: string;
  readonly schemaVersion: typeof RUN_SCHEMA_VERSION;
  readonly mode: Mode;
  readonly objective: string;
  readonly phase: Phase;
  readonly status: RunStatus;
  readonly repository: string;
  readonly baselineRevision: string;
  readonly currentRevision: string;
  readonly frozenRevision: string | null;
  readonly consumer: Consumer;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly nonGoals: readonly string[];
  readonly domain: { readonly terms: readonly string[]; readonly invariants: readonly string[]; readonly scenarios: readonly string[]; readonly decisions: readonly Decision[] };
  readonly architecture: {
    readonly candidates: readonly DesignCandidate[];
    readonly chosen: { readonly id: string; readonly reason: string } | null;
    readonly interfaces: readonly string[];
    readonly seams: readonly string[];
    readonly ownership: readonly string[];
  };
  readonly testContract: { readonly proposedSeams: readonly Seam[]; readonly confirmedSeams: readonly Seam[] };
  readonly diagnostics: readonly DiagnosticLoop[];
  readonly rootCause: string | null;
  readonly prototypes: readonly Prototype[];
  readonly capabilities: HostCapabilities;
  readonly skillRegistry: RegistrySnapshot;
  readonly blockers: readonly string[];
  readonly risks: readonly string[];
};

export type RunState = {
  readonly run: Run;
  readonly graph: Graph;
  readonly evidence: readonly EvidenceRecord[];
  readonly findings: readonly Finding[];
};
