
import { invalidRequest } from '../contract/errors.ts';
import type { EvidenceRecord } from '../session/evidence.ts';

export interface ArtifactCompareChange {
  readonly logical_path: string;
  readonly kind: 'added' | 'removed' | 'changed' | 'unchanged' | 'unknown' | 'contradiction';
  readonly left_sha256: string | null;
  readonly right_sha256: string | null;
}

export interface ArtifactCompareInspection {
  readonly status: 'unchanged' | 'changed' | 'unknown';
  readonly left_manifest_id: string | null;
  readonly right_manifest_id: string | null;
  readonly summary: {
    readonly unchanged: number;
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly unknown: number;
    readonly contradiction: number;
  };
  readonly changes: readonly ArtifactCompareChange[];
  readonly integrity_mismatch_evidence_ids: readonly string[];
  readonly limitations: readonly string[];
}

interface OccurrenceRow {
  readonly logical_path: string;
  readonly sha256: string | null;
  readonly is_directory: boolean;
}

interface InventoryView {
  readonly evidenceId: string;
  readonly manifestId: string | null;
  readonly occurrences: readonly OccurrenceRow[];
  readonly limitations: readonly string[];
  readonly truncated: boolean;
}

const asRecord = (value: unknown, label: string): EvidenceRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest(`compare_artifacts ${label} must be an Evidence object.`, {
      operation: 'compare_artifacts',
      parameter: label,
    });
  }
  const record = value as EvidenceRecord;
  if (typeof record.evidence_id !== 'string' || !record.evidence_id.startsWith('ev_')) {
    throw invalidRequest(`compare_artifacts ${label} must carry an evidence_id.`, {
      operation: 'compare_artifacts',
      parameter: label,
    });
  }
  return record;
};

const inventoryFromEvidence = (record: EvidenceRecord, label: string): InventoryView => {
  if (record.operation !== 'inspect_artifact' && record.operation !== 'inventory_artifact') {
    throw invalidRequest(`compare_artifacts ${label} must be inspect_artifact Evidence.`, {
      operation: 'compare_artifacts',
      parameter: label,
      observed_operation: record.operation,
    });
  }
  const nr = record.normalized_result as Record<string, unknown> | null;
  if (nr === null || typeof nr !== 'object') {
    throw invalidRequest(`compare_artifacts ${label} has no normalized_result inventory.`, {
      operation: 'compare_artifacts',
      parameter: label,
    });
  }

  const collections = nr['collections'] as { occurrences?: readonly Record<string, unknown>[] } | undefined;
  if (collections?.occurrences) {
    const rootSha = typeof nr['root_artifact_sha256'] === 'string' ? nr['root_artifact_sha256'] : null;
    const occurrences = collections.occurrences.map((entry) => ({
      logical_path: String(entry['logical_path'] ?? ''),
      sha256: typeof entry['calculated_sha256'] === 'string' ? entry['calculated_sha256'] : null,
      is_directory: entry['is_directory'] === true,
    }));
    const coverage = nr['coverage'] as { truncated?: boolean } | undefined;
    const limitations = Array.isArray(nr['limitations']) ? (nr['limitations'] as string[]) : [];
    return {
      evidenceId: record.evidence_id,
      manifestId: rootSha === null ? null : `agm_${rootSha}`,
      occurrences,
      limitations,
      truncated: coverage?.truncated === true,
    };
  }

  const subject = nr['subject'] as { manifest_id?: string; root_sha256?: string } | undefined;
  const substeps = nr['substeps'] as readonly { evidence?: EvidenceRecord; operation?: string }[] | undefined;
  const nested = substeps?.find((step) => step.operation === 'inventory_artifact')?.evidence;
  const nestedNr = (nested?.normalized_result ?? nr) as Record<string, unknown>;
  const occurrencesRaw = (nestedNr['occurrences'] as readonly Record<string, unknown>[] | undefined) ?? [];
  const nodes = (nestedNr['nodes'] as readonly Record<string, unknown>[] | undefined) ?? [];
  const shaByArtifact = new Map(
    nodes
      .filter((node) => typeof node['artifact_id'] === 'string' && typeof node['sha256'] === 'string')
      .map((node) => [String(node['artifact_id']), String(node['sha256'])]),
  );
  const manifest = (nestedNr['manifest'] as { manifest_id?: string } | undefined) ?? subject;
  const limitations = Array.isArray(nestedNr['limitations'])
    ? (nestedNr['limitations'] as string[])
    : Array.isArray(nr['limitations'])
      ? (nr['limitations'] as string[])
      : [];
  const coverage = nestedNr['coverage'] as { status?: string } | undefined;
  return {
    evidenceId: record.evidence_id,
    manifestId: typeof manifest?.manifest_id === 'string' ? manifest.manifest_id : null,
    occurrences: occurrencesRaw
      .filter((entry) => entry['logical_path'] !== '.')
      .map((entry) => ({
        logical_path: String(entry['logical_path'] ?? ''),
        sha256:
          typeof entry['sha256'] === 'string'
            ? entry['sha256']
            : typeof entry['calculated_sha256'] === 'string'
              ? entry['calculated_sha256']
              : typeof entry['artifact_id'] === 'string'
                ? (shaByArtifact.get(String(entry['artifact_id'])) ?? null)
                : null,
        is_directory: entry['entry_kind'] === 'directory' || entry['is_directory'] === true,
      })),
    limitations,
    truncated: coverage?.status === 'partial',
  };
};

