import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { analyzeJavaScriptApplication, JS_LIMITATIONS } from '../analysis/formats/javascript.mjs';
import { openAsarSource, openDirectorySource } from '../analysis/formats/target-source.mjs';
import { mapAnalyzerError } from '../analysis/map-analyzer-error.ts';
import { describeSubject } from '../analysis/target.mjs';
import { invalidRequest, unsupportedTarget } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface AnalyzeJavaScriptApplicationParams {
  readonly input_path: string;
  readonly format?: 'auto' | 'asar' | 'directory';
  readonly integrity_policy?: 'fail' | 'record-and-continue';
  readonly max_heap_mb?: number;
  readonly analysis_timeout_ms?: number;
  readonly detail?: 'complete' | 'summary';
}

const resolvePath = (path: string, cwd: string | undefined): string => (isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path));

export const analyzeJavascriptApplication = async (session: ReaSession, params: AnalyzeJavaScriptApplicationParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  if (typeof params.input_path !== 'string' || params.input_path.length === 0) {
    throw invalidRequest('analyze_javascript_application requires input_path.', { parameter: 'input_path' });
  }

  const path = resolvePath(params.input_path, context.cwd);
  const format = params.format ?? 'auto';
  const integrityPolicy = params.integrity_policy ?? 'fail';

  let subject: Awaited<ReturnType<typeof describeSubject>>;
  let source: unknown;
  try {
    subject = await describeSubject(path, { formatHint: format });
    if (subject.format === 'directory') {
      source = await openDirectorySource(subject.local_path);
    } else if (subject.format === 'asar') {
      source = await openAsarSource(await readFile(subject.local_path));
    } else if (format === 'directory') {
      throw unsupportedTarget('The target is not a directory; format directory cannot be honoured.', {
        path: subject.local_path,
        detected: subject.format,
      });
    } else {
      throw unsupportedTarget('Only a directory or an ASAR can be analyzed as a JavaScript application.', {
        path: subject.local_path,
        detected: subject.format,
      });
    }
  } catch (error) {
    mapAnalyzerError(error);
  }

  let normalizedResult: Record<string, unknown>;
  try {
    normalizedResult = await analyzeJavaScriptApplication({ source, subject, integrityPolicy });
  } catch (error) {
    mapAnalyzerError(error);
  }

  const record = createEvidence({
    subject: {
      name: subject.name,
      digest: subject.digest,
      format: subject.format,
      architecture: subject.architecture,
      local_path: subject.local_path,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.javascript-application-analysis',
    operation: 'analyze_javascript_application',
    parameters: {
      input_path: params.input_path,
      format,
      integrity_policy: integrityPolicy,
      ...(params.max_heap_mb === undefined ? {} : { max_heap_mb: params.max_heap_mb }),
      ...(params.analysis_timeout_ms === undefined ? {} : { analysis_timeout_ms: params.analysis_timeout_ms }),
      ...(params.detail === undefined ? {} : { detail: params.detail }),
    },
    raw_result: null,
    normalized_result: normalizedResult,
    confidence: 'derived',
    authority: 'shipped-artifact',
    environment: null,
    limitations: Array.isArray(normalizedResult['limitations']) ? [...(normalizedResult['limitations'] as string[])] : [...JS_LIMITATIONS],
    locations: [{ kind: 'artifact-path', path: 'artifact-root' }],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
