import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { compareApplicationVersions } from '../analysis/compare-application-versions.ts';
import { compareArtifactInventories } from '../analysis/compare-artifacts.ts';
import { compareEvidenceBundles } from '../analysis/compare-bundles.ts';
import {
  compareJavascriptExportShapes,
  EXPORT_SHAPE_ENVELOPE_LIMITATIONS,
} from '../analysis/compare-javascript-export-shapes.ts';
import { compareManagedMemberEvidence } from '../analysis/compare-managed-members.ts';
import { compareSourceToBundle } from '../analysis/compare-source-to-bundle.ts';
import { invalidRequest } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence, isEvidenceRecord } from '../session/evidence.ts';

const resolveEvidenceArg = (session: ReaSession, value: unknown, label: string): unknown => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record['evidence_id'] === 'string' && record['normalized_result'] === undefined) {
      const retained = session.evidence.get(record['evidence_id'] as string);
      if (retained === undefined) {
        throw invalidRequest(`compare_* ${label} evidence_id is not retained in this session.`, {
          parameter: label,
          evidence_id: record['evidence_id'],
        });
      }
      return retained;
    }
    if (isEvidenceRecord(value)) return value;
    if (typeof record['evidence_id'] === 'string') return value;
  }
  throw invalidRequest(`${label} must be an Evidence object (or retained evidence_id reference).`, { parameter: label });
};

export interface CompareArtifactsParams {
  readonly left: unknown;
  readonly right: unknown;
}

