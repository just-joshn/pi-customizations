import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { readBinaryLayout } from '../analysis/formats/binary.mjs';
import { mapAnalyzerError } from '../analysis/map-analyzer-error.ts';
import { describeSubject } from '../analysis/target.mjs';
import {
  capabilityUnavailable,
  invalidRequest,
  PWNTTOOLS_LINUX_X64_ONLY,
  pwntoolsHostSupported,
} from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import type { ToolCallContext } from './session-tools.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';

export interface InspectBinaryLayoutParams {
  readonly path: string;
  readonly detail?: 'complete' | 'summary';
}

const resolvePath = (path: string, cwd: string | undefined): string => (isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path));

const STATIC_LIMITATION = 'Static facts only; the port performs no execution and opens no disassembler.';

export const inspectBinaryLayout = async (
  session: ReaSession,
  params: InspectBinaryLayoutParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  if (typeof params.path !== 'string' || params.path.length === 0) {
    throw invalidRequest('inspect_binary_layout requires path.', { parameter: 'path' });
  }

  if (!pwntoolsHostSupported()) {
    throw capabilityUnavailable(PWNTTOOLS_LINUX_X64_ONLY, {
      provider_id: 'pwntools-elf',
      operation: 'inspect_binary_layout',
      reason: PWNTTOOLS_LINUX_X64_ONLY,
    });
  }

  const path = resolvePath(params.path, context.cwd);

  let subject: Awaited<ReturnType<typeof describeSubject>>;
  let normalizedResult: ReturnType<typeof readBinaryLayout>;
  try {
    subject = await describeSubject(path);
    const bytes = await readFile(subject.local_path);
    normalizedResult = readBinaryLayout(bytes);
  } catch (error) {
    mapAnalyzerError(error);
  }

  const limitations = [...(normalizedResult.limitations ?? []), STATIC_LIMITATION];
  const record = createEvidence({
    subject,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_binary_layout',
    parameters: {
      path: params.path,
      ...(params.detail === undefined ? {} : { detail: params.detail }),
    },
    raw_result: null,
    normalized_result: normalizedResult,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations,
    locations: [{ kind: 'artifact-path', path: subject.local_path }],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
