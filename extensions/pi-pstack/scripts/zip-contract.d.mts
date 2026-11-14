import type { Inputs } from './parity-lib.mjs';

export interface ZipRequirement {
  id: string;
  kind: string;
  mandatory: true;
  source: { document: string; lines: [number, number] };
  stimulus: string;
  evidence: string;
  unresolved: { verdict: 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason: string };
}
export interface ZipRegister {
  schemaVersion: 1;
  upstreamRevision: string;
  authority: { description: string; files: { file: string; sha256: string }[] };
  requirements: ZipRequirement[];
}
export interface ZipAssessment {
  status: 'ACCEPTED' | 'NOT RELEASED';
  evidence: { path: string; sha256: string } | null;
  requirements: (ZipRequirement & { status: string; reason: string })[];
  problems: string[];
}
export function validateZip(zip: unknown): string[];
export function zipRequirementDigest(requirement: ZipRequirement): string;
export function evaluateZip(root: string, inputs: Inputs, evidencePath: string | null, piVersion: string | null): ZipAssessment;
