import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_NODES,
  DEFAULT_MAX_PROPERTIES,
  DevicetreeFormatError,
  DevicetreeLimitError,
  inspectDevicetreeFromPath,
  type InspectDevicetreeParams,
} from '../analysis/devicetree.ts';
import { mapAnalyzerError } from '../analysis/map-analyzer-error.ts';
import { resourceConstraint, unsupportedTarget } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export const inspectDevicetree = async (
  session: ReaSession,
  params: InspectDevicetreeParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  let inspection: Awaited<ReturnType<typeof inspectDevicetreeFromPath>>;
  try {
    inspection = await inspectDevicetreeFromPath(params, {
      ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
    });
  } catch (error) {
    if (error instanceof DevicetreeLimitError) {
      throw resourceConstraint(error.message, { operation: 'inspect_devicetree', limit: error.limit });
    }
    if (error instanceof DevicetreeFormatError) {
      throw unsupportedTarget(error.message, { operation: 'inspect_devicetree', reason: error.kind });
    }
    mapAnalyzerError(error);
  }

  const { report, path, resolvedPath } = inspection;
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: report.artifact.sha256 },
      format: 'file',
      architecture: null,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_devicetree',
    parameters: {
      path,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_nodes: params.max_nodes ?? DEFAULT_MAX_NODES,
      max_properties: params.max_properties ?? DEFAULT_MAX_PROPERTIES,
      max_depth: params.max_depth ?? DEFAULT_MAX_DEPTH,
    },
    raw_result: null,
    normalized_result: report,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...report.limitations],
    locations: [{ kind: 'artifact-path', path: resolvedPath }],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
