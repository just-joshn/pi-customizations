export interface TestRef {
  file: string;
  name: string;
}
export interface TestOutcome extends TestRef {
  outcome: string;
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
}
export interface Evaluated extends Requirement {
  results: TestOutcome[];
  status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'N/A';
  reason: string;
}
export interface Inputs {
  requirementsText: string;
  requirements: { structural: unknown[]; behavioral: unknown[]; tests: Record<string, unknown> };
  lock: { revision: string; files: Record<string, string> };
  dependencies: unknown;
}
export interface VitestReport {
  testResults?: { name: string; status: string; assertionResults?: { fullName: string; status: string }[] }[];
}
export function loadInputs(root: string): Inputs;
export function buildRecords(root: string, inputs: Inputs): { records: Requirement[]; problems: string[] };
export function evaluate(records: Requirement[], report: VitestReport, root: string): Evaluated[];
export function deriveStatus(record: Pick<Requirement, 'applicability' | 'coverageGap'> & { tests?: unknown[] }, outcomes: TestOutcome[]): { status: Evaluated['status']; reason: string };
export function renderStatusSection(manifest: unknown): string;
export function spliceStatusSection(doc: string, section: string): string;