export const compareArtifacts = (session: ReaSession, params: CompareArtifactsParams): AgentToolResult<unknown> => {
  const left = resolveEvidenceArg(session, params.left, 'left');
  const right = resolveEvidenceArg(session, params.right, 'right');
  const leftId = (left as { evidence_id: string }).evidence_id;
  const rightId = (right as { evidence_id: string }).evidence_id;
  const inspection = compareArtifactInventories(left, right);
  const record = createEvidence({
    subject: null,
    provider: { id: 'pi-rea-artifact-comparison', name: 'pi-rea artifact comparison', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.artifact-comparison',
    operation: 'compare_artifacts',
    parameters: {
      left_evidence_ids: [leftId],
      right_evidence_ids: [rightId],
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'derived',
    authority: 'analyst-inference',
    environment: null,
    limitations: ['Artifact identity is unavailable for this observation.', ...inspection.limitations],
    locations: [],
    evidence_links: [leftId, rightId],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export interface CompareBundlesParams {
  readonly left_bundle_path: string;
  readonly right_bundle_path: string;
  readonly record_pairs?: readonly unknown[];
}

export const compareBundles = async (session: ReaSession, params: CompareBundlesParams): Promise<AgentToolResult<unknown>> => {
  const { inspection, parameters } = await compareEvidenceBundles(params.left_bundle_path, params.right_bundle_path, params.record_pairs ?? []);
  const record = createEvidence({
    subject: null,
    provider: { id: 'pi-rea-bundle-comparison', name: 'pi-rea Evidence bundle comparison', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.bundle-comparison',
    operation: 'compare_bundles',
    parameters,
    raw_result: null,
    normalized_result: inspection,
    confidence: 'derived',
    authority: 'analyst-inference',
    environment: null,
    limitations: ['Artifact identity is unavailable for this observation.', ...inspection.limitations],
    locations: [],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export interface CompareManagedMembersParams {
  readonly left: unknown;
  readonly right: unknown;
}

const managedMemberPath = (record: unknown): string | undefined => {
  if (typeof record !== 'object' || record === null) return undefined;
  const body = record as {
    readonly subject?: { readonly local_path?: unknown } | null;
    readonly parameters?: { readonly input_path?: unknown };
  };
  if (typeof body.subject?.local_path === 'string' && body.subject.local_path.length > 0) {
    return body.subject.local_path;
  }
  if (typeof body.parameters?.input_path === 'string' && body.parameters.input_path.length > 0) {
    return body.parameters.input_path;
  }
  return undefined;
};

export const compareManagedMembers = (session: ReaSession, params: CompareManagedMembersParams): AgentToolResult<unknown> => {
  const left = resolveEvidenceArg(session, params.left, 'left');
  const right = resolveEvidenceArg(session, params.right, 'right');
  const inspection = compareManagedMemberEvidence(left, right);
  const leftPath = managedMemberPath(left);
  const rightPath = managedMemberPath(right);
  const record = createEvidence({
    subject: null,
    provider: { id: 'pi-rea-dotnet-workflows', name: 'pi-rea managed-code workflows', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.managed-member-comparison',
    operation: 'compare_managed_members',
    parameters: {
      left_evidence_id: (left as { evidence_id: string }).evidence_id,
      right_evidence_id: (right as { evidence_id: string }).evidence_id,
      ...(leftPath === undefined ? {} : { left_path: leftPath }),
      ...(rightPath === undefined ? {} : { right_path: rightPath }),
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'inferred',
    authority: 'analyst-inference',
    environment: null,
    limitations: ['Artifact identity is unavailable for this observation.', ...inspection.limitations],
    locations: [
      ...(leftPath === undefined ? [] : [{ kind: 'artifact-path' as const, path: leftPath }]),
      ...(rightPath === undefined ? [] : [{ kind: 'artifact-path' as const, path: rightPath }]),
    ],
    evidence_links: [...inspection.evidence_links],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export interface CompareJavascriptExportShapesParams {
  readonly left: unknown;
  readonly right: unknown;
  readonly left_module_path: string;
  readonly left_export_name: string;
  readonly right_module_path: string;
  readonly right_export_name: string;
}

export const compareJavascriptExportShapesTool = (
  session: ReaSession,
  params: CompareJavascriptExportShapesParams,
): AgentToolResult<unknown> => {
  const left = resolveEvidenceArg(session, params.left, 'left');
  const right = resolveEvidenceArg(session, params.right, 'right');
  const inspection = compareJavascriptExportShapes({
    left,
    right,
    left_module_path: params.left_module_path,
    left_export_name: params.left_export_name,
    right_module_path: params.right_module_path,
    right_export_name: params.right_export_name,
  });
  const record = createEvidence({
    subject: null,
    provider: { id: 'pi-rea-javascript-workflows', name: 'pi-rea JavaScript workflows', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.javascript-export-shape-comparison',
    operation: 'compare_javascript_export_shapes',
    parameters: {
      left_evidence_id: (left as { evidence_id: string }).evidence_id,
      right_evidence_id: (right as { evidence_id: string }).evidence_id,
      left_module_path: params.left_module_path,
      left_export_name: params.left_export_name,
      right_module_path: params.right_module_path,
      right_export_name: params.right_export_name,
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'inferred',
    authority: 'analyst-inference',
    environment: null,
    limitations: [...EXPORT_SHAPE_ENVELOPE_LIMITATIONS],
    locations: [],
    evidence_links: [...inspection.evidence_links],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export interface CompareApplicationVersionsParams {
  readonly left: unknown;
  readonly right: unknown;
  readonly left_native_observations?: readonly unknown[];
  readonly right_native_observations?: readonly unknown[];
}

export const compareApplicationVersionsTool = (
  session: ReaSession,
  params: CompareApplicationVersionsParams,
): AgentToolResult<unknown> => {
  const left = resolveEvidenceArg(session, params.left, 'left');
  const right = resolveEvidenceArg(session, params.right, 'right');
  const inspection = compareApplicationVersions({ left, right });
  const leftNativeIds = Array.isArray(params.left_native_observations)
    ? params.left_native_observations
        .map((row) => (typeof row === 'object' && row !== null && 'evidence_id' in row ? String((row as { evidence_id: unknown }).evidence_id) : null))
        .filter((id): id is string => typeof id === 'string' && id.startsWith('ev_'))
    : [];
  const rightNativeIds = Array.isArray(params.right_native_observations)
    ? params.right_native_observations
        .map((row) => (typeof row === 'object' && row !== null && 'evidence_id' in row ? String((row as { evidence_id: unknown }).evidence_id) : null))
        .filter((id): id is string => typeof id === 'string' && id.startsWith('ev_'))
    : [];
  const record = createEvidence({
    subject: null,
    provider: { id: 'pi-rea-javascript-workflows', name: 'pi-rea JavaScript workflows', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.application-version-comparison',
    operation: 'compare_application_versions',
    parameters: {
      left_evidence_id: (left as { evidence_id: string }).evidence_id,
      right_evidence_id: (right as { evidence_id: string }).evidence_id,
      left_native_evidence_ids: leftNativeIds,
      right_native_evidence_ids: rightNativeIds,
      ...(params.left_native_observations === undefined ? {} : { left_native_observations: params.left_native_observations }),
      ...(params.right_native_observations === undefined ? {} : { right_native_observations: params.right_native_observations }),
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'inferred',
    authority: 'analyst-inference',
    environment: null,
    limitations: ['Artifact identity is unavailable for this observation.', ...inspection.limitations],
    locations: [],
    evidence_links: [...inspection.evidence_links],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export interface CompareSourceToBundleParams {
  readonly reference: unknown;
  readonly application: unknown;
  readonly view?: unknown;
}

export const compareSourceToBundleTool = async (
  session: ReaSession,
  params: CompareSourceToBundleParams,
): Promise<AgentToolResult<unknown>> => {
  const application = resolveEvidenceArg(session, params.application, 'application');
  const inspection = await compareSourceToBundle({ reference: params.reference, application });
  const record = createEvidence({
    subject: null,
    provider: { id: 'pi-rea-javascript-workflows', name: 'pi-rea JavaScript workflows', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.source-to-bundle-comparison',
    operation: 'compare_source_to_bundle',
    parameters: {
      reference_root_sha256: inspection.reference.root_sha256,
      application_evidence_id: (application as { evidence_id: string }).evidence_id,
      ...(params.view === undefined ? {} : { view: params.view }),
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'inferred',
    authority: 'analyst-inference',
    environment: null,
    limitations: ['Artifact identity is unavailable for this observation.', ...inspection.limitations],
    locations: [],
    evidence_links: [...inspection.evidence_links],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
