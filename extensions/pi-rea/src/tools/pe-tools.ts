import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectPeCertificatesFromPath, DEFAULT_MAX_ENTRIES as PE_CERT_MAX_ENTRIES } from '../analysis/pe-certificates.ts';
import { PE_MACHINES } from '../analysis/pe-core.ts';
import { DEFAULT_MAX_DLLS, DEFAULT_MAX_FUNCTIONS, inspectPeImportsFromPath } from '../analysis/pe-imports.ts';
import { DEFAULT_MAX_CALLBACKS, inspectPeLoadConfigFromPath } from '../analysis/pe-load-config.ts';
import { DEFAULT_MAX_ENTRIES, DEFAULT_MAX_FILE_BYTES, inspectPeResourcesFromPath } from '../analysis/pe-resources.ts';
import { evidenceResult } from '../contract/results.ts';
import { PI_REA_VERSION, type ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';

export const PE_PARSER_PROVIDER = { id: 'pi-rea-in-process', name: 'pi-rea in-process analysis', version: PI_REA_VERSION } as const;

export interface PeToolContext {
  readonly cwd?: string;
}

export interface InspectPeResourcesParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_entries?: number;
}

export interface InspectPeImportsParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_dlls?: number;
  readonly max_functions?: number;
}

export interface InspectPeCertificatesParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_entries?: number;
}

export interface InspectPeLoadConfigParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_callbacks?: number;
}

const recordPeEvidence = (
  session: ReaSession,
  operation: string,
  path: string,
  resolvedPath: string,
  sha256: string,
  parameters: Record<string, unknown>,
  normalized: Record<string, unknown>,
  limitations: readonly string[],
  architecture: string | null = null,
  extraLocations: readonly { kind: string; path?: string; start?: number; end?: number }[] = [],
): AgentToolResult<unknown> => {
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256 },
      format: 'pe',
      architecture,
      local_path: resolvedPath,
    },
    provider: PE_PARSER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation,
    parameters,
    raw_result: null,
    normalized_result: normalized,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...limitations],
    locations: [{ kind: 'artifact-path', path }, ...extraLocations],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export const inspectPeResources = async (session: ReaSession, params: InspectPeResourcesParams, context: PeToolContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    path,
    resolvedPath,
  } = await inspectPeResourcesFromPath(params.path, {
    ...(params.max_file_bytes === undefined ? {} : { maxFileBytes: params.max_file_bytes }),
    ...(params.max_entries === undefined ? {} : { maxEntries: params.max_entries }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });
  return recordPeEvidence(
    session,
    'inspect_pe_resources',
    path,
    resolvedPath,
    inspection.artifact.sha256,
    {
      path,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_entries: params.max_entries ?? DEFAULT_MAX_ENTRIES,
    },
    inspection as unknown as Record<string, unknown>,
    inspection.limitations,
    PE_MACHINES[inspection.machine] ?? null,
  );
};

export const inspectPeImports = async (session: ReaSession, params: InspectPeImportsParams, context: PeToolContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    path,
    resolvedPath,
  } = await inspectPeImportsFromPath(params.path, {
    ...(params.max_file_bytes === undefined ? {} : { maxFileBytes: params.max_file_bytes }),
    ...(params.max_dlls === undefined ? {} : { maxDlls: params.max_dlls }),
    ...(params.max_functions === undefined ? {} : { maxFunctions: params.max_functions }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });
  const importRange = inspection.import_directory?.locations[0];
  return recordPeEvidence(
    session,
    'inspect_pe_imports',
    path,
    resolvedPath,
    inspection.artifact.sha256,
    {
      path,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_dlls: params.max_dlls ?? DEFAULT_MAX_DLLS,
      max_functions: params.max_functions ?? DEFAULT_MAX_FUNCTIONS,
    },
    inspection as unknown as Record<string, unknown>,
    inspection.limitations,
    PE_MACHINES[inspection.machine] ?? null,
    importRange === undefined ? [] : [{ kind: 'file-offset-range', start: importRange.offset, end: importRange.offset + importRange.bytes }],
  );
};

export const inspectPeCertificates = async (session: ReaSession, params: InspectPeCertificatesParams, context: PeToolContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    path,
    resolvedPath,
  } = await inspectPeCertificatesFromPath(params.path, {
    ...(params.max_file_bytes === undefined ? {} : { maxFileBytes: params.max_file_bytes }),
    ...(params.max_entries === undefined ? {} : { maxEntries: params.max_entries }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });
  const first = inspection.entries[0];
  return recordPeEvidence(
    session,
    'inspect_pe_certificates',
    path,
    resolvedPath,
    inspection.artifact.sha256,
    {
      path,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_entries: params.max_entries ?? PE_CERT_MAX_ENTRIES,
    },
    inspection as unknown as Record<string, unknown>,
    inspection.limitations,
    PE_MACHINES[inspection.machine] ?? null,
    first === undefined ? [] : [{ kind: 'file-offset-range', start: first.location.offset, end: first.location.offset + first.location.bytes }],
  );
};

export const inspectPeLoadConfig = async (session: ReaSession, params: InspectPeLoadConfigParams, context: PeToolContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    path,
    resolvedPath,
  } = await inspectPeLoadConfigFromPath(params.path, {
    ...(params.max_file_bytes === undefined ? {} : { maxFileBytes: params.max_file_bytes }),
    ...(params.max_callbacks === undefined ? {} : { maxCallbacks: params.max_callbacks }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });
  return recordPeEvidence(
    session,
    'inspect_pe_load_config',
    path,
    resolvedPath,
    inspection.artifact.sha256,
    {
      path,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_callbacks: params.max_callbacks ?? DEFAULT_MAX_CALLBACKS,
    },
    inspection as unknown as Record<string, unknown>,
    inspection.limitations,
    PE_MACHINES[inspection.machine] ?? null,
  );
};