const prefixLimitations = (side: 'Left' | 'Right', lines: readonly string[]): string[] =>
  lines.map((line) => `${side}: ${line}`);

export const compareArtifactInventories = (leftInput: unknown, rightInput: unknown): ArtifactCompareInspection => {
  const leftRecord = asRecord(leftInput, 'left');
  const rightRecord = asRecord(rightInput, 'right');
  const left = inventoryFromEvidence(leftRecord, 'left');
  const right = inventoryFromEvidence(rightRecord, 'right');

  const leftMap = new Map(left.occurrences.filter((row) => !row.is_directory).map((row) => [row.logical_path, row]));
  const rightMap = new Map(right.occurrences.filter((row) => !row.is_directory).map((row) => [row.logical_path, row]));
  const paths = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();

  const changes: ArtifactCompareChange[] = [];
  let unchanged = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unknown = 0;
  let contradiction = 0;

  for (const logical_path of paths) {
    const leftRow = leftMap.get(logical_path);
    const rightRow = rightMap.get(logical_path);
    if (leftRow === undefined && rightRow !== undefined) {
      added += 1;
      changes.push({ logical_path, kind: 'added', left_sha256: null, right_sha256: rightRow.sha256 });
      continue;
    }
    if (leftRow !== undefined && rightRow === undefined) {
      removed += 1;
      changes.push({ logical_path, kind: 'removed', left_sha256: leftRow.sha256, right_sha256: null });
      continue;
    }
    if (leftRow === undefined || rightRow === undefined) continue;
    if (leftRow.sha256 === null || rightRow.sha256 === null) {
      unknown += 1;
      changes.push({ logical_path, kind: 'unknown', left_sha256: leftRow.sha256, right_sha256: rightRow.sha256 });
      continue;
    }
    if (leftRow.sha256 === rightRow.sha256) {
      unchanged += 1;
      continue;
    }
    changed += 1;
    changes.push({ logical_path, kind: 'changed', left_sha256: leftRow.sha256, right_sha256: rightRow.sha256 });
  }

  if (left.truncated || right.truncated) {
    unknown += 1;
  }

  if (left.manifestId !== null && right.manifestId !== null) {
    if (left.manifestId === right.manifestId) unchanged += 1;
    else changed += 1;
  }

  const status = added + removed + changed + contradiction > 0 ? 'changed' : unknown > 0 ? 'unknown' : 'unchanged';

  return {
    status,
    left_manifest_id: left.manifestId,
    right_manifest_id: right.manifestId,
    summary: { unchanged, added, removed, changed, unknown, contradiction },
    changes,
    integrity_mismatch_evidence_ids: [],
    limitations: [...prefixLimitations('Left', left.limitations), ...prefixLimitations('Right', right.limitations)],
  };
};
