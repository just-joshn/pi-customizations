import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectRustBinaryFromPath } from '../analysis/rust-binary.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectRustBinaryParams {
  readonly path: string;
  readonly architecture?: string;
  readonly detail?: string;
  readonly view?: Record<string, unknown>;
}

export const inspectRustBinary = async (
  session: ReaSession,
  params: InspectRustBinaryParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const { record: inspection, path, resolvedPath } = await inspectRustBinaryFromPath(params.path, {
    ...(params.architecture === undefined ? {} : { architecture: params.architecture }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });

  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: inspection.format,
      architecture: inspection.architecture,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_rust_binary',
    parameters: {
      path,
      ...(params.architecture === undefined ? {} : { architecture: params.architecture }),
      ...(params.detail === undefined ? {} : { detail: params.detail }),
      ...(params.view === undefined ? {} : { view: params.view }),
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
