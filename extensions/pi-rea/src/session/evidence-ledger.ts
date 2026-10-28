
import { evidenceIntegrityMismatch, invalidRequest } from '../contract/errors.ts';
import { canonicalJson, type EvidenceRecord, type EvidenceSummaryEntry, evidenceSummaryEntry, isEvidenceRecord, verifyEvidenceIdentity } from './evidence.ts';

export const BUNDLE_KINDS = ['artifacts', 'captures', 'environments', 'providers', 'records', 'scenarios', 'unknowns'] as const;

export interface EvidenceBundle {
  readonly artifacts: readonly Record<string, unknown>[];
  readonly captures: readonly Record<string, unknown>[];
  readonly environments: readonly Record<string, unknown>[];
  readonly providers: readonly Record<string, unknown>[];
  readonly records: readonly EvidenceRecord[];
  readonly scenarios: readonly Record<string, unknown>[];
  readonly unknowns: readonly Record<string, unknown>[];
}

export const emptyBundle = (): EvidenceBundle => ({
  artifacts: [],
  captures: [],
  environments: [],
  providers: [],
  records: [],
  scenarios: [],
  unknowns: [],
});

export const serializeBundle = (bundle: EvidenceBundle): string => canonicalJson(bundle);

export interface BundleValidation {
  readonly bundle?: EvidenceBundle;
  readonly error?: string;
}

const asObjectArray = (value: unknown, label: string): Record<string, unknown>[] | string => {
  if (!Array.isArray(value)) return `${label} must be an array`;
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return `${label}.${index} must be an object`;
  }
  return value as Record<string, unknown>[];
};

export const validateBundle = (value: unknown): BundleValidation => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { error: 'bundle must be an object' };
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !BUNDLE_KINDS.includes(key as (typeof BUNDLE_KINDS)[number]));
  if (unknownKeys.length > 0) return { error: `bundle has unsupported fields: ${unknownKeys.join(', ')}` };
  const bundle: Record<string, unknown> = {};
  for (const kind of BUNDLE_KINDS) {
    const entry = record[kind] ?? [];
    if (kind === 'records') {
      if (!Array.isArray(entry)) return { error: 'records must be an array' };
      for (const [index, candidate] of entry.entries()) {
        if (!isEvidenceRecord(candidate)) return { error: `records.${index}: not a canonical Evidence record` };
        if (!verifyEvidenceIdentity(candidate)) {
          return {
            error: `Evidence bundle does not match the bundle schema at records.${index}.evidence_id: Evidence semantic identifier does not match its record.`,
          };
        }
      }
      bundle[kind] = entry;
      continue;
    }
    const objects = asObjectArray(entry, kind);
    if (typeof objects === 'string') return { error: objects };
    bundle[kind] = objects;
  }
  return { bundle: bundle as unknown as EvidenceBundle };
};

export const parseBundle = (text: string): EvidenceBundle => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    void error;
    throw evidenceIntegrityMismatch('Evidence bundle is not valid JSON.', { reason: 'Evidence bundle validation failed' });
  }
  const { bundle, error } = validateBundle(parsed);
  if (bundle === undefined) {
    throw evidenceIntegrityMismatch(`Evidence bundle does not match the bundle schema at ${error}. Supply an unmodified bundle written by export_evidence_bundle.`, { reason: 'Evidence bundle validation failed' });
  }
  return bundle;
};

export interface EvidenceFilters {
  readonly evidence_id?: string;
  readonly operation?: string;
  readonly target_sha256?: string;
  readonly analysis_profile_digest?: string;
  readonly procedure_address?: string;
}

const filterEntries = (filters: EvidenceFilters): [string, string][] => Object.entries(filters).filter((entry): entry is [string, string] => typeof entry[1] === 'string');

export const matchesFilters = (entry: EvidenceSummaryEntry, record: EvidenceRecord, filters: EvidenceFilters): boolean =>
  filterEntries(filters).every(([key, expected]) => {
    switch (key) {
      case 'evidence_id':
        return entry.evidence_id === expected;
      case 'operation':
        return entry.operation === expected;
      case 'target_sha256':
        return record.subject?.digest.sha256 === expected;
      case 'analysis_profile_digest':
        return entry.analysis_profile_digest === expected;
      case 'procedure_address':
        return typeof record.normalized_result === 'object' && record.normalized_result !== null && (record.normalized_result as Record<string, unknown>)['procedure_address'] === expected;
      default:
        return false;
    }
  });

export class EvidenceLedger {
  #records = new Map<string, EvidenceRecord>();

  get size(): number {
    return this.#records.size;
  }

  record(record: EvidenceRecord): EvidenceRecord {
    const existing = this.#records.get(record.evidence_id);
    if (existing !== undefined) return existing;
    this.#records.set(record.evidence_id, record);
    return record;
  }

  get(evidenceId: string): EvidenceRecord | undefined {
    return this.#records.get(evidenceId);
  }

  list(): EvidenceRecord[] {
    return [...this.#records.values()];
  }

  merge(bundle: EvidenceBundle): { readonly imported: number; readonly total: number } {
    let imported = 0;
    for (const record of bundle.records) {
      if (this.#records.has(record.evidence_id)) continue;
      this.#records.set(record.evidence_id, record);
      imported += 1;
    }
    return { imported, total: this.#records.size };
  }

  clear(): void {
    this.#records.clear();
  }

  summary(filters: EvidenceFilters = {}): { readonly entries: EvidenceSummaryEntry[]; readonly total: number } {
    const records = this.list();
    const matched = records.filter((record) => matchesFilters(evidenceSummaryEntry(record), record, filters)).map(evidenceSummaryEntry);
    return { entries: matched, total: records.length };
  }

  subjects(): Record<string, unknown>[] {
    const seen = new Map<string, Record<string, unknown>>();
    for (const record of this.list()) {
      const subject = record.subject;
      if (subject === null) continue;
      const key = `${subject.digest.sha256}:${subject.format}:${subject.architecture ?? ''}`;
      seen.set(key, { architecture: subject.architecture, digest: subject.digest, format: subject.format });
    }
    return [...seen.values()];
  }

  providers(): Record<string, unknown>[] {
    const seen = new Map<string, Record<string, unknown>>();
    for (const record of this.list()) {
      seen.set(record.provider.id, { id: record.provider.id, name: record.provider.name, version: record.provider.version });
    }
    return [...seen.values()];
  }
}

export const assertKnownFilters = (filters: unknown): EvidenceFilters => {
  if (filters === undefined) return {};
  if (typeof filters !== 'object' || filters === null || Array.isArray(filters)) {
    throw invalidRequest('filters must be an object when supplied.', { parameter: 'filters' });
  }
  const known = new Set(['evidence_id', 'operation', 'target_sha256', 'analysis_profile_digest', 'procedure_address']);
  const unknown = Object.keys(filters).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw invalidRequest(`Invalid arguments for tool get_evidence_bundle: filters: Unrecognized key: ${unknown.map((key) => JSON.stringify(key)).join(', ')}`, {
      parameter: 'filters',
      unknown_keys: unknown,
    });
  }
  return filters as EvidenceFilters;
};

export type { EvidenceSummaryEntry };
