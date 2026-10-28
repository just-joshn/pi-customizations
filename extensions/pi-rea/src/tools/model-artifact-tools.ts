import { isAbsolute, resolve } from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectModelArtifactFromPath, MODEL_HEADER_ENVELOPE_LIMITATION, MODEL_RESULT_LIMITATIONS } from '../analysis/model-artifact.ts';
import { ReaError, resourceConstraint, unsupportedTarget } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

const MODEL_OPERATION = 'inspect_model_artifact';
const FILE_FORMAT_REMEDIATION = 'Review the reported file-format reason and select a supported, well-formed target.';

const fileFormatRejected = (path: string, reason: string): ReaError =>
  new ReaError({
    code: 'target_unavailable',
    category: 'unsupported_target',
    message: `Cannot open artifact: ${reason}.`,
    retryable: false,
    remediation: { action: FILE_FORMAT_REMEDIATION },
    details: { path, reason, constraint: 'file_format_rejected' },
  });

const hostPrecision = (): ReaError =>
  resourceConstraint(
    'Header length/count exceeds exact host offset precision',
    {
      operation: MODEL_OPERATION,
      resource: 'memory',
      reason: 'Header length/count exceeds exact host offset precision',
      reported_limits: { maximum_exact_offset: 9007199254740991 },
    },
    'Exact host offset precision stops at 9007199254740991. This release has no runtime override. Additional host memory does not raise it. Repeating the unchanged request fails the same way.',
  );

const representationBudget = (): ReaError => {
  const message = 'Model facts exceed the 32 MiB retained representation budget. This release has no runtime override.';
  return resourceConstraint(
    message,
    { operation: MODEL_OPERATION, resource: 'memory', reason: message, reported_limits: { maximum_representation_bytes: 33_554_432 } },
    'The retained model representation allowance is 33554432 bytes. This release has no runtime override. Additional host memory does not raise it. Repeating the unchanged request fails the same way.',
  );
};

const unsupportedVersion = (path: string, version: number): ReaError => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(version);
  const reason = `GGUF version bytes ${bytes.toString('hex')} are unsupported (little-endian ${version}, big-endian ${bytes.readUInt32BE(0)}; byte order unknown); supported versions are 2 and 3`;
  return unsupportedTarget(
    `Unsupported target for inspect_model_artifact at ${path}: ${reason}`,
    { operation: MODEL_OPERATION, path, reason },
    'Select a target supported by this operation or choose an operation supporting the reported target format.',
  );
};

const malformedGguf = (message: string, path: string): ReaError | null => {
  if (
    message === 'the file is not a GGUF container.' ||
    message.startsWith('truncated at ') ||
    message === 'string length out of range' ||
    message === 'string length exceeds exact host offset precision' ||
    message === 'array count out of range' ||
    message === 'tensor rank is out of range.'
  ) {
    return fileFormatRejected(path, 'Declared header extent is outside the file');
  }
  if (message === 'GGUF header length/count exceeds exact host offset precision.' || message === 'array count exceeds exact host offset precision' || message === 'tensor data offset exceeds exact host offset precision') {
    return hostPrecision();
  }
  if (message === 'GGUF counts are out of range.') return representationBudget();
  const metadataType = /^unsupported GGUF metadata type (\d+)$/u.exec(message);
  if (metadataType !== null) return fileFormatRejected(path, `Unknown GGUF metadata type ${metadataType[1]}`);
  const version = /^unsupported GGUF version (\d+)\.$/u.exec(message);
  if (version !== null) return unsupportedVersion(path, Number(version[1]));
  return null;
};

export interface InspectModelArtifactParams {
  readonly path: string;
  readonly hash?: string;
  readonly detail?: string;
  readonly view?: Record<string, unknown>;
}

export const inspectModelArtifact = async (session: ReaSession, params: InspectModelArtifactParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const hashMode = params.hash === 'full' ? 'full' : 'header';
  let inspection: Awaited<ReturnType<typeof inspectModelArtifactFromPath>>;
  try {
    inspection = await inspectModelArtifactFromPath(params.path, {
      hash: hashMode,
      ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
    });
  } catch (error) {
    if (error instanceof Error) {
      const resolvedPath = isAbsolute(params.path) ? params.path : resolve(context.cwd ?? process.cwd(), params.path);
      let detail = error.message;
      if (error instanceof ReaError && error.payload.details?.['operation'] === MODEL_OPERATION) {
        const issues = error.payload.details['issues'];
        const issue = Array.isArray(issues) && issues.length > 0 ? (issues[0] as { message?: unknown }).message : undefined;
        if (typeof issue === 'string') {
          const prefix = `Cannot inspect ${params.path}: `;
          detail = issue.startsWith(prefix) ? issue.slice(prefix.length) : issue;
        }
      }
      const mapped = malformedGguf(detail, resolvedPath);
      if (mapped !== null) throw mapped;
    }
    throw error;
  }
  const { record: inspectionRecord, path } = inspection;

  const envelopeLimitations = hashMode === 'header' ? [MODEL_HEADER_ENVELOPE_LIMITATION, ...MODEL_RESULT_LIMITATIONS] : [...MODEL_RESULT_LIMITATIONS];

  const record = createEvidence({
    subject: null,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_model_artifact',
    parameters: {
      path,
      hash: hashMode,
      ...(params.detail === undefined ? {} : { detail: params.detail }),
      ...(params.view === undefined ? {} : { view: params.view }),
    },
    raw_result: null,
    normalized_result: inspectionRecord,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: envelopeLimitations,
    locations: [
      { kind: 'artifact-path', path },
      { kind: 'file-offset-range', start: 0, end: inspectionRecord.artifact.header_length },
    ],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
