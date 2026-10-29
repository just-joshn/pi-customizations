import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectIl2CppMetadataFromPath } from '../analysis/il2cpp-metadata.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectIl2CppMetadataParams {
  readonly path: string;
  readonly detail?: string;
  readonly binary_path?: string;
  readonly binary_architecture?: string;
  readonly generic_instances?: boolean;
}

export const inspectIl2CppMetadata = async (session: ReaSession, params: InspectIl2CppMetadataParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    path,
    resolvedPath,
  } = await inspectIl2CppMetadataFromPath(params.path, {
    ...(params.binary_path === undefined ? {} : { binaryPath: params.binary_path }),
    ...(params.binary_architecture === undefined ? {} : { binaryArchitecture: params.binary_architecture }),
    ...(params.generic_instances === undefined ? {} : { genericInstances: params.generic_instances }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });

  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: 'il2cpp-metadata',
      architecture: null,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_il2cpp_metadata',
    parameters: {
      path,
      ...(params.detail === undefined ? {} : { detail: params.detail }),
      ...(params.binary_path === undefined ? {} : { binary_path: params.binary_path }),
      ...(params.binary_architecture === undefined ? {} : { binary_architecture: params.binary_architecture }),
      ...(params.generic_instances === undefined ? {} : { generic_instances: params.generic_instances }),
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [{ kind: 'artifact-path', path }],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
