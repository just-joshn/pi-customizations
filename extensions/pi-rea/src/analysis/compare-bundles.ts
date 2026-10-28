
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { evidenceIntegrityMismatch, invalidRequest } from '../contract/errors.ts';
import { parseBundle, serializeBundle, type EvidenceBundle } from '../session/evidence-ledger.ts';
import { canonicalJson, type EvidenceRecord } from '../session/evidence.ts';

export interface BundleCompareInspection {
  readonly status: 'unchanged' | 'changed' | 'unknown';
  readonly left_bundle_sha256: string;
  readonly right_bundle_sha256: string;
  readonly summary: {
    readonly records_unchanged: number;
    readonly records_added: number;
    readonly records_removed: number;
    readonly records_changed: number;
    readonly unknowns_unchanged: number;
    readonly unknowns_added: number;
    readonly unknowns_removed: number;
    readonly unknowns_advanced: number;
    readonly unknowns_diverged: number;
    readonly unresolved: number;
  };
  readonly changes: readonly {
    readonly kind: 'record-added' | 'record-removed' | 'record-changed' | 'unknown-added' | 'unknown-removed' | 'unknown-changed';
    readonly id: string;
  }[];
  readonly limitations: readonly string[];
}

const assertAbsolute = (path: unknown, label: string): string => {
  if (typeof path !== 'string' || path.length === 0) {
    throw invalidRequest(`${label}: must be an absolute local filesystem path`, {
      operation: 'compare_bundles',
      issues: [{ path: [], reason: 'invalid_value', message: `${label}: must be an absolute local filesystem path` }],
    });
  }
  if (!isAbsolute(path)) {
    throw invalidRequest(`${label}: must be an absolute local filesystem path`, {
      operation: 'compare_bundles',
      issues: [{ path: [], reason: 'invalid_value', message: `${label}: must be an absolute local filesystem path` }],
    });
  }
  return path;
};

const loadBundle = async (path: string): Promise<{ readonly sha256: string; readonly bundle: EvidenceBundle; readonly text: string }> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw evidenceIntegrityMismatch(`Evidence bundle could not be read at ${path}: ${(error as Error).message}`, {
      reason: 'Evidence bundle validation failed',
      path,
    });
  }
  const bundle = parseBundle(text);
  const sha256 = createHash('sha256').update(serializeBundle(bundle)).digest('hex');
  return { sha256, bundle, text };
};

const recordFingerprint = (record: EvidenceRecord): string =>
  canonicalJson({
    evidence_id: record.evidence_id,
    operation: record.operation,
    normalized_result: record.normalized_result,
    limitations: record.limitations,
  });

const unknownId = (entry: Record<string, unknown>): string | null => {
  if (typeof entry['unknown_id'] === 'string') return entry['unknown_id'];
  if (typeof entry['id'] === 'string') return entry['id'];
  return null;
};

export const compareEvidenceBundles = async (
  leftPathInput: unknown,
  rightPathInput: unknown,
  recordPairs: unknown = [],
): Promise<{
  readonly inspection: BundleCompareInspection;
  readonly parameters: { readonly left_bundle_sha256: string; readonly right_bundle_sha256: string; readonly record_pairs: readonly unknown[] };
}> => {
  const leftPath = assertAbsolute(leftPathInput, 'left_bundle_path');
  const rightPath = assertAbsolute(rightPathInput, 'right_bundle_path');
  if (recordPairs !== undefined && recordPairs !== null && !Array.isArray(recordPairs)) {
    throw invalidRequest('record_pairs must be an array when supplied.', { operation: 'compare_bundles', parameter: 'record_pairs' });
  }
  const pairs = Array.isArray(recordPairs) ? recordPairs : [];

  const left = await loadBundle(leftPath);
  const right = await loadBundle(rightPath);

  const leftRecords = new Map(left.bundle.records.map((record) => [record.evidence_id, record]));
  const rightRecords = new Map(right.bundle.records.map((record) => [record.evidence_id, record]));
  const recordIds = [...new Set([...leftRecords.keys(), ...rightRecords.keys()])].sort();

  let records_unchanged = 0;
  let records_added = 0;
  let records_removed = 0;
  let records_changed = 0;
  const changes: BundleCompareInspection['changes'][number][] = [];

  for (const id of recordIds) {
    const leftRecord = leftRecords.get(id);
    const rightRecord = rightRecords.get(id);
    if (leftRecord === undefined && rightRecord !== undefined) {
      records_added += 1;
      changes.push({ kind: 'record-added', id });
      continue;
    }
    if (leftRecord !== undefined && rightRecord === undefined) {
      records_removed += 1;
      changes.push({ kind: 'record-removed', id });
      continue;
    }
    if (leftRecord === undefined || rightRecord === undefined) continue;
    if (recordFingerprint(leftRecord) === recordFingerprint(rightRecord)) {
      records_unchanged += 1;
    } else {
      records_changed += 1;
      changes.push({ kind: 'record-changed', id });
    }
  }

  const leftUnknowns = new Map(
    left.bundle.unknowns
      .map((entry) => [unknownId(entry), entry] as const)
      .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[0] !== null),
  );
  const rightUnknowns = new Map(
    right.bundle.unknowns
      .map((entry) => [unknownId(entry), entry] as const)
      .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[0] !== null),
  );
  const unknownIds = [...new Set([...leftUnknowns.keys(), ...rightUnknowns.keys()])].sort();

  let unknowns_unchanged = 0;
  let unknowns_added = 0;
  let unknowns_removed = 0;
  let unknowns_advanced = 0;
  let unknowns_diverged = 0;

  for (const id of unknownIds) {
    const leftUnknown = leftUnknowns.get(id);
    const rightUnknown = rightUnknowns.get(id);
    if (leftUnknown === undefined && rightUnknown !== undefined) {
      unknowns_added += 1;
      changes.push({ kind: 'unknown-added', id });
      continue;
    }
    if (leftUnknown !== undefined && rightUnknown === undefined) {
      unknowns_removed += 1;
      changes.push({ kind: 'unknown-removed', id });
      continue;
    }
    if (leftUnknown === undefined || rightUnknown === undefined) continue;
    if (canonicalJson(leftUnknown) === canonicalJson(rightUnknown)) {
      unknowns_unchanged += 1;
    } else {
      unknowns_diverged += 1;
      changes.push({ kind: 'unknown-changed', id });
    }
  }

  const status =
    records_added + records_removed + records_changed + unknowns_added + unknowns_removed + unknowns_advanced + unknowns_diverged > 0
      ? 'changed'
      : 'unchanged';

  return {
    parameters: {
      left_bundle_sha256: left.sha256,
      right_bundle_sha256: right.sha256,
      record_pairs: pairs,
    },
    inspection: {
      status,
      left_bundle_sha256: left.sha256,
      right_bundle_sha256: right.sha256,
      summary: {
        records_unchanged,
        records_added,
        records_removed,
        records_changed,
        unknowns_unchanged,
        unknowns_added,
        unknowns_removed,
        unknowns_advanced,
        unknowns_diverged,
        unresolved: 0,
      },
      changes,
      limitations: [],
    },
  };
};
