import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectGpuCodeObjectsFromPath } from '../analysis/gpu-code-objects.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectGpuCodeObjectsParams {
  readonly path: string;
  readonly analysis?: string;
  readonly expected_sha256?: string;
  readonly object_ids?: readonly string[];
  readonly targets?: readonly string[];
  readonly detail?: string;
  readonly view?: Record<string, unknown>;
}

export const inspectGpuCodeObjects = async (session: ReaSession, params: InspectGpuCodeObjectsParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const analysis = params.analysis === 'kernels' || params.analysis === 'inventory' ? params.analysis : undefined;
  const { record: inspection, resolvedPath } = await inspectGpuCodeObjectsFromPath(params.path, {
    ...(analysis === undefined ? {} : { analysis }),
    ...(params.expected_sha256 === undefined ? {} : { expectedSha256: params.expected_sha256 }),
    ...(params.object_ids === undefined ? {} : { objectIds: params.object_ids }),
    ...(params.targets === undefined ? {} : { targets: params.targets }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });

  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: 'file',
      architecture: null,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_gpu_code_objects',
    parameters: {
      path: resolvedPath,
      analysis: inspection.analysis,
      ...(params.expected_sha256 === undefined ? {} : { expected_sha256: params.expected_sha256 }),
      ...(params.object_ids === undefined ? {} : { object_ids: params.object_ids }),
      ...(params.targets === undefined ? {} : { targets: params.targets }),
      ...(params.detail === undefined ? {} : { detail: params.detail }),
      ...(params.view === undefined ? {} : { view: params.view }),
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [{ kind: 'artifact-path', path: resolvedPath }],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
