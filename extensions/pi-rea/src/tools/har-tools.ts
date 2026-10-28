import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { readHarCapture } from '../analysis/formats/har.mjs';
import { mapAnalyzerError } from '../analysis/map-analyzer-error.ts';
import { describeSubject } from '../analysis/target.mjs';
import { invalidRequest, unsupportedTarget } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import type { ToolCallContext } from './session-tools.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';

export interface InspectWebNetworkCaptureParams {
  readonly capture_path: string;
  readonly format: 'har' | 'mitmproxy';
  readonly record_ordinals?: readonly number[];
  readonly sensitive_values?: readonly string[];
}

const resolvePath = (path: string, cwd: string | undefined): string => (isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path));

export const inspectWebNetworkCapture = async (
  session: ReaSession,
  params: InspectWebNetworkCaptureParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  if (typeof params.capture_path !== 'string' || params.capture_path.length === 0) {
    throw invalidRequest('inspect_web_network_capture requires capture_path.', { parameter: 'capture_path' });
  }
  if (params.format !== 'har' && params.format !== 'mitmproxy') {
    throw invalidRequest('inspect_web_network_capture requires format har or mitmproxy.', { parameter: 'format' });
  }
  if (params.format === 'mitmproxy') {
    throw unsupportedTarget('pi-rea implements HAR capture inspection only; mitmproxy format fails closed.', {
      format: params.format,
      path: params.capture_path,
    });
  }

  const path = resolvePath(params.capture_path, context.cwd);

  let facts: Awaited<ReturnType<typeof describeSubject>>;
  let fileBytes: number;
  let inspection: ReturnType<typeof readHarCapture>;
  try {
    facts = await describeSubject(path);
    fileBytes = (await stat(facts.local_path)).size;
    let document: unknown;
    try {
      document = JSON.parse(await readFile(facts.local_path, 'utf8'));
    } catch {
      throw unsupportedTarget('The capture is not valid JSON, so no HAR document could be read.', {
        path: facts.local_path,
        detected: facts.format,
      });
    }
    inspection = readHarCapture(document, {
      record_ordinals: params.record_ordinals,
    });
  } catch (error) {
    mapAnalyzerError(error);
  }

  const { selected_ordinals, sensitive_value_count, ...normalizedCore } = inspection;
  const normalizedResult = {
    ...normalizedCore,
    artifact: {
      path: facts.local_path,
      sha256: facts.digest.sha256,
      bytes: fileBytes,
    },
  };

  const subject = {
    name: facts.name,
    digest: { sha256: facts.digest.sha256 },
    local_path: facts.local_path,
    format: 'file',
    architecture: null,
  };

  const record = createEvidence({
    subject,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_web_network_capture',
    parameters: {
      capture_path: facts.local_path,
      format: params.format,
      record_ordinals: selected_ordinals,
      sensitive_value_count,
      ...(params.sensitive_values === undefined ? {} : { sensitive_values: params.sensitive_values }),
    },
    raw_result: null,
    normalized_result: normalizedResult,
    confidence: 'observed',
    authority: 'historical-reference',
    environment: null,
    limitations: [...normalizedResult.limitations],
    locations: [{ kind: 'artifact-path', path: facts.local_path }],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
