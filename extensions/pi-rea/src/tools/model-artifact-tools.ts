import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectModelArtifactFromPath, MODEL_HEADER_ENVELOPE_LIMITATION, MODEL_RESULT_LIMITATIONS } from '../analysis/model-artifact.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectModelArtifactParams {
  readonly path: string;
  readonly hash?: string;
  readonly detail?: string;
  readonly view?: Record<string, unknown>;
}

export const inspectModelArtifact = async (session: ReaSession, params: InspectModelArtifactParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const hashMode = params.hash === 'full' ? 'full' : 'header';
  const { record: inspection, path } = await inspectModelArtifactFromPath(params.path, {
    hash: hashMode,
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });

  const envelopeLimitations = hashMode === 'header' ? [MODEL_HEADER_ENVELOPE_LIMITATION, ...MODEL_RESULT_LIMITATIONS] : [...MODEL_RESULT_LIMITATIONS];

  const record = createEvidence({
    subject: null,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_model_artifact',
    parameters: {
      path,
      hash: hashMode,
      ...(params.detail === undefined ? {} : { detail: params.detail }),
      ...(params.view === undefined ? {} : { view: params.view }),
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: envelopeLimitations,
    locations: [
      { kind: 'artifact-path', path },
      { kind: 'file-offset-range', start: 0, end: inspection.artifact.header_length },
    ],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
