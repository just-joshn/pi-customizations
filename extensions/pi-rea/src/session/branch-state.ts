import type { ExtensionAPI, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ReaSession } from './binary-session.ts';
import { isEvidenceRecord } from './evidence.ts';
import { isResolution, UNKNOWN_STATUSES, type UnknownDraft, type UnknownResolution, type UnknownStatus, validateUnknownDraft } from './unknown-ledger.ts';

export const EVIDENCE_ENTRY = 'rea-evidence';
export const UNKNOWN_ENTRY = 'rea-unknown';

export type UnknownPersistEntry =
  | { readonly action: 'record'; readonly draft: UnknownDraft; readonly mutation_evidence_id: string }
  | {
      readonly action: 'update';
      readonly unknown_id: string;
      readonly expected_revision: number;
      readonly changes: Partial<UnknownDraft> & { readonly status?: UnknownStatus; readonly resolution?: UnknownResolution | null };
      readonly mutation_evidence_id: string;
    };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isDraft = (value: unknown): value is UnknownDraft => {
  if (!isObject(value) || !Array.isArray(value['supporting_evidence_ids']) || !Array.isArray(value['contradicting_evidence_ids'])) return false;
  try {
    validateUnknownDraft(value);
    return true;
  } catch {
    return false;
  }
};

const changeKeys = new Set([
  'question',
  'severity',
  'domain',
  'required_authority',
  'required_confidence',
  'required_environment',
  'recommended_probes',
  'relationships',
  'supporting_evidence_ids',
  'contradicting_evidence_ids',
  'status',
  'resolution',
]);

const isUnknownPersistEntry = (value: unknown): value is UnknownPersistEntry => {
  if (!isObject(value) || typeof value['mutation_evidence_id'] !== 'string') return false;
  if (value['action'] === 'record') return isDraft(value['draft']);
  if (value['action'] !== 'update' || typeof value['unknown_id'] !== 'string' || !Number.isInteger(value['expected_revision']) || (value['expected_revision'] as number) < 1) return false;
  const changes = value['changes'];
  if (!isObject(changes) || Object.keys(changes).some((key) => !changeKeys.has(key))) return false;
  if ('status' in changes && !UNKNOWN_STATUSES.includes(changes['status'] as UnknownStatus)) return false;
  if ('resolution' in changes && changes['resolution'] !== null && !isResolution(changes['resolution'])) return false;
  return true;
};

export const persistEvidence = (pi: ExtensionAPI, record: { readonly evidence_id: string }): void => {
  pi.appendEntry(EVIDENCE_ENTRY, record);
};

export const persistUnknown = (pi: ExtensionAPI, entry: UnknownPersistEntry): void => {
  pi.appendEntry(UNKNOWN_ENTRY, entry);
};

export const restoreBranchState = (session: ReaSession, entries: readonly SessionEntry[]): void => {
  for (const entry of entries) {
    if (entry.type !== 'custom') continue;
    if (entry.customType === EVIDENCE_ENTRY) {
      if (isEvidenceRecord(entry.data)) session.evidence.record(entry.data);
      continue;
    }
    if (entry.customType !== UNKNOWN_ENTRY) continue;
    const persisted = entry.data;
    if (!isUnknownPersistEntry(persisted)) continue;
    if (persisted.action === 'record') {
      session.unknowns.record(persisted.draft, persisted.mutation_evidence_id);
      continue;
    }
    const existing = session.unknowns.get(persisted.unknown_id);
    if (existing === undefined || existing.revision !== persisted.expected_revision) continue;
    // Recording accepts whitespace-only values and normalizes them to empty strings.
    // Validate changed fields without rejecting those already-accepted normalized values.
    if (!isDraft({ ...existing, question: existing.question || ' ', domain: existing.domain || ' ', ...persisted.changes })) continue;
    session.unknowns.update(persisted.unknown_id, persisted.expected_revision, persisted.changes, persisted.mutation_evidence_id);
  }
};
