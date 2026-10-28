import { createHash } from 'node:crypto';

export const CONFIDENCES = ['observed', 'derived', 'inferred'] as const;
export const AUTHORITIES = ['shipped-artifact', 'controlled-replay', 'historical-reference', 'external-service', 'analyst-inference'] as const;
export const ISOLATIONS = ['none', 'process', 'container', 'virtual-machine'] as const;

export type Confidence = (typeof CONFIDENCES)[number];
export type Authority = (typeof AUTHORITIES)[number];

export interface EvidenceSubject {
  readonly name: string;
  readonly digest: { readonly sha256: string };
  readonly format: string;
  readonly architecture: string | null;
  readonly local_path: string | null;
}

export interface EvidenceProvider {
  readonly id: string;
  readonly name: string;
  readonly version: string | null;
}

export interface EvidenceEnvironment {
  readonly id: string | null;
  readonly platform: string | null;
  readonly architecture: string | null;
  readonly isolation: (typeof ISOLATIONS)[number] | null;
}

export interface EvidenceRecord {
  readonly evidence_id: string;
  readonly subject: EvidenceSubject | null;
  readonly provider: EvidenceProvider;
  readonly analysis_profile: Record<string, unknown> | null;
  readonly predicate_type: EvidencePredicateType;
  readonly operation: string;
  readonly parameters: Record<string, unknown>;
  readonly raw_result: unknown;
  readonly normalized_result: unknown;
  readonly confidence: Confidence;
  readonly authority: Authority;
  readonly environment: EvidenceEnvironment | null;
  readonly limitations: readonly string[];
  readonly locations: readonly Record<string, unknown>[];
  readonly evidence_links: readonly string[];
}

export const EVIDENCE_PREDICATE_TYPES = [
  'rea.analysis',
  'rea.javascript-application-analysis',
  'rea.residual-unknown-mutation',
  'rea.artifact-comparison',
  'rea.bundle-comparison',
  'rea.managed-member-comparison',
  'rea.javascript-export-shape-comparison',
  'rea.javascript-application-version-comparison',
  'rea.application-version-comparison',
  'rea.source-to-bundle-comparison',
  'rea.web-script-export',
  'rea.apple-application-graph',
  'rea.reverse-engineering.command-observation',
] as const;
export type EvidencePredicateType = (typeof EVIDENCE_PREDICATE_TYPES)[number];

export type EvidenceDraft = Omit<EvidenceRecord, 'evidence_id'>;

export const EVIDENCE_ID_PATTERN = /^ev_[a-f0-9]{64}$/;
export const UNKNOWN_ID_PATTERN = /^unk_[a-f0-9]{64}$/;

export const canonicalJson = (value: unknown): string => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
};

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

const identityProjection = (draft: EvidenceDraft): Record<string, unknown> => ({
  predicate_type: draft.predicate_type,
  operation: draft.operation,
  parameters: draft.parameters,
  subject: draft.subject,
  provider_id: draft.provider.id,
  provider_version: draft.provider.version,
  analysis_profile: draft.analysis_profile,
  confidence: draft.confidence,
  authority: draft.authority,
  environment: draft.environment,
  raw_result: draft.raw_result,
  normalized_result: draft.normalized_result,
  limitations: draft.limitations,
  locations: draft.locations,
  evidence_links: draft.evidence_links,
});

export const evidenceIdentity = (draft: EvidenceDraft): string => `ev_${sha256Hex(canonicalJson(identityProjection(draft)))}`;

export const createEvidence = (draft: EvidenceDraft): EvidenceRecord => ({
  evidence_id: evidenceIdentity(draft),
  ...draft,
});

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

const isSubject = (value: unknown): value is EvidenceSubject => {
  if (!isObject(value)) return false;
  const { name, digest, format, architecture, local_path } = value;
  if (typeof name !== 'string' || typeof format !== 'string') return false;
  if (architecture !== null && typeof architecture !== 'string') return false;
  if (local_path !== null && typeof local_path !== 'string') return false;
  if (!isObject(digest)) return false;
  return typeof digest['sha256'] === 'string';
};

const isProvider = (value: unknown): value is EvidenceProvider => {
  if (!isObject(value)) return false;
  const { id, name, version } = value;
  if (typeof id !== 'string' || typeof name !== 'string') return false;
  return version === null || typeof version === 'string';
};

export const isEvidenceRecord = (value: unknown): value is EvidenceRecord => {
  if (!isObject(value)) return false;
  const { evidence_id, predicate_type, operation, parameters, confidence, authority, subject, provider, limitations, locations, evidence_links } = value;
  if (typeof evidence_id !== 'string' || !EVIDENCE_ID_PATTERN.test(evidence_id)) return false;
  if (!EVIDENCE_PREDICATE_TYPES.includes(predicate_type as EvidencePredicateType)) return false;
  if (typeof operation !== 'string' || operation.length === 0) return false;
  if (!isObject(parameters)) return false;
  if (!CONFIDENCES.includes(confidence as Confidence)) return false;
  if (!AUTHORITIES.includes(authority as Authority)) return false;
  if (subject !== null && !isSubject(subject)) return false;
  if (!isProvider(provider)) return false;
  if (!isStringArray(limitations)) return false;
  if (!Array.isArray(locations) || !locations.every(isObject)) return false;
  return isStringArray(evidence_links);
};

export const verifyEvidenceIdentity = (record: EvidenceRecord): boolean => {
  const { evidence_id: claimed, ...draft } = record;
  return evidenceIdentity(draft) === claimed;
};

export interface EvidenceSummaryEntry {
  readonly evidence_id: string;
  readonly subject: EvidenceSubject | null;
  readonly provider: EvidenceProvider;
  readonly operation: string;
  readonly confidence: Confidence;
  readonly authority: Authority;
  readonly analysis_profile_digest: string | null;
  readonly retention: 'complete-record';
  readonly limitation_count: number;
  readonly native_dossier: { readonly available: boolean; readonly reason: string };
}

export const evidenceSummaryEntry = (record: EvidenceRecord): EvidenceSummaryEntry => ({
  evidence_id: record.evidence_id,
  subject: record.subject,
  provider: record.provider,
  operation: record.operation,
  confidence: record.confidence,
  authority: record.authority,
  analysis_profile_digest: record.analysis_profile === null ? null : sha256Hex(canonicalJson(record.analysis_profile)),
  retention: 'complete-record',
  limitation_count: record.limitations.length,
  native_dossier: { available: false, reason: 'different-operation' },
});
