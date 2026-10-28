import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_NOTES,
  DEFAULT_MAX_SEGMENTS,
  inspectRecordedCrashFromPath,
} from '../analysis/recorded-crash.ts';
import {
  capabilityUnavailable,
  PWNTTOOLS_LINUX_X64_ONLY,
  pwntoolsHostSupported,
} from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectRecordedCrashParams {
  readonly path: string;
  readonly include_debugger_context?: boolean;
  readonly pwntools_timeout_ms?: number;
}

export const inspectRecordedCrash = async (
  session: ReaSession,
  params: InspectRecordedCrashParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  void params.pwntools_timeout_ms;
  if (!pwntoolsHostSupported()) {
    throw capabilityUnavailable(PWNTTOOLS_LINUX_X64_ONLY, {
      provider_id: 'pwntools-elf',
      operation: 'inspect_recorded_crash',
      reason: PWNTTOOLS_LINUX_X64_ONLY,
    });
  }
  const { record: inspection, path, resolvedPath } = await inspectRecordedCrashFromPath(params.path, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
    ...(params.include_debugger_context === undefined ? {} : { includeDebuggerContext: params.include_debugger_context }),
  });

  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: 'elf-core',
      architecture: inspection.machine_name === 'unknown' ? null : inspection.machine_name,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_recorded_crash',
    parameters: {
      path,
      include_debugger_context: params.include_debugger_context ?? false,
      ...(params.pwntools_timeout_ms === undefined ? {} : { pwntools_timeout_ms: params.pwntools_timeout_ms }),
      max_file_bytes: DEFAULT_MAX_FILE_BYTES,
      max_segments: DEFAULT_MAX_SEGMENTS,
      max_notes: DEFAULT_MAX_NOTES,
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
