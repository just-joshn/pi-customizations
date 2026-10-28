import { readFile } from 'node:fs/promises';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { isMachO, MACHO_LIMITATIONS, parseMachO } from '../analysis/macho.ts';
import { invalidRequest, targetUnavailable } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import { PI_REA_VERSION, type ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';

export const MACHO_PARSER_PROVIDER = { id: 'pi-rea-in-process', name: 'pi-rea in-process analysis', version: PI_REA_VERSION } as const;

export const inspectMacho = async (session: ReaSession, _params: Record<string, never> = {}): Promise<AgentToolResult<unknown>> => {
  const target = session.target;
  if (target === undefined) {
    throw targetUnavailable('No target is open. Call open_binary with a local path before inspecting a Mach-O image.');
  }
  if (target.identity.format !== 'mach-o') {
    throw invalidRequest('The inspection input is not usable. Check the argument and retry.', {
      operation: 'inspect_macho',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message: `Cannot inspect ${target.identity.path}: the open target is ${target.identity.format}, not a Mach-O image.`,
        },
      ],
    });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(target.identity.path);
  } catch (error) {
    throw invalidRequest(`The open target can no longer be read: ${(error as Error).message}`, {
      operation: 'inspect_macho',
      path: target.identity.path,
    });
  }
  if (!isMachO(bytes)) {
    throw invalidRequest('The inspection input is not usable. Check the argument and retry.', {
      operation: 'inspect_macho',
      issues: [{ path: [], reason: 'invalid_value', message: `Cannot inspect ${target.identity.path}: it is not a Mach-O image.` }],
    });
  }

  const inspection = parseMachO(bytes);
  const locations: { kind: string; offset?: number; start?: number; end?: number }[] = [
    ...inspection.entrypoints.items.map((entry) => ({ kind: 'file-offset', offset: entry.file_offset })),
    ...inspection.segments.items
      .filter((segment) => segment.file_size > 0)
      .map((segment) => ({
        kind: 'file-offset-range',
        start: segment.file_offset,
        end: segment.file_offset + segment.file_size,
      })),
  ];
  const record = createEvidence({
    subject: {
      name: target.identity.path.split('/').pop() ?? target.identity.path,
      digest: { sha256: target.identity.sha256 },
      format: target.identity.format,
      architecture: target.identity.architecture,
      local_path: target.identity.path,
    },
    provider: MACHO_PARSER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_macho',
    parameters: { input_path: target.identity.path },
    raw_result: null,
    normalized_result: {
      ...inspection,
      provenance: [
        {
          tool: 'pi-rea/macho-parser',
          command: [],
          tool_version: PI_REA_VERSION,
          version_reason: 'pi-rea decodes the Mach-O image in process; no external tool ran or was sampled.',
          executable_sha256: null,
          exit: { code: 0, signal: null },
          stdout_bytes: 0,
          stderr_bytes: 0,
        },
      ],
      limitations: [...MACHO_LIMITATIONS],
    },
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...MACHO_LIMITATIONS],
    locations,
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
