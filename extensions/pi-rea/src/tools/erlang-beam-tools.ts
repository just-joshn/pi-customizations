import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { DEFAULT_MAX_ATOMS, DEFAULT_MAX_CHUNKS, DEFAULT_MAX_FILE_BYTES, inspectErlangBeamFromPath } from '../analysis/erlang-beam.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectErlangBeamParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_chunks?: number;
  readonly max_atoms?: number;
  readonly detail?: string;
  readonly view?: Record<string, unknown>;
}

export const inspectErlangBeam = async (
  session: ReaSession,
  params: InspectErlangBeamParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const { record: inspection, path, resolvedPath } = await inspectErlangBeamFromPath(params.path, {
    ...(params.max_file_bytes === undefined ? {} : { maxFileBytes: params.max_file_bytes }),
    ...(params.max_chunks === undefined ? {} : { maxChunks: params.max_chunks }),
    ...(params.max_atoms === undefined ? {} : { maxAtoms: params.max_atoms }),
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
    operation: 'inspect_erlang_beam',
    parameters: {
      path,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_chunks: params.max_chunks ?? DEFAULT_MAX_CHUNKS,
      max_atoms: params.max_atoms ?? DEFAULT_MAX_ATOMS,
      ...(params.detail === undefined ? {} : { detail: params.detail }),
      ...(params.view === undefined ? {} : { view: params.view }),
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [
      { kind: 'artifact-path', path },
      { kind: 'file-offset-range', start: 0, end: inspection.artifact.bytes },
    ],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
