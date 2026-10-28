import type { ExtensionAPI, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ReaSession } from './binary-session.ts';
import { isEvidenceRecord } from './evidence.ts';
import type { UnknownDraft, UnknownStatus } from './unknown-ledger.ts';

export const EVIDENCE_ENTRY = 'rea-evidence';
export const UNKNOWN_ENTRY = 'rea-unknown';

export type UnknownPersistEntry =
  | { readonly action: 'record'; readonly draft: UnknownDraft; readonly mutation_evidence_id: string }
  | {
      readonly action: 'update';
      readonly unknown_id: string;
      readonly expected_revision: number;
      readonly changes: Partial<UnknownDraft> & { readonly status?: UnknownStatus };
      readonly mutation_evidence_id: string;
    };

const isUnknownPersistEntry = (value: unknown): value is UnknownPersistEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['action'] === 'record') return typeof record['draft'] === 'object' && record['draft'] !== null && typeof record['mutation_evidence_id'] === 'string';
  if (record['action'] !== 'update') return false;
  return typeof record['unknown_id'] === 'string' && typeof record['expected_revision'] === 'number' && typeof record['mutation_evidence_id'] === 'string';
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
    if (session.unknowns.get(persisted.unknown_id) === undefined) continue;
    session.unknowns.update(persisted.unknown_id, persisted.expected_revision, persisted.changes, persisted.mutation_evidence_id);
  }
};
