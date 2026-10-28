import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_FRAMES, DEFAULT_MAX_IMAGES, DEFAULT_MAX_INTEGER_TEXT_BYTES, DEFAULT_MAX_REGISTERS, DEFAULT_MAX_THREADS, inspectAppleIpsFromPath } from '../analysis/apple-ips.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectAppleIpsParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_threads?: number;
  readonly max_frames?: number;
  readonly max_images?: number;
  readonly max_registers?: number;
  readonly max_integer_text_bytes?: number;
}

export const inspectAppleIps = async (session: ReaSession, params: InspectAppleIpsParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    path,
    resolvedPath,
  } = await inspectAppleIpsFromPath(params.path, {
    ...(params.max_file_bytes === undefined ? {} : { maxFileBytes: params.max_file_bytes }),
    ...(params.max_threads === undefined ? {} : { maxThreads: params.max_threads }),
    ...(params.max_frames === undefined ? {} : { maxFrames: params.max_frames }),
    ...(params.max_images === undefined ? {} : { maxImages: params.max_images }),
    ...(params.max_registers === undefined ? {} : { maxRegisters: params.max_registers }),
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
    operation: 'inspect_apple_ips',
    parameters: {
      path,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_threads: params.max_threads ?? DEFAULT_MAX_THREADS,
      max_frames: params.max_frames ?? DEFAULT_MAX_FRAMES,
      max_images: params.max_images ?? DEFAULT_MAX_IMAGES,
      max_registers: params.max_registers ?? DEFAULT_MAX_REGISTERS,
      max_integer_text_bytes: params.max_integer_text_bytes ?? DEFAULT_MAX_INTEGER_TEXT_BYTES,
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
