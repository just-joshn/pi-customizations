import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { readGoBuildInfo } from '../analysis/formats/gobinary.mjs';
import { mapAnalyzerError } from '../analysis/map-analyzer-error.ts';
import { describeSubject } from '../analysis/target.mjs';
import { capabilityUnavailable, invalidRequest } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import type { ToolCallContext } from './session-tools.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';

export interface InspectGoBinaryParams {
  readonly path: string;
  readonly architecture?: string;
  readonly detail?: string;
}

const resolvePath = (path: string, cwd: string | undefined): string => (isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path));

const GO_LIMITATIONS = [
  'Embedded build metadata is observed file content, not proof of compiler identity, dependency authenticity or runtime behavior.',
  'Only Go build information is inspected; function names, source mappings, type metadata and decompiled code are not recovered.',
  'Resource guards bound stable artifact reads and cumulative header searches to 256 MiB each, aggregate embedded strings to 1 MiB, structural table decoding to 16 MiB and complete metadata payloads to 8 MiB; these are not operating-system memory or CPU limits.',
] as const;

const SUBJECT_ARCHITECTURE: Record<string, string> = {
  amd64: 'x86_64',
  '386': 'x86',
  arm64: 'arm64',
  arm: 'arm',
};

export const inspectGoBinary = async (
  session: ReaSession,
  params: InspectGoBinaryParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  if (typeof params.path !== 'string' || params.path.length === 0) {
    throw invalidRequest('inspect_go_binary requires path.', { parameter: 'path' });
  }

  const path = resolvePath(params.path, context.cwd);

  let subject: Awaited<ReturnType<typeof describeSubject>>;
  let flat: ReturnType<typeof readGoBuildInfo>;
  let bytes: Buffer;
  try {
    subject = await describeSubject(path);
    bytes = await readFile(subject.local_path);
    flat = readGoBuildInfo(bytes);
  } catch (error) {
    mapAnalyzerError(error);
  }

  if (!flat.present) {
    throw capabilityUnavailable(
      'No Go buildinfo marker was found in the searched bytes. That is not evidence that the binary is not a Go program.',
      {
        operation: 'inspect_go_binary',
        path: subject.local_path,
        searched_bytes: bytes.length,
      },
    );
  }

  const goarch = flat.build_settings.find((entry: { key: string; value: string }) => entry.key === 'GOARCH')?.value ?? null;
  const format = subject.detected_format ?? subject.format;
  const header = flat.ranges.find((entry: { field: string }) => entry.field === 'buildinfo-header');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const bits = format === 'pe' || format === 'elf' || format === 'mach-o' ? 64 : null;

  const normalizedResult = {
    artifact: { path: subject.local_path, sha256, bytes: bytes.length },
    format,
    architecture: goarch,
    bits,
    byte_order: 'little',
    build_info: flat.build_info,
    limitations: [...GO_LIMITATIONS],
  };

  const record = createEvidence({
    subject: {
      name: subject.name,
      digest: { sha256 },
      format,
      architecture: goarch === null ? null : (SUBJECT_ARCHITECTURE[goarch] ?? goarch),
      local_path: subject.local_path,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_go_binary',
    parameters: {
      path: params.path,
      ...(params.architecture === undefined ? {} : { architecture: params.architecture }),
      ...(params.detail === undefined ? {} : { detail: params.detail }),
    },
    raw_result: null,
    normalized_result: normalizedResult,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...GO_LIMITATIONS],
    locations: [
      { kind: 'artifact-path', path: subject.local_path },
      ...(header === undefined ? [] : [{ kind: 'file-offset-range', start: header.start, end: header.end }]),
    ],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
