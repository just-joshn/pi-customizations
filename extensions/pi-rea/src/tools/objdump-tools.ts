import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectWithObjdumpFromPath } from '../analysis/objdump.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectWithObjdumpParams {
  readonly path: string;
  readonly operation?: string;
  readonly follow_debug_links?: boolean;
  readonly provider_executable?: string;
}

export const inspectWithObjdump = async (
  session: ReaSession,
  params: InspectWithObjdumpParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const { record: inspection, path, resolvedPath } = await inspectWithObjdumpFromPath(params.path, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
    ...(params.operation === undefined ? {} : { operation: params.operation }),
    ...(params.follow_debug_links === undefined ? {} : { follow_debug_links: params.follow_debug_links }),
    ...(params.provider_executable === undefined ? {} : { provider_executable: params.provider_executable }),
  });
  void path;
  void resolvedPath;
  const record = createEvidence({
    subject: inspection.subject,
    provider: { id: 'gnu.objdump', name: 'GNU objdump', version: null },
    analysis_profile: null,
    predicate_type: 'rea.reverse-engineering.command-observation',
    operation: 'inspect_with_objdump',
    parameters: inspection.parameters,
    raw_result: inspection.command,
    normalized_result: inspection.command,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [{ kind: 'artifact-path', path: inspection.subject.local_path }],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
