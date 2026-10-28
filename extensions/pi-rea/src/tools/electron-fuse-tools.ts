import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectElectronFusesFromPath } from '../analysis/electron-fuses.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectElectronFusesParams {
  readonly path: string;
}

export const inspectElectronFuses = async (session: ReaSession, params: InspectElectronFusesParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    path,
    resolvedPath,
  } = await inspectElectronFusesFromPath(params.path, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: inspection.artifact.format,
      architecture: inspection.slices[0]?.architecture ?? null,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_electron_fuses',
    parameters: { path },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [{ kind: 'artifact-path', path }, ...inspection.slices.flatMap((slice) => slice.sentinels.map((sentinel) => ({ kind: 'file-offset' as const, offset: sentinel.sentinel_offset })))],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
