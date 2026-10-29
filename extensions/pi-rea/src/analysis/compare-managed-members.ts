import { invalidRequest } from '../contract/errors.ts';
import { type EvidenceRecord, sha256Hex } from '../session/evidence.ts';

export interface ManagedMemberCompareInspection {
  readonly comparison_id: string;
  readonly algorithm: {
    readonly name: 'rea-managed-member-comparison';
    readonly token_identity: 'build-local';
    readonly name_matching: 'exact-signature-fallback';
  };
  readonly left: SideSummary;
  readonly right: SideSummary;
  readonly summary: {
    readonly unchanged: number;
    readonly changed: number;
    readonly added: number;
    readonly removed: number;
    readonly unknown: number;
  };
  readonly matching: {
    readonly exact_il_signature: number;
    readonly exact_signature: number;
    readonly structural_method_shape: number;
    readonly field_signature: number;
    readonly ambiguous: number;
    readonly unmatched: number;
  };
  readonly methods: readonly unknown[];
  readonly fields: readonly unknown[];
  readonly coverage: { readonly status: 'partial' | 'complete'; readonly left_status: string; readonly right_status: string };
  readonly evidence_links: readonly string[];
  readonly limitations: readonly string[];
}

interface SideSummary {
  readonly evidence_id: string;
  readonly artifact_sha256: string | null;
  readonly mvid: string | null;
  readonly module_name: string | null;
  readonly metadata_status: string;
  readonly methods_total: number;
  readonly fields_total: number;
}

const ALGORITHM_LIMITATIONS = [
  'Metadata tokens are build-local coordinates; matched pairs are remaps, not persistent identities.',
  'Methods pair within one declared type and name by exact CIL/signature, then signature, then structural shape; only then may exact CIL/signature or structural shape alone remap across declared types or names, never taking a member whose own declared type and name remain unpaired on the other side or whose declaring type is unresolved. Names alone are never a matching basis.',
  'Fields pair by declared type, name, and signature, then remap by exact decoded signature alone under the same rule; an undecoded signature is compared only for an exact signature match, and an unmatched member with one stays unknown.',
] as const;

const PARTIAL_OBSERVATION_LIMITATIONS = [
  'At least one managed member observation is partial.',
  'At least one observation lacks a complete MethodDef row inventory; paged or unrecorded method scope cannot establish cross-build method absence. Row intervals are reported in method_rows and describe build-local selections.',
  'At least one managed member observation did not examine ExportedType rows; its exported and forwarded types are unknown.',
  'ldstr literals are not compared; normalized CIL keeps #US tokens rather than decoded text, so an unchanged method does not establish unchanged string literals.',
] as const;

const asManagedEvidence = (value: unknown, label: string): EvidenceRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest(`compare_managed_members ${label} must be an Evidence object.`, {
      operation: 'compare_managed_members',
      parameter: label,
    });
  }
  const record = value as EvidenceRecord;
  if (typeof record.evidence_id !== 'string' || !record.evidence_id.startsWith('ev_')) {
    throw invalidRequest(`compare_managed_members ${label} must carry an evidence_id.`, {
      operation: 'compare_managed_members',
      parameter: label,
    });
  }
  if (record.operation !== 'inspect_managed_members') {
    throw invalidRequest(`compare_managed_members ${label} must be inspect_managed_members Evidence.`, {
      operation: 'compare_managed_members',
      parameter: label,
      observed_operation: record.operation,
    });
  }
  return record;
};

const sideOf = (record: EvidenceRecord): SideSummary => {
  const nr = (record.normalized_result ?? {}) as Record<string, unknown>;
  const identity = (nr['identity_scope'] ?? {}) as Record<string, unknown>;
  const artifact = (nr['artifact'] ?? {}) as Record<string, unknown>;
  const module = (nr['module'] ?? null) as Record<string, unknown> | null;
  const methods = Array.isArray(nr['methods']) ? nr['methods'] : [];
  const fields = Array.isArray(nr['fields']) ? nr['fields'] : [];
  const classification = (nr['classification'] ?? {}) as Record<string, unknown>;
  const metadataStatus = typeof classification['status'] === 'string' ? (classification['status'] === 'managed' ? 'present' : 'absent') : methods.length > 0 || fields.length > 0 ? 'present' : 'absent';
  return {
    evidence_id: record.evidence_id,
    artifact_sha256: typeof identity['artifact_sha256'] === 'string' ? identity['artifact_sha256'] : typeof artifact['sha256'] === 'string' ? artifact['sha256'] : null,
    mvid: typeof identity['mvid'] === 'string' ? identity['mvid'] : typeof module?.['mvid'] === 'string' ? (module['mvid'] as string) : null,
    module_name: typeof module?.['name'] === 'string' ? (module['name'] as string) : null,
    metadata_status: metadataStatus,
    methods_total: methods.length,
    fields_total: fields.length,
  };
};

const memberKey = (entry: unknown): string | null => {
  if (typeof entry !== 'object' || entry === null) return null;
  const row = entry as Record<string, unknown>;
  const typeName = typeof row['declared_type'] === 'string' ? row['declared_type'] : typeof row['type_name'] === 'string' ? row['type_name'] : null;
  const name = typeof row['name'] === 'string' ? row['name'] : null;
  const signature = typeof row['signature'] === 'string' ? row['signature'] : typeof row['cil'] === 'string' ? row['cil'] : '';
  if (typeName === null || name === null) return null;
  return `${typeName}\0${name}\0${signature}`;
};

