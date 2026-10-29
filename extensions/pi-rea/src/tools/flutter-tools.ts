import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { identifyFlutterBuildFromPath, inspectDartAotFromPath } from '../analysis/flutter-build.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface IdentifyFlutterBuildParams {
  readonly path: string;
}

export interface InspectDartAotParams {
  readonly path: string;
  readonly abi?: string;
  readonly detail?: 'complete' | 'summary';
}

export const identifyFlutterBuild = async (session: ReaSession, params: IdentifyFlutterBuildParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    limitations,
    path,
    resolvedPath,
  } = await identifyFlutterBuildFromPath(params.path, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.target.sha256 },
      format: 'apk',
      architecture: null,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'identify_flutter_build',
    parameters: { path },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...limitations],
    locations: [{ kind: 'artifact-path', path }],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export const inspectDartAot = async (session: ReaSession, params: InspectDartAotParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    path,
    resolvedPath,
  } = await inspectDartAotFromPath(params.path, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
    ...(params.abi === undefined ? {} : { abi: params.abi }),
    ...(params.detail === undefined ? {} : { detail: params.detail }),
  });
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.target.sha256 },
      format: 'apk',
      architecture: inspection.abi,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_dart_aot',
    parameters: {
      path,
      detail: params.detail ?? 'complete',
      ...(params.abi === undefined ? {} : { abi: params.abi }),
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
