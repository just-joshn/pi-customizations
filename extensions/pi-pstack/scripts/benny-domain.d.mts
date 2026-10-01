export type VerdictMarkers = { bug: string; performance: string; other: string };
export type BennyConfig = { sourceChannel: string; triageIdentity: string; markers?: VerdictMarkers };
export type SourceThread = Readonly<{ channel: string; thread: string }>;
export type FixEvidence = {
  baselineReproductions: number;
  mediaConfirmed: boolean;
  runtimeCause: boolean;
  rejectionWindowClosed: boolean;
  humanOwnsFix: boolean;
  existingFix: boolean;
  budgetRemaining: boolean;
  baselineAndPatchedControl: boolean;
};
export type IssueEligibility = { classification: 'bug' | 'performance'; clearlyBroken: boolean; stillLive: boolean; duplicate: 'none' | 'possible' | 'confident'; targetResolved: boolean; permalink: string };
export function freezeSource(config: BennyConfig, input: unknown): SourceThread;
export function parseVerdict(text: unknown, markers?: VerdictMarkers): { kind: 'bug' | 'performance' | 'other'; tracker?: string } | undefined;
export function trustedVerdict(config: BennyConfig, source: SourceThread, input: unknown): { kind: 'bug' | 'performance'; tracker?: string } | undefined;
export function fixDecision(evidence: FixEvidence): 'fix' | 'stop' | 'verify-existing';
export function canCreateIssue(input: IssueEligibility): boolean;
