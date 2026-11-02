import { createEvidence, type EvidenceRecord } from './evidence.ts';
import type { UnknownDraft } from './unknown-ledger.ts';

export const UNKNOWN_REGISTRY_PROVIDER = {
  id: 'rea-unknown-registry',
  name: 'REA residual unknown registry',
  version: '1',
} as const;

export const UNKNOWN_MUTATION_LIMITATIONS = ['Artifact identity is unavailable for this observation.', 'Registry mutation evidence records analyst intent, not proof of the answer.'] as const;

export type UnknownMutationAction = 'record' | 'update';

interface MutationRevision {
  readonly unknown_id: string;
  readonly revision: number;
  readonly status: string;
}

const actionProjection = (
  action: UnknownMutationAction,
  draft: UnknownDraft,
  revision: MutationRevision | undefined,
  updateInput?: Record<string, unknown>,
): { readonly parameters: Record<string, unknown>; readonly normalized_result: Record<string, unknown> } => {
  const normalized_result = {
    action,
    question: draft.question,
    required_authority: draft.required_authority,
    required_confidence: draft.required_confidence,
  };
  if (action === 'record') {
    const parameters: Record<string, unknown> = {
      question: draft.question,
      severity: draft.severity,
      domain: draft.domain,
      required_authority: draft.required_authority,
      required_confidence: draft.required_confidence,
      required_environment: draft.required_environment,
      recommended_probes: draft.recommended_probes,
      relationships: draft.relationships,
      supporting_evidence_ids: draft.supporting_evidence_ids,
      contradicting_evidence_ids: draft.contradicting_evidence_ids,
    };
    return { parameters, normalized_result };
  }
  if (revision === undefined) throw new Error('an update mutation needs its resulting revision');
  if (updateInput === undefined) throw new Error('an update mutation needs its update input');
  return { parameters: updateInput, normalized_result: { action: 'update', status: revision.status } };
};

export const unknownMutationEvidence = (action: UnknownMutationAction, draft: UnknownDraft, revision?: MutationRevision, updateInput?: Record<string, unknown>): EvidenceRecord => {
  const { parameters, normalized_result } = actionProjection(action, draft, revision, updateInput);
  return createEvidence({
    subject: null,
    provider: UNKNOWN_REGISTRY_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.residual-unknown-mutation',
    operation: `${action}_unknown`,
    parameters,
    raw_result: null,
    normalized_result,
    confidence: 'derived',
    authority: 'analyst-inference',
    environment: null,
    limitations: [...UNKNOWN_MUTATION_LIMITATIONS],
    locations: [],
    evidence_links: [],
  });
};
