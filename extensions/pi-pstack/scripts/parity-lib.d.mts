export interface TestRef {
  file: string;
  name: string;
}
export interface RunOutcome {
  platform: string;
  outcome: string;
}
export interface TestOutcome extends TestRef {
  outcome: string;
  byRun?: RunOutcome[];
}
export interface ResultRun {
  report: VitestReport;
  identity: { platform: string; root?: string };
}
export interface Applicability {
  mandatory: boolean;
  justification?: string;
}
export interface Source {
  file?: string;
  files?: { file: string }[];
  lines?: [number, number];
  specOnly?: boolean;
}
export interface Requirement {
  id: string;
  kind: string;
  applicability: Applicability;
  coverageGap?: string;
  source?: Source | null;
  tests: TestRef[];
  platforms?: string[] | undefined;
}
export interface Evaluated extends Requirement {
  results: TestOutcome[];
  status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'N/A';
  reason: string;
}
export interface Inputs {
  requirementsText: string;
  requirements: { structural: unknown[]; behavioral: unknown[]; tests: Record<string, unknown>; zip?: import('./zip-contract.mjs').ZipRegister };
  lock: { revision: string; files: Record<string, string> };
  dependencies: unknown;
}
export interface VitestReport {
  testResults?: { name: string; status: string; assertionResults?: { fullName: string; status: string }[] }[];
}
export function loadInputs(root: string): Inputs;
export function buildRecords(root: string, inputs: Inputs): { records: Requirement[]; problems: string[] };
export function evaluate(records: Requirement[], input: VitestReport | ResultRun[], root: string): Evaluated[];
export function deriveStatus(record: Pick<Requirement, 'applicability' | 'coverageGap'> & { tests?: unknown[] }, outcomes: TestOutcome[]): { status: Evaluated['status']; reason: string };
export function renderStatusSection(manifest: unknown): string;
export function spliceStatusSection(doc: string, section: string): string;
export function mergeOutcomes(record: Pick<Requirement, 'platforms'>, byRun: RunOutcome[]): string;
export function sourceDigest(root: string): string | null;
export function sourceState(root: string): { commit: string | null; dirty: boolean; changes: string[] | null; sourceDigest: string | null };
export function sidecarIdentity(sidecar: unknown): { identity?: { platform: string; commit: string; sourceDigest: string; runUrl: string; root: string }; problem?: string };
export function checkRuns(manifest: { runs?: Record<string, unknown>[] }, currentDigest: string | null): string[];
export function toolchain(env?: Record<string, string | undefined>): { piPath: string; piVersion: string | null; nodeVersion: string };
export function toolchainNotes(runs: { platform?: string; piVersion?: string | null }[]): string[];

export function absentLinkedTests(records: { id: string; tests: { file: string; name: string }[] }[], input: unknown, root: string): string[];
