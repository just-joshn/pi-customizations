import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { DEFAULT_BLOCK_SIZE, inspectByteEntropyFromPath } from '../analysis/byte-entropy.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectByteEntropyParams {
  readonly path: string;
  readonly block_size?: number;
  readonly offset?: number;
  readonly length?: number;
  readonly detail?: 'complete' | 'summary';
}

export const inspectByteEntropy = async (
  session: ReaSession,
  params: InspectByteEntropyParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const { record: inspection, path, resolvedPath } = await inspectByteEntropyFromPath(params.path, {
    ...(params.block_size === undefined ? {} : { blockSize: params.block_size }),
    ...(params.offset === undefined ? {} : { offset: params.offset }),
    ...(params.length === undefined ? {} : { length: params.length }),
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
    operation: 'inspect_byte_entropy',
    parameters: {
      path,
      block_size: params.block_size ?? DEFAULT_BLOCK_SIZE,
      offset: params.offset ?? 0,
      ...(params.length === undefined ? {} : { length: params.length }),
      ...(params.detail === undefined ? {} : { detail: params.detail }),
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
