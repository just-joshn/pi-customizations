import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_OBJECTS,
  DEFAULT_MAX_STRING_BYTES,
  inspectPythonPycFromPath,
} from '../analysis/python-pyc.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectPythonPycParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_objects?: number;
  readonly max_depth?: number;
  readonly max_string_bytes?: number;
  readonly detail?: 'complete' | 'summary';
  readonly view?: Record<string, unknown>;
}

export const inspectPythonPyc = async (
  session: ReaSession,
  params: InspectPythonPycParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const { record: inspection, resolvedPath } = await inspectPythonPycFromPath(params.path, {
    ...(params.max_file_bytes === undefined ? {} : { maxFileBytes: params.max_file_bytes }),
    ...(params.max_objects === undefined ? {} : { maxObjects: params.max_objects }),
    ...(params.max_depth === undefined ? {} : { maxDepth: params.max_depth }),
    ...(params.max_string_bytes === undefined ? {} : { maxStringBytes: params.max_string_bytes }),
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
    operation: 'inspect_python_pyc',
    parameters: {
      path: resolvedPath,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_objects: params.max_objects ?? DEFAULT_MAX_OBJECTS,
      max_depth: params.max_depth ?? DEFAULT_MAX_DEPTH,
      max_string_bytes: params.max_string_bytes ?? DEFAULT_MAX_STRING_BYTES,
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
      { kind: 'artifact-path', path: resolvedPath },
      { kind: 'file-offset-range', start: 0, end: 16 },
      { kind: 'file-offset-range', start: 16, end: inspection.artifact.bytes },
    ],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
