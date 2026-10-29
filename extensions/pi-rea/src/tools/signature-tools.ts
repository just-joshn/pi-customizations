import { readFile } from 'node:fs/promises';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectMachoSignatureBytes } from '../analysis/macho-signature.ts';
import { invalidRequest, targetUnavailable } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import { PI_REA_VERSION, type ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';

export interface InspectSignatureParams {
  readonly native_command_timeout_ms?: number;
}

export const inspectSignature = async (session: ReaSession, params: InspectSignatureParams = {}): Promise<AgentToolResult<unknown>> => {
  const target = session.target;
  if (target === undefined) {
    throw targetUnavailable('No target is open. Call open_binary with a local Mach-O path before inspecting a code signature.');
  }
  if (target.lane !== 'binary') {
    throw targetUnavailable('inspect_signature requires an executable binary session, not a bundle-resource lane.');
  }
  if (target.identity.format !== 'mach-o') {
    throw invalidRequest('The inspection input is not usable. Check the argument and retry.', {
      operation: 'inspect_signature',
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
      operation: 'inspect_signature',
      path: target.identity.path,
    });
  }
  const inspection = inspectMachoSignatureBytes(bytes);
  const parameters: Record<string, unknown> = {
    input_path: target.identity.path,
  };
  if (params.native_command_timeout_ms !== undefined) {
    parameters['native_command_timeout_ms'] = params.native_command_timeout_ms;
  }
  const record = createEvidence({
    subject: {
      name: target.identity.path.split('/').pop() ?? target.identity.path,
      digest: { sha256: target.identity.sha256 },
      format: target.identity.format,
      architecture: target.identity.architecture,
      local_path: target.identity.path,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_signature',
    parameters,
    raw_result: null,
    normalized_result: {
      ...inspection,
      provenance: [
        {
          tool: 'pi-rea/macho-signature-parser',
          command: [],
          tool_version: PI_REA_VERSION,
          version_reason: 'pi-rea decodes LC_CODE_SIGNATURE in process; no codesign process ran.',
          executable_sha256: null,
          exit: { code: 0, signal: null },
          stdout_bytes: 0,
          stderr_bytes: 0,
        },
      ],
    },
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
