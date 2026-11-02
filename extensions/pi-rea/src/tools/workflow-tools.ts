import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';

export const WORKFLOW_PROVIDER = {
  id: 'rea-workflow',
  name: 'REA composed investigation workflow',
  version: '1',
} as const;

const TARGET_UNAVAILABLE_ERROR = {
  code: 'target_unavailable',
  category: 'unavailable',
  message: 'No app is open. Ask the user which app to investigate, then call open_binary with its local path.',
  retryable: false,
  remediation: {
    action: 'No app is open. Ask the user which app to investigate, then call open_binary with its local path.',
  },
} as const;

export interface BatchDecompileParams {
  readonly addresses?: readonly string[];
}

export const batchDecompile = async (session: ReaSession, params: BatchDecompileParams = {}): Promise<AgentToolResult<unknown>> => {
  const addresses = params.addresses ?? [];
  const items = addresses.map((address) => ({
    address,
    procedure: {
      status: 'unknown',
      error: TARGET_UNAVAILABLE_ERROR,
    },
    status: 'error',
    error: TARGET_UNAVAILABLE_ERROR,
  }));
  const record = createEvidence({
    subject: session.target?.identity
      ? {
          name: session.target.identity.path.split('/').pop() ?? session.target.identity.path,
          digest: { sha256: session.target.identity.sha256 },
          format: session.target.identity.format,
          architecture: session.target.identity.architecture,
          local_path: session.target.identity.path,
        }
      : null,
    provider: WORKFLOW_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'batch_decompile',
    parameters: { addresses },
    raw_result: null,
    normalized_result: {
      items,
      total: items.length,
      succeeded: 0,
      failed: items.length,
    },
    confidence: 'derived',
    authority: 'shipped-artifact',
    environment: null,
    limitations: ['Artifact identity is unavailable for this observation.', 'Derived by an REA composed workflow.'],
    locations: [],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
