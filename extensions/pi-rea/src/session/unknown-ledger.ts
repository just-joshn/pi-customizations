
import { invalidRequest, revisionConflict } from '../contract/errors.ts';
import { AUTHORITIES, type Authority, CONFIDENCES, type Confidence, canonicalJson, type EvidenceEnvironment, ISOLATIONS, sha256Hex, UNKNOWN_ID_PATTERN } from './evidence.ts';

export const UNKNOWN_STATUSES = ['open', 'investigating', 'blocked', 'contradicted', 'resolved'] as const;
export const UNKNOWN_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const RELATIONSHIP_TYPES = ['depends-on', 'related-to', 'contradicts'] as const;

export type UnknownStatus = (typeof UNKNOWN_STATUSES)[number];
export type UnknownSeverity = (typeof UNKNOWN_SEVERITIES)[number];

export interface UnknownProbe {
  readonly operation: string;
  readonly rationale: string;
}

export interface UnknownRelationship {
  readonly type: (typeof RELATIONSHIP_TYPES)[number];
  readonly unknown_id: string;
}

export type UnknownResolution =
  | { readonly disposition: 'verified'; readonly rationale: string; readonly evidence_ids: readonly string[] }
  | { readonly disposition: 'withdrawn' | 'out-of-scope'; readonly rationale: string; readonly evidence_ids: readonly string[] };

export const RESOLUTION_DISPOSITIONS = ['verified', 'withdrawn', 'out-of-scope'] as const;

const isResolution = (value: unknown): value is UnknownResolution => {
  if (value === null) return false;
  if (!isObject(value)) return false;
  const { disposition, rationale, evidence_ids } = value;
  if (typeof rationale !== 'string' || rationale.length === 0) return false;
  if (!isStringArray(evidence_ids)) return false;
  if (disposition === 'verified') return evidence_ids.length >= 1;
  return disposition === 'withdrawn' || disposition === 'out-of-scope';
};

const isEnvironment = (value: unknown): value is EvidenceEnvironment => {
  if (!isObject(value)) return false;
  const { id, platform, architecture, isolation } = value;
  const nullableString = (entry: unknown): boolean => entry === null || typeof entry === 'string';
  if (!nullableString(id) || !nullableString(platform) || !nullableString(architecture)) return false;
  return isolation === null || ISOLATIONS.includes(isolation as (typeof ISOLATIONS)[number]);
};

export const isUnknownRecord = (value: unknown): value is UnknownRecord => {
  if (!isObject(value)) return false;
  const { unknown_id, revision, revision_digest, question, severity, domain, status, required_authority, required_confidence, required_environment, recommended_probes, relationships, mutation_evidence_ids, resolution } = value;
  if (typeof unknown_id !== 'string' || !UNKNOWN_ID_PATTERN.test(unknown_id)) return false;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return false;
  if (typeof revision_digest !== 'string' || !/^[a-f0-9]{64}$/.test(revision_digest)) return false;
  if (typeof question !== 'string' || question.length === 0 || typeof domain !== 'string') return false;
  if (!UNKNOWN_SEVERITIES.includes(severity as UnknownSeverity)) return false;
  if (!UNKNOWN_STATUSES.includes(status as UnknownStatus)) return false;
  if (required_authority !== null && !AUTHORITIES.includes(required_authority as (typeof AUTHORITIES)[number])) return false;
  if (!CONFIDENCES.includes(required_confidence as (typeof CONFIDENCES)[number])) return false;
  if (required_environment !== null && !isEnvironment(required_environment)) return false;
  if (!Array.isArray(recommended_probes) || !Array.isArray(relationships)) return false;
  if (!isStringArray(mutation_evidence_ids)) return false;
  if (resolution !== null && !isResolution(resolution)) return false;
  return true;
};

export interface UnknownDraft {
  readonly question: string;
  readonly severity: UnknownSeverity;
  readonly domain: string;
  readonly required_authority: Authority | null;
  readonly required_confidence: Confidence;
  readonly required_environment: EvidenceEnvironment | null;
  readonly recommended_probes: readonly UnknownProbe[];
  readonly relationships: readonly UnknownRelationship[];
  readonly supporting_evidence_ids: readonly string[];
  readonly contradicting_evidence_ids: readonly string[];
}

