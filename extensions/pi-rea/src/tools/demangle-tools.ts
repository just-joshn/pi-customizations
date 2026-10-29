import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { demangleSwiftSymbols } from '../analysis/swift-demangle.ts';
import { invalidRequest, targetUnavailable } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';

export interface DemangleSwiftParams {
  readonly symbols: readonly unknown[];
  readonly native_command_timeout_ms?: number;
}

export const demangleSwift = async (session: ReaSession, params: DemangleSwiftParams): Promise<AgentToolResult<unknown>> => {
  if (params === null || typeof params !== 'object') {
    throw invalidRequest('demangle_swift requires a parameters object.', { operation: 'demangle_swift' });
  }
  const target = session.target;
  const inspection = await demangleSwiftSymbols(params.symbols, {
    hasOpenTarget: target !== undefined,
    requireOpenTarget: true,
    ...(params.native_command_timeout_ms === undefined ? {} : { timeoutMs: params.native_command_timeout_ms }),
  });
  if (target === undefined) {
    throw targetUnavailable('No app is open. Ask the user which app to investigate, then call open_binary with its local path.');
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
    operation: 'demangle_swift',
    parameters: {
      symbols: params.symbols,
      input_path: target.identity.path,
      ...(params.native_command_timeout_ms === undefined ? {} : { native_command_timeout_ms: params.native_command_timeout_ms }),
    },
    raw_result: null,
    normalized_result: inspection,
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
