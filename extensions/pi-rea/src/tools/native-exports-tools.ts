import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectNativeExportsFromPath } from '../analysis/native-exports.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectNativeExportsParams {
  readonly path: string;
  readonly max_file_bytes?: number;
}

export const inspectNativeExports = async (
  session: ReaSession,
  params: InspectNativeExportsParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const { record: inspection, path, resolvedPath } = await inspectNativeExportsFromPath(params.path, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
    ...(params.max_file_bytes === undefined ? {} : { max_file_bytes: params.max_file_bytes }),
  });
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: inspection.format,
      architecture: null,
      local_path: resolvedPath,
    },
    provider: { id: 'rea-native-exports', name: 'REA PE/ELF export table reader', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_native_exports',
    parameters: {
      path: resolvedPath,
      max_file_bytes: params.max_file_bytes ?? 268_435_456,
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
