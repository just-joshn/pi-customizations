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

const actionProjection = (action: UnknownMutationAction, draft: UnknownDraft, revision: MutationRevision | undefined): { readonly parameters: Record<string, unknown>; readonly normalized_result: Record<string, unknown> } => {
  const parameters = { domain: draft.domain, severity: draft.severity };
  const normalized_result = {
    action,
    question: draft.question,
    required_authority: draft.required_authority,
    required_confidence: draft.required_confidence,
  };
  if (action === 'record') return { parameters, normalized_result };
  if (revision === undefined) throw new Error('an update mutation needs its resulting revision');
  return {
    parameters: { ...parameters, unknown_id: revision.unknown_id, revision: revision.revision, status: revision.status },
    normalized_result,
  };
};

export const unknownMutationEvidence = (action: UnknownMutationAction, draft: UnknownDraft, revision?: MutationRevision): EvidenceRecord => {
  const { parameters, normalized_result } = actionProjection(action, draft, revision);
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
