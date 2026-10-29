import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { projectAppleApplicationGraph } from '../analysis/project-apple-application-graph.ts';
import { invalidRequest } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence, isEvidenceRecord } from '../session/evidence.ts';

const resolveInventoryEntry = (session: ReaSession, value: unknown, index: number): unknown => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record['evidence_id'] === 'string' && record['normalized_result'] === undefined) {
      const retained = session.evidence.get(record['evidence_id'] as string);
      if (retained === undefined) {
        throw invalidRequest(`project_apple_application_graph inventory_evidence[${index}] evidence_id is not retained.`, {
          parameter: 'inventory_evidence',
          evidence_id: record['evidence_id'],
        });
      }
      return retained;
    }
    if (isEvidenceRecord(value)) return value;
    if (typeof record['evidence_id'] === 'string') return value;
  }
  throw invalidRequest(`project_apple_application_graph inventory_evidence[${index}] must be Evidence.`, {
    parameter: 'inventory_evidence',
  });
};

export interface ProjectAppleApplicationGraphParams {
  readonly inventory_evidence: readonly unknown[];
}

export const projectAppleApplicationGraphTool = (session: ReaSession, params: ProjectAppleApplicationGraphParams): AgentToolResult<unknown> => {
  if (!Array.isArray(params.inventory_evidence)) {
    throw invalidRequest('project_apple_application_graph requires inventory_evidence array.', {
      parameter: 'inventory_evidence',
    });
  }
  const inventory = params.inventory_evidence.map((entry, index) => resolveInventoryEntry(session, entry, index));
  const inspection = projectAppleApplicationGraph({ inventory_evidence: inventory });
  const primary = inventory.find((entry) => typeof entry === 'object' && entry !== null && 'subject' in (entry as object)) as
    | { subject?: { name?: string; digest?: { sha256?: string }; local_path?: string | null; format?: string | null; architecture?: string | null } | null }
    | undefined;
  const subjectSource = primary?.subject ?? null;
  const record = createEvidence({
    subject:
      subjectSource === null || subjectSource === undefined
        ? null
        : {
            name: subjectSource.name ?? 'inventory',
            digest: { sha256: subjectSource.digest?.sha256 ?? inspection.root_sha256 },
            local_path: subjectSource.local_path ?? null,
            format: subjectSource.format ?? inspection.root_format,
            architecture: subjectSource.architecture ?? null,
          },
    provider: { id: 'pi-rea-apple-workflows', name: 'pi-rea Apple workflows', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.apple-application-graph',
    operation: 'project_apple_application_graph',
    parameters: { inventory_evidence_ids: inspection.source_evidence_ids },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'inferred',
    authority: 'analyst-inference',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [],
    evidence_links: [...inspection.source_evidence_ids],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
