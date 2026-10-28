import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { DEFAULT_MAX_ENTRIES, DEFAULT_MAX_FILE_BYTES, inspectElfNotesFromPath } from '../analysis/elf-notes.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectElfNotesParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_entries?: number;
}

export const inspectElfNotes = async (session: ReaSession, params: InspectElfNotesParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const {
    record: inspection,
    path,
    resolvedPath,
  } = await inspectElfNotesFromPath(params.path, {
    ...(params.max_file_bytes === undefined ? {} : { maxFileBytes: params.max_file_bytes }),
    ...(params.max_entries === undefined ? {} : { maxEntries: params.max_entries }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });

  const ELF_MACHINES: Record<number, string> = { 3: 'x86', 62: 'x86_64', 40: 'arm', 183: 'aarch64' };
  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: 'elf',
      architecture: ELF_MACHINES[inspection.machine] ?? null,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_elf_notes',
    parameters: {
      path,
      max_file_bytes: params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES,
      max_entries: params.max_entries ?? DEFAULT_MAX_ENTRIES,
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [
      { kind: 'artifact-path', path },
      ...inspection.tables.map((table) => ({
        kind: 'file-offset-range' as const,
        start: table.location.offset,
        end: table.location.offset + table.location.bytes,
      })),
    ],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