export interface UnknownRecord extends UnknownDraft {
  readonly unknown_id: string;
  readonly revision: number;
  readonly previous_revision_digest: string | null;
  readonly revision_digest: string;
  readonly scope_digest: string | null;
  readonly status: UnknownStatus;
  readonly resolution: UnknownResolution | null;
  readonly mutation_evidence_ids: readonly string[];
}

export const unknownIdentity = (draft: UnknownDraft): string => `unk_${sha256Hex(canonicalJson(draft))}`;

export const unknownRevisionDigest = (record: UnknownRecord): string =>
  sha256Hex(
    canonicalJson({
      unknown_id: record.unknown_id,
      revision: record.revision,
      status: record.status,
      severity: record.severity,
      domain: record.domain,
      question: record.question,
      supporting_evidence_ids: record.supporting_evidence_ids,
      contradicting_evidence_ids: record.contradicting_evidence_ids,
      required_authority: record.required_authority,
      required_confidence: record.required_confidence,
      required_environment: record.required_environment,
      recommended_probes: record.recommended_probes,
      relationships: record.relationships,
      resolution: record.resolution,
    }),
  );

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

export const validateUnknownDraft = (value: unknown): UnknownDraft => {
  if (!isObject(value)) throw invalidRequest('An unknown must be an object.', { domain: 'unknown' });
  const required = ['question', 'severity', 'domain', 'required_authority', 'required_confidence', 'required_environment', 'recommended_probes', 'relationships'];
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw invalidRequest(`Invalid arguments for tool record_unknown: ${missing.join(', ')}: Required.`, { missing });
  }
  const { question, domain, severity, required_authority, required_confidence, required_environment } = value;
  if (typeof question !== 'string' || question.length === 0) {
    throw invalidRequest('Invalid arguments for tool record_unknown: question: Invalid input: expected a non-empty string', { parameter: 'question' });
  }
  if (typeof domain !== 'string' || domain.length === 0) {
    throw invalidRequest('Invalid arguments for tool record_unknown: domain: Invalid input: expected a non-empty string', { parameter: 'domain' });
  }
  if (!UNKNOWN_SEVERITIES.includes(severity as UnknownSeverity)) {
    throw invalidRequest(`Invalid arguments for tool record_unknown: severity: Invalid option: expected one of ${UNKNOWN_SEVERITIES.map((option) => JSON.stringify(option)).join('|')}`, { parameter: 'severity' });
  }
  if (required_authority !== null && !AUTHORITIES.includes(required_authority as (typeof AUTHORITIES)[number])) {
    throw invalidRequest('required_authority must be a known authority or null.', { parameter: 'required_authority' });
  }
  if (!CONFIDENCES.includes(required_confidence as (typeof CONFIDENCES)[number])) {
    throw invalidRequest(`Invalid arguments for tool record_unknown: required_confidence: Invalid option: expected one of ${CONFIDENCES.map((option) => JSON.stringify(option)).join('|')}`, { parameter: 'required_confidence' });
  }
  if (required_environment !== null && !isEnvironment(required_environment)) {
    throw invalidRequest('required_environment must be an object with id, platform, architecture and isolation, or null.', {
      parameter: 'required_environment',
    });
  }
  const probes = value['recommended_probes'];
  if (
    !Array.isArray(probes) ||
    probes.some((probe) => {
      if (!isObject(probe)) return true;
      const { operation, rationale } = probe;
      return typeof operation !== 'string' || typeof rationale !== 'string';
    })
  ) {
    throw invalidRequest('recommended_probes must be an array of { operation, rationale } objects.', { parameter: 'recommended_probes' });
  }
  const relationships = value['relationships'];
  if (!Array.isArray(relationships)) {
    throw invalidRequest('relationships must be an array.', { parameter: 'relationships' });
  }
  for (const relationship of relationships) {
    const { type, unknown_id } = isObject(relationship) ? relationship : {};
    if (typeof type !== 'string' || !RELATIONSHIP_TYPES.includes(type as (typeof RELATIONSHIP_TYPES)[number]) || typeof unknown_id !== 'string' || !UNKNOWN_ID_PATTERN.test(unknown_id)) {
      throw invalidRequest('relationships entries must be { type, unknown_id } with a known relationship type and unk_ identifier.', {
        parameter: 'relationships',
      });
    }
  }
  for (const key of ['supporting_evidence_ids', 'contradicting_evidence_ids']) {
    const ids = value[key];
    if (ids !== undefined && !isStringArray(ids)) throw invalidRequest(`${key} must be an array of Evidence identifiers.`, { parameter: key });
  }
  return value as unknown as UnknownDraft;
};