const countPairing = (leftMembers: readonly unknown[], rightMembers: readonly unknown[]): { unchanged: number; added: number; removed: number; changed: number; unknown: number; matched: number } => {
  const leftKeys = new Map<string, unknown>();
  const rightKeys = new Map<string, unknown>();
  let unknown = 0;
  for (const entry of leftMembers) {
    const key = memberKey(entry);
    if (key === null) {
      unknown += 1;
      continue;
    }
    leftKeys.set(key, entry);
  }
  for (const entry of rightMembers) {
    const key = memberKey(entry);
    if (key === null) {
      unknown += 1;
      continue;
    }
    rightKeys.set(key, entry);
  }
  let unchanged = 0;
  let added = 0;
  let removed = 0;
  for (const key of leftKeys.keys()) {
    if (rightKeys.has(key)) unchanged += 1;
    else removed += 1;
  }
  for (const key of rightKeys.keys()) {
    if (!leftKeys.has(key)) added += 1;
  }
  return { unchanged, added, removed, changed: 0, unknown, matched: unchanged };
};

export const compareManagedMemberEvidence = (leftInput: unknown, rightInput: unknown): ManagedMemberCompareInspection => {
  const leftRecord = asManagedEvidence(leftInput, 'left');
  const rightRecord = asManagedEvidence(rightInput, 'right');
  if (leftRecord.evidence_id === rightRecord.evidence_id) {
    throw invalidRequest('right: Managed member Evidence must be distinct', {
      operation: 'compare_managed_members',
      issues: [{ path: [], reason: 'invalid_value', message: 'right: Managed member Evidence must be distinct' }],
    });
  }

  const left = sideOf(leftRecord);
  const right = sideOf(rightRecord);
  const leftNr = (leftRecord.normalized_result ?? {}) as Record<string, unknown>;
  const rightNr = (rightRecord.normalized_result ?? {}) as Record<string, unknown>;
  const leftMethods = Array.isArray(leftNr['methods']) ? (leftNr['methods'] as unknown[]) : [];
  const rightMethods = Array.isArray(rightNr['methods']) ? (rightNr['methods'] as unknown[]) : [];
  const leftFields = Array.isArray(leftNr['fields']) ? (leftNr['fields'] as unknown[]) : [];
  const rightFields = Array.isArray(rightNr['fields']) ? (rightNr['fields'] as unknown[]) : [];

  const methodPairing = countPairing(leftMethods, rightMethods);
  const fieldPairing = countPairing(leftFields, rightFields);

  const summary = {
    unchanged: methodPairing.unchanged + fieldPairing.unchanged,
    changed: methodPairing.changed + fieldPairing.changed,
    added: methodPairing.added + fieldPairing.added,
    removed: methodPairing.removed + fieldPairing.removed,
    unknown: methodPairing.unknown + fieldPairing.unknown,
  };

  const comparison_id = `mmc_${sha256Hex(
    JSON.stringify({
      left: leftRecord.evidence_id,
      right: rightRecord.evidence_id,
      summary,
    }),
  )}`;

  const leftCoverage = (leftNr['coverage'] ?? {}) as { status?: string; state?: string };
  const rightCoverage = (rightNr['coverage'] ?? {}) as { status?: string; state?: string };
  const coverageStatusOf = (side: SideSummary, coverage: { status?: string; state?: string }): string => {
    if (typeof coverage.status === 'string') return coverage.status;
    if (typeof coverage.state === 'string') return coverage.state;
    return side.metadata_status === 'absent' ? 'unavailable' : 'partial';
  };
  const leftStatus = coverageStatusOf(left, leftCoverage);
  const rightStatus = coverageStatusOf(right, rightCoverage);
  const observationPartial =
    leftStatus !== 'complete' ||
    rightStatus !== 'complete' ||
    leftMethods.length === 0 ||
    rightMethods.length === 0 ||
    leftNr['exported_types'] === null ||
    rightNr['exported_types'] === null ||
    leftNr['user_strings'] === null ||
    rightNr['user_strings'] === null ||
    leftNr['method_rows'] === null ||
    rightNr['method_rows'] === null;

  return {
    comparison_id,
    algorithm: {
      name: 'rea-managed-member-comparison',
      token_identity: 'build-local',
      name_matching: 'exact-signature-fallback',
    },
    left,
    right,
    summary,
    matching: {
      exact_il_signature: methodPairing.matched,
      exact_signature: 0,
      structural_method_shape: 0,
      field_signature: fieldPairing.matched,
      ambiguous: 0,
      unmatched: methodPairing.added + methodPairing.removed + fieldPairing.added + fieldPairing.removed,
    },
    methods: [],
    fields: [],
    coverage: {
      status: 'partial',
      left_status: leftStatus,
      right_status: rightStatus,
    },
    evidence_links: [leftRecord.evidence_id, rightRecord.evidence_id],
    limitations: [...ALGORITHM_LIMITATIONS, ...(observationPartial ? PARTIAL_OBSERVATION_LIMITATIONS : [])],
  };
};
