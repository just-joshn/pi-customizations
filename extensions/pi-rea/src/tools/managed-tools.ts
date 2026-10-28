import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectManagedArtifactFromPath } from '../analysis/managed-artifact.ts';
import { inspectManagedMembersFromPath } from '../analysis/managed-members.ts';
import { invalidRequest } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectManagedArtifactParams {
  readonly path?: string;
  readonly detail?: 'complete' | 'summary';
}

export interface InspectManagedMembersParams {
  readonly path?: string;
  readonly detail?: 'complete' | 'summary';
  readonly type_names?: readonly string[];
}

export const inspectManagedArtifact = async (
  session: ReaSession,
  params: InspectManagedArtifactParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const path = params.path ?? session.target?.identity.path;
  if (typeof path !== 'string' || path.length === 0 || !path.startsWith('/')) {
    throw invalidRequest('inspect_managed_artifact requires an absolute path or an open PE target.', {
      operation: 'inspect_managed_artifact',
      parameter: 'path',
    });
  }
  const { record: inspection, resolvedPath } = await inspectManagedArtifactFromPath(path, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });
  const parameters: Record<string, unknown> = {
    input_path: path,
  };
  if (params.detail !== undefined) parameters.detail = params.detail;
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: 'pe',
      architecture: inspection.pe.architecture,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_managed_artifact',
    parameters,
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [{ kind: 'file-offset', offset: 0 }],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export const inspectManagedMembers = async (
  session: ReaSession,
  params: InspectManagedMembersParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const path = params.path ?? session.target?.identity.path;
  if (typeof path !== 'string' || path.length === 0 || !path.startsWith('/')) {
    throw invalidRequest('inspect_managed_members requires an absolute path or an open PE target.', {
      operation: 'inspect_managed_members',
      parameter: 'path',
    });
  }
  const { record: inspection, resolvedPath, architecture } = await inspectManagedMembersFromPath(path, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
    ...(params.type_names === undefined ? {} : { type_names: params.type_names }),
  });
  const parameters: Record<string, unknown> = {
    input_path: path,
  };
  if (params.detail !== undefined) parameters.detail = params.detail;
  if (params.type_names !== undefined) parameters.type_names = params.type_names;
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: 'pe',
      architecture,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_managed_members',
    parameters,
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [{ kind: 'file-offset', offset: 0 }],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
