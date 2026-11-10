import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { analysisInputInvalid, executionFailure, invalidRequest } from '../contract/errors.ts';
import { operationResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { UNKNOWN_ID_PATTERN } from '../session/evidence.ts';
import { type UnknownDraft, type UnknownResolution, type UnknownSeverity, type UnknownStatus, validateUnknownDraft } from '../session/unknown-ledger.ts';
import { unknownMutationEvidence } from '../session/unknown-mutation-evidence.ts';

export interface ListUnknownsParams {
  readonly domain?: string;
  readonly severity?: UnknownSeverity;
  readonly status?: UnknownStatus;
  readonly offset?: number;
  readonly limit?: number;
}

export const listUnknowns = (session: ReaSession, params: ListUnknownsParams): AgentToolResult<unknown> => {
  const offset = params.offset ?? 0;
  const matching = session.unknowns
    .list()
    .filter((record) => {
      if (params.domain !== undefined && record.domain !== params.domain) return false;
      if (params.severity !== undefined && record.severity !== params.severity) return false;
      if (params.status !== undefined && record.status !== params.status) return false;
      return true;
    })
    .sort((left, right) => (left.unknown_id < right.unknown_id ? -1 : left.unknown_id > right.unknown_id ? 1 : 0));
  const start = Math.min(offset, matching.length);
  const end = params.limit === undefined ? undefined : start + Math.min(params.limit, matching.length - start);
  const items = matching.slice(start, end);
  const nextOffset = offset <= matching.length && start + items.length < matching.length ? start + items.length : null;
  return operationResult({ items, total: matching.length, offset, next_offset: nextOffset });
};

export const recordUnknown = (session: ReaSession, params: unknown): AgentToolResult<unknown> => {
  const draft = withReferenceDefaults(validateUnknownDraft(params));
  assertEvidenceReferencesExist(session, draft);
  const mutationEvidence = unknownMutationEvidence('record', draft);
  operationResult({ mutation: mutationEvidence });
  const mutation = session.evidence.record(mutationEvidence);
  const record = session.unknowns.record(draft, mutation.evidence_id);
  return operationResult(record, { details: { evidence: mutation, unknown: { action: 'record', draft, mutation_evidence_id: mutation.evidence_id } } });
};

const withReferenceDefaults = (draft: UnknownDraft): UnknownDraft => ({
  ...draft,
  supporting_evidence_ids: draft.supporting_evidence_ids ?? [],
  contradicting_evidence_ids: draft.contradicting_evidence_ids ?? [],
});

export interface UpdateUnknownParams extends Omit<Partial<UnknownDraft>, 'supporting_evidence_ids' | 'contradicting_evidence_ids'> {
  readonly supporting_evidence_ids?: readonly unknown[];
  readonly contradicting_evidence_ids?: readonly unknown[];
  readonly unknown_id: string;
  readonly expected_revision: number;
  readonly status: UnknownStatus;
  readonly resolution: UnknownResolution | null;
}

export const updateUnknown = (session: ReaSession, input: UpdateUnknownParams): AgentToolResult<unknown> => {
  const params = input as UpdateUnknownParams & Partial<UnknownDraft>;
  if ((params.status === 'resolved') !== (params.resolution !== null && params.resolution !== undefined)) {
    throw analysisInputInvalid('update_unknown', [{ path: ['resolution'], reason: 'invalid_value', message: 'Only resolved unknowns carry a resolution' }]);
  }
  if (typeof params.unknown_id !== 'string' || typeof params.expected_revision !== 'number') {
    throw invalidRequest('update_unknown requires unknown_id and expected_revision.', {
      parameters: ['unknown_id', 'expected_revision'],
    });
  }
  const changes: Partial<UnknownDraft> & { readonly status: UnknownStatus; readonly resolution: UnknownResolution | null } = {
    status: params.status,
    resolution: params.resolution,
    ...(params.severity === undefined ? {} : { severity: params.severity }),
    ...(params.supporting_evidence_ids === undefined ? {} : { supporting_evidence_ids: params.supporting_evidence_ids }),
    ...(params.contradicting_evidence_ids === undefined ? {} : { contradicting_evidence_ids: params.contradicting_evidence_ids }),
    ...(params.required_authority === undefined ? {} : { required_authority: params.required_authority }),
    ...(params.required_confidence === undefined ? {} : { required_confidence: params.required_confidence }),
    ...(params.required_environment === undefined ? {} : { required_environment: params.required_environment }),
    ...(params.recommended_probes === undefined ? {} : { recommended_probes: params.recommended_probes }),
    ...(params.relationships === undefined ? {} : { relationships: params.relationships }),
  };
  const existing = session.unknowns.assertUpdatable(params.unknown_id, params.expected_revision);
  const draft: UnknownDraft = {
    question: params.question ?? existing.question,
    severity: params.severity ?? existing.severity,
    domain: params.domain ?? existing.domain,
    required_authority: params.required_authority ?? existing.required_authority,
    required_confidence: params.required_confidence ?? existing.required_confidence,
    required_environment: params.required_environment ?? existing.required_environment,
    recommended_probes: params.recommended_probes ?? existing.recommended_probes,
    relationships: params.relationships ?? existing.relationships,
    supporting_evidence_ids: params.supporting_evidence_ids ?? existing.supporting_evidence_ids,
    contradicting_evidence_ids: params.contradicting_evidence_ids ?? existing.contradicting_evidence_ids,
  };
  assertEvidenceReferencesExist(session, draft);
  assertResolution(session, params.resolution);
  const mutationEvidence = unknownMutationEvidence(
    'update',
    draft,
    {
      unknown_id: params.unknown_id,
      revision: existing.revision + 1,
      status: params.status,
    },
    {
      unknown_id: params.unknown_id,
      expected_revision: params.expected_revision,
      status: params.status,
      severity: params.severity ?? existing.severity,
      supporting_evidence_ids: params.supporting_evidence_ids ?? existing.supporting_evidence_ids,
      contradicting_evidence_ids: params.contradicting_evidence_ids ?? existing.contradicting_evidence_ids,
      required_authority: params.required_authority ?? existing.required_authority,
      required_confidence: params.required_confidence ?? existing.required_confidence,
      required_environment: params.required_environment ?? existing.required_environment,
      recommended_probes: params.recommended_probes ?? existing.recommended_probes,
      relationships: params.relationships ?? existing.relationships,
      resolution: params.resolution ?? null,
    },
  );
  operationResult({ mutation: mutationEvidence });
  const mutation = session.evidence.record(mutationEvidence);
  const record = session.unknowns.update(params.unknown_id, params.expected_revision, changes, mutation.evidence_id);
  return operationResult(record, {
    details: {
      evidence: mutation,
      unknown: { action: 'update', unknown_id: params.unknown_id, expected_revision: params.expected_revision, changes, mutation_evidence_id: mutation.evidence_id },
    },
  });
};

const assertResolution = (session: ReaSession, resolution: UnknownResolution | null | undefined): void => {
  if (resolution === null || resolution === undefined) return;
  const missing = resolution.evidence_ids.filter((id) => session.evidence.get(id) === undefined);
  if (missing.length > 0) {
    throw invalidRequest(`Evidence ${missing.join(', ')} is not retained in this session; import or record it before resolving an unknown with it.`, {
      evidence_ids: missing,
      reason: 'missing',
    });
  }
};

const assertEvidenceReferencesExist = (session: ReaSession, draft: UnknownDraft): void => {
  const referenced = [...draft.supporting_evidence_ids, ...draft.contradicting_evidence_ids];
  const missing = referenced.filter((id) => session.evidence.get(id) === undefined);
  if (missing.length > 0) {
    throw invalidRequest(`Evidence ${missing.join(', ')} is not retained in this session; import its bundle or record it before referencing it.`, { evidence_ids: missing, reason: 'missing' });
  }
};

export interface VerifyUnknownResolutionParams {
  readonly unknown_id: string;
}

export const verifyUnknownResolution = (session: ReaSession, params: VerifyUnknownResolutionParams): AgentToolResult<unknown> => {
  if (typeof params.unknown_id !== 'string' || !UNKNOWN_ID_PATTERN.test(params.unknown_id)) {
    throw invalidRequest('Invalid arguments for tool verify_unknown_resolution: unknown_id: Invalid string: must match pattern /^unk_[a-f0-9]{64}$/u', {
      parameter: 'unknown_id',
    });
  }
  const unknown = session.unknowns.get(params.unknown_id);
  if (unknown === undefined) {
    throw executionFailure('The requested residual unknown does not exist in this session. Check the unknown_id and try again.', { reason: 'not-found' }, 'Check that the unknown_id belongs to this session, then retry.');
  }
  return operationResult({
    valid: unknown.status === 'resolved',
    truthVerified: unknown.resolution?.disposition === 'verified',
    unknown,
  });
};
