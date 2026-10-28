import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectApkSignatureFromPath } from '../analysis/apk-signature.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectApkSignatureParams {
  readonly path: string;
  readonly detail?: string;
  readonly view?: Record<string, unknown>;
}

export const inspectApkSignature = async (
  session: ReaSession,
  params: InspectApkSignatureParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const { record: inspection, path, resolvedPath } = await inspectApkSignatureFromPath(params.path, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });
  const { limitations, ...normalized } = inspection;
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: 'apk',
      architecture: null,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_apk_signature',
    parameters: {
      path,
      ...(params.detail === undefined ? {} : { detail: params.detail }),
      ...(params.view === undefined ? {} : { view: params.view }),
    },
    raw_result: null,
    normalized_result: normalized,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...limitations],
    locations: [{ kind: 'artifact-path', path }],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
