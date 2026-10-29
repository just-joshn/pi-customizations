import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { catalogDigest } from '../contract/catalog.ts';
import { capabilityUnavailable, evidenceIntegrityMismatch, invalidRequest, targetUnavailable } from '../contract/errors.ts';
import { operationResult, responseBudgetBytes } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { PI_REA_VERSION } from '../session/binary-session.ts';
import { identifyArtifact } from '../targets/artifact-identity.ts';

const CATALOG_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export interface BinarySessionParams {
  readonly expected_package_version?: string;
  readonly expected_catalog_digest?: string;
  readonly expected_server_path?: string;
}

export const binarySession = (session: ReaSession, params: BinarySessionParams): AgentToolResult<unknown> => {
  const mismatches: { field: string; expected: string; actual: string }[] = [];
  if (params.expected_package_version !== undefined && params.expected_package_version !== PI_REA_VERSION) {
    mismatches.push({ field: 'expected_package_version', expected: params.expected_package_version, actual: PI_REA_VERSION });
  }
  if (params.expected_catalog_digest !== undefined) {
    if (!CATALOG_DIGEST_PATTERN.test(params.expected_catalog_digest)) {
      throw invalidRequest(`Invalid arguments for tool binary_session: expected_catalog_digest: Invalid string: must match pattern /^[a-f0-9]{64}$/u`, { parameter: 'expected_catalog_digest' });
    }
    const liveDigest = catalogDigest(session.catalog);
    if (params.expected_catalog_digest !== liveDigest) {
      mismatches.push({
        field: 'expected_catalog_digest',
        expected: params.expected_catalog_digest,
        actual: liveDigest,
      });
    }
  }
  if (params.expected_server_path !== undefined && params.expected_server_path !== session.serverPath) {
    mismatches.push({ field: 'expected_server_path', expected: params.expected_server_path, actual: session.serverPath });
  }
  const report = session.report();
  const serverIdentity = report['server_identity'] as Record<string, unknown>;
  return operationResult({
    ...report,
    server_identity: {
      ...serverIdentity,
      alignment: alignmentFor(params, mismatches),
    },
  });
};

const ALIGNMENT_REMEDIATION = 'Restart the registered MCP server/client, then compare identity again.';

const alignmentFor = (params: BinarySessionParams, mismatches: readonly { readonly field: string }[]): Record<string, unknown> => {
  if (params.expected_package_version === undefined && params.expected_catalog_digest === undefined && params.expected_server_path === undefined) {
    return {
      state: 'unknown',
      reasons: [],
      remediation: 'Supply expected package, catalog, or registration identity to compare the live server.',
    };
  }
  if (mismatches.length === 0) return { state: 'aligned', reasons: [], remediation: null };
  const reasons = mismatches.map((entry) => (entry.field === 'expected_package_version' ? 'package_version_mismatch' : entry.field === 'expected_catalog_digest' ? 'catalog_digest_mismatch' : 'registration_path_mismatch'));
  return { state: 'mcp_server_restart_required', reasons, remediation: ALIGNMENT_REMEDIATION };
};

export interface OpenBinaryParams {
  readonly path: string;
  readonly format?: string;
  readonly provider_id?: string;
  readonly snapshot_path?: string;
}

export interface ToolCallContext {
  readonly cwd?: string;
  readonly signal?: AbortSignal;
}

export const openBinary = async (session: ReaSession, params: OpenBinaryParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  if (typeof params.path !== 'string' || params.path.length === 0) {
    throw invalidRequest('Invalid arguments for tool open_binary: path: Invalid input: expected string, received undefined', {
      parameter: 'path',
    });
  }
  if (params.format !== undefined && params.format !== 'dos-com') {
    throw invalidRequest(`open_binary format must be "dos-com" when supplied, received ${JSON.stringify(params.format)}.`, {
      parameter: 'format',
    });
  }
  if (params.format === 'dos-com') {
    throw capabilityUnavailable('pi-rea does not implement headerless DOS COM analysis images yet.', {
      operation: 'open_binary',
      format: 'dos-com',
      reason: 'not_implemented',
    });
  }
  if (params.provider_id !== undefined && params.provider_id !== 'auto') {
    throw capabilityUnavailable(`pi-rea has no deep-analysis provider bridge, so provider_id ${JSON.stringify(params.provider_id)} cannot be selected. Omit provider_id or use "auto" for identity-only opening.`, {
      operation: 'open_binary',
      provider_id: params.provider_id,
      reason: 'not_implemented',
    });
  }
  if (params.snapshot_path !== undefined) {
    throw capabilityUnavailable('pi-rea does not implement analysis snapshots yet.', {
      operation: 'open_binary',
      parameter: 'snapshot_path',
      reason: 'not_implemented',
    });
  }
  responseBudgetBytes();
  const identity = await identifyArtifact(params.path, { cwd: context.cwd ?? process.cwd(), ...(context.signal === undefined ? {} : { signal: context.signal }) });
  session.openTarget(identity);
  return operationResult(identity, { provenance: true });
};

export interface CloseBinaryParams {
  readonly snapshot_path?: string;
  readonly overwrite?: boolean;
}

export const closeBinary = (session: ReaSession, params: CloseBinaryParams): AgentToolResult<unknown> => {
  if (params.snapshot_path !== undefined) {
    if (!session.open) {
      throw targetUnavailable('No app is open. Ask the user which app to investigate, then call open_binary with its local path.');
    }
    throw evidenceIntegrityMismatch('Evidence is invalid or has changed. Recreate or re-import it, then try again.', {
      reason: 'Profileless native snapshots may contain only current dispatch workflow observations',
    });
  }
  session.closeTarget();
  return operationResult(null, { provenance: true });
};
