import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_FILE_BYTES,
  inspectKernelModuleFromPath,
  locationsForKernelModule,
  subjectFieldsForKernelModule,
} from '../analysis/kernel-module.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectKernelModuleParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_entries?: number;
}

export const inspectKernelModule = async (
  session: ReaSession,
  params: InspectKernelModuleParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const { record: inspection, path, resolvedPath } = await inspectKernelModuleFromPath(params.path, {
    ...(params.max_file_bytes === undefined ? {} : { maxFileBytes: params.max_file_bytes }),
    ...(params.max_entries === undefined ? {} : { maxEntries: params.max_entries }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });

  const subjectFields = subjectFieldsForKernelModule(inspection);
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: subjectFields.format,
      architecture: subjectFields.architecture,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_kernel_module',
    parameters: {
      path,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_entries: params.max_entries ?? DEFAULT_MAX_ENTRIES,
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: locationsForKernelModule(path, inspection),
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