export class UnknownLedger {
  #records = new Map<string, UnknownRecord>();

  get size(): number {
    return this.#records.size;
  }

  get revisionCount(): number {
    return [...this.#records.values()].reduce((total, record) => total + record.revision, 0);
  }

  record(draft: UnknownDraft, mutationEvidenceId: string): UnknownRecord {
    const unknownId = unknownIdentity(draft);
    const existing = this.#records.get(unknownId);
    if (existing !== undefined) return existing;
    const base = {
      ...draft,
      unknown_id: unknownId,
      revision: 1,
      previous_revision_digest: null,
      scope_digest: null,
      status: 'open' as UnknownStatus,
      resolution: null,
      mutation_evidence_ids: [mutationEvidenceId],
    };
    const record: UnknownRecord = { ...base, revision_digest: unknownRevisionDigest({ ...base, revision_digest: '' }) };
    this.#records.set(unknownId, record);
    return record;
  }

  get(unknownId: string): UnknownRecord | undefined {
    return this.#records.get(unknownId);
  }

  insertImported(records: readonly Record<string, unknown>[]): number {
    let added = 0;
    for (const entry of records) {
      if (!isUnknownRecord(entry)) continue;
      if (this.#records.has(entry.unknown_id)) continue;
      this.#records.set(entry.unknown_id, entry);
      added += 1;
    }
    return added;
  }

  list(): UnknownRecord[] {
    return [...this.#records.values()];
  }

  clear(): void {
    this.#records.clear();
  }

  assertUpdatable(unknownId: string, expectedRevision: number): UnknownRecord {
    const existing = this.#records.get(unknownId);
    if (existing === undefined) {
      throw invalidRequest(`Unknown ${unknownId} is not retained in this session.`, { unknown_id: unknownId, reason: 'missing' });
    }
    if (existing.revision !== expectedRevision) {
      throw revisionConflict(`Unknown ${unknownId} is at revision ${existing.revision}, not the expected revision ${expectedRevision}. Read list_unknowns and retry with the current revision.`, {
        unknown_id: unknownId,
        expected_revision: expectedRevision,
        actual_revision: existing.revision,
      });
    }
    return existing;
  }

  update(unknownId: string, expectedRevision: number, changes: Partial<UnknownDraft> & { readonly status?: UnknownStatus; readonly resolution?: UnknownResolution | null }, mutationEvidenceId: string): UnknownRecord {
    const existing = this.#records.get(unknownId);
    if (existing === undefined) {
      throw invalidRequest(`Unknown ${unknownId} is not retained in this session.`, {
        unknown_id: unknownId,
        reason: 'missing',
      });
    }
    if (existing.revision !== expectedRevision) {
      throw revisionConflict(`Unknown ${unknownId} is at revision ${existing.revision}, not the expected revision ${expectedRevision}. Read list_unknowns and retry with the current revision.`, {
        unknown_id: unknownId,
        expected_revision: expectedRevision,
        actual_revision: existing.revision,
      });
    }
    const base = {
      ...existing,
      ...changes,
      unknown_id: unknownId,
      revision: existing.revision + 1,
      previous_revision_digest: existing.revision_digest,
      scope_digest: null,
      mutation_evidence_ids: [...existing.mutation_evidence_ids, mutationEvidenceId],
    };
    const record: UnknownRecord = { ...base, revision_digest: unknownRevisionDigest({ ...base, revision_digest: '' }) };
    this.#records.set(unknownId, record);
    return record;
  }
}
