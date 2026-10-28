import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { DEFAULT_MAX_ENTRIES, DEFAULT_MAX_PROBE_BYTES, inspectDesktopApplicationFromPath } from '../analysis/desktop-application.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectDesktopApplicationParams {
  readonly path: string;
  readonly max_entries?: number;
  readonly max_probe_bytes?: number;
  readonly detail?: string;
}

export const inspectDesktopApplication = async (
  session: ReaSession,
  params: InspectDesktopApplicationParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const { record: inspection, path, resolvedPath } = await inspectDesktopApplicationFromPath(params.path, {
    ...(params.max_entries === undefined ? {} : { maxEntries: params.max_entries }),
    ...(params.max_probe_bytes === undefined ? {} : { maxProbeBytes: params.max_probe_bytes }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });

  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.root.snapshot_sha256 },
      format: 'directory',
      architecture: null,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_desktop_application',
    parameters: {
      path,
      max_entries: params.max_entries ?? DEFAULT_MAX_ENTRIES,
      max_probe_bytes: params.max_probe_bytes ?? DEFAULT_MAX_PROBE_BYTES,
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
