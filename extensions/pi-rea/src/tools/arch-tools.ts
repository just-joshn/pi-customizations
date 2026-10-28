import { readFile } from 'node:fs/promises';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { architectureName, cpuSubtypeName, cpuTypeName, isMachO, parseMachO, readSlices } from '../analysis/macho.ts';
import { capabilityUnavailable, targetUnavailable } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import { PI_REA_VERSION, type ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';

const thinArchitecture = (bytes: Buffer): { name: string; hidden: false; cpu_type: null; cpu_subtype: null; file_offset: null; size: null; alignment: null } => {
  const header = parseMachO(bytes);
  return {
    name: header.architectures.items[0]?.name ?? 'unknown',
    hidden: false,
    cpu_type: null,
    cpu_subtype: null,
    file_offset: null,
    size: null,
    alignment: null,
  };
};

export const ARCH_PROVIDER = { id: 'pi-rea-in-process', name: 'pi-rea in-process analysis', version: PI_REA_VERSION } as const;

export const listArchitectures = async (session: ReaSession, _params: Record<string, never> = {}): Promise<AgentToolResult<unknown>> => {
  const target = session.target;
  if (target === undefined) {
    throw targetUnavailable('No target is open. Call open_binary with a local path before listing its architectures.');
  }
  if (target.identity.format !== 'mach-o') {
    throw capabilityUnavailable('pi-rea can list the architectures of a Mach-O target only; the active target is not Mach-O.', {
      provider_id: ARCH_PROVIDER.id,
      operation: 'list_architectures',
      reason: 'the active artifact is not a Mach-O image.',
    });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(target.identity.path);
  } catch (error) {
    throw targetUnavailable(`The open target can no longer be read: ${(error as Error).message}`, { path: target.identity.path });
  }
  if (!isMachO(bytes)) {
    throw capabilityUnavailable('pi-rea can list the architectures of a Mach-O target only; the active target is not Mach-O.', {
      provider_id: ARCH_PROVIDER.id,
      operation: 'list_architectures',
      reason: 'the active artifact is not a Mach-O image.',
    });
  }

  const slices = readSlices(bytes);
  const architectures =
    slices === undefined
      ? [thinArchitecture(bytes)]
      : slices.map((slice) => ({
          name: architectureName(slice.cpuType, slice.cpuSubtype),
          hidden: false as const,
          cpu_type: cpuTypeName(slice.cpuType),
          cpu_subtype: cpuSubtypeName(slice.cpuType, slice.cpuSubtype),
          file_offset: slice.fileOffset,
          size: slice.size,
          alignment: slice.alignment,
        }));

  const record = createEvidence({
    subject: {
      name: target.identity.path.split('/').pop() ?? target.identity.path,
      digest: { sha256: target.identity.sha256 },
      format: slices === undefined ? target.identity.format : 'mach-o-universal',
      architecture: target.identity.architecture,
      local_path: target.identity.path,
    },
    provider: ARCH_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'list_architectures',
    parameters: { input_path: target.identity.path },
    raw_result: null,
    normalized_result: {
      architectures: { items: architectures, total: architectures.length, exhaustive: true, limitations: [] },
      provenance: [
        {
          tool: 'pi-rea/macho-parser',
          command: [],
          tool_version: PI_REA_VERSION,
          version_reason: 'pi-rea reads the universal header in process; no external tool ran or was sampled.',
          executable_sha256: null,
          exit: { code: 0, signal: null },
          stdout_bytes: 0,
          stderr_bytes: 0,
        },
      ],
      limitations: [],
    },
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [],
    locations: (slices ?? []).map((slice) => ({ kind: 'file-offset-range', start: slice.fileOffset, end: slice.fileOffset + slice.size })),
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
