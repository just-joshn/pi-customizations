
import { chmod, link, mkdir, open as openFile, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { mapAnalyzerError } from '../analysis/map-analyzer-error.ts';
import { buildView } from '../analysis/views.mjs';
import { capabilityUnavailable, evidenceIntegrityMismatch, executionFailure, invalidRequest, resourceConstraint } from '../contract/errors.ts';
import { byteLength, evidenceResult, operationResult } from '../contract/results.ts';
import { PI_REA_VERSION, type ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import type { ToolCallContext } from './session-tools.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';

const resolvePath = (path: string, cwd: string | undefined): string => (isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path));

import { canonicalJson, type EvidenceRecord, evidenceSummaryEntry, isEvidenceRecord, verifyEvidenceIdentity } from '../session/evidence.ts';
import { assertKnownFilters, type EvidenceBundle, type EvidenceFilters, emptyBundle, parseBundle, serializeBundle } from '../session/evidence-ledger.ts';

export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export interface GetEvidenceBundleParams {
  readonly detail?: 'complete' | 'summary';
  readonly filters?: EvidenceFilters;
}

export const getEvidenceBundle = (session: ReaSession, params: GetEvidenceBundleParams): AgentToolResult<unknown> => {
  const detail = params.detail ?? 'complete';
  const filters = assertKnownFilters(params.filters);
  if (detail === 'summary') {
    const { entries, total } = session.evidence.summary(filters);
    return operationResult({
      kind: 'evidence-bundle-summary',
      filters,
      total_retained_records: total,
      matching_records: entries.length,
      unknown_revisions: session.unknowns.revisionCount,
      records: entries,
    });
  }
  if (Object.keys(filters).length > 0) {
    throw invalidRequest('filters require detail summary; a complete bundle always carries every record.', { parameter: 'filters' });
  }
  return operationResult(session.bundle());
};

export interface ExportEvidenceBundleParams {
  readonly path: string;
  readonly overwrite?: boolean;
}

export const exportEvidenceBundle = async (session: ReaSession, params: ExportEvidenceBundleParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  if (typeof params.path !== 'string' || params.path.length === 0) {
    throw invalidRequest('Invalid arguments for tool export_evidence_bundle: path: Invalid input: expected string, received undefined', {
      parameter: 'path',
    });
  }
  const bundle = session.bundle();
  const body = serializeBundle(bundle);
  const target = resolvePath(params.path, context.cwd);
  const staging = join(dirname(target), `.${process.pid}.${Date.now()}.rea-bundle.tmp`);
  const handle = await openFile(staging, 'wx', 0o600).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      await mkdir(dirname(target), { recursive: true });
      return openFile(staging, 'wx', 0o600);
    }
    throw error;
  });
  try {
    await handle.writeFile(body, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(staging, { force: true });
    throw error;
  }
  await handle.close().catch(async (error: NodeJS.ErrnoException) => {
    await rm(staging, { force: true });
    throw error;
  });
  try {
    await chmod(staging, 0o600);
    if (params.overwrite === true) {
      await rename(staging, target);
    } else {
      await link(staging, target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') {
          throw invalidRequest('Evidence file already exists. Choose another path or allow overwrite.', {
            operation: 'write',
            reason: 'exists',
            path: target,
          });
        }
        throw executionFailure(`Cannot publish the Evidence bundle at ${target}: ${error.message}`, {
          operation: 'write',
          reason: error.code ?? 'unwritable',
          path: target,
        });
      });
      await rm(staging, { force: true });
    }
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
  return operationResult({ path: target, bytes: byteLength(body), records: bundle.records.length, unknowns: bundle.unknowns.length });
};

export interface ImportEvidenceBundleParams {
  readonly path: string;
}

export const importEvidenceBundle = async (session: ReaSession, params: ImportEvidenceBundleParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  if (typeof params.path !== 'string' || params.path.length === 0) {
    throw invalidRequest('Invalid arguments for tool import_evidence_bundle: path: Invalid input: expected string, received undefined', {
      parameter: 'path',
    });
  }
  const path = resolvePath(params.path, context.cwd);
  const facts = await stat(path).catch((error: NodeJS.ErrnoException) => {
    throw invalidRequest(`Cannot read Evidence bundle: ${error.message}`, { path: params.path, reason: 'unreadable' });
  });
  if (!facts.isFile()) {
    throw invalidRequest('import_evidence_bundle accepts a regular file.', {
      path: params.path,
      reason: 'not a regular file',
    });
  }
  if (facts.size > MAX_BUNDLE_BYTES) {
    throw resourceConstraint(`The Evidence bundle is ${facts.size} bytes and exceeds the ${MAX_BUNDLE_BYTES} byte import limit.`, { path: params.path, reported_limits: { bundle_bytes: facts.size, max_bundle_bytes: MAX_BUNDLE_BYTES } });
  }
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    throw invalidRequest(`Cannot read Evidence bundle: ${error.message}`, { path: params.path, reason: 'unreadable' });
  });
  const bundle = parseBundle(text);
  const { imported, total } = session.evidence.merge(bundle);
  const unknownsAdded = session.unknowns.insertImported(bundle.unknowns);
  return operationResult({ imported, unknowns_added: unknownsAdded, total });
};

export interface InspectAnalysisViewParams {
  readonly source: { readonly kind: string; readonly evidence_id?: string; readonly evidence?: unknown };
  readonly view: Record<string, unknown>;
}

const ABSORBED_VIEW_KINDS = new Set(['summary', 'section', 'item', 'inventory', 'api-surface']);

export const inspectAnalysisView = async (session: ReaSession, params: InspectAnalysisViewParams): Promise<AgentToolResult<unknown>> => {
  const record = resolveViewSource(session, params.source);
  const kind = params.view['kind'];
  if (typeof kind !== 'string' || !ABSORBED_VIEW_KINDS.has(kind)) {
    return failClosedView(record, kind);
  }

  let view: Awaited<ReturnType<typeof buildView>>;
  try {
    view = await buildView(record as unknown as Record<string, unknown>, {
      kind,
      selector: params.view['selector'] ?? null,
      collection: params.view['collection'] ?? null,
      logicalPaths: params.view['logical_paths'] ?? null,
      offset: typeof params.view['offset'] === 'number' ? params.view['offset'] : 0,
      limit: typeof params.view['limit'] === 'number' ? params.view['limit'] : null,
    });
  } catch (error) {
    mapAnalyzerError(error);
  }

  const projected = createEvidence({
    subject: record.subject,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_analysis_view',
    parameters: view.parameters,
    raw_result: null,
    normalized_result: view.normalized_result,
    confidence: 'derived',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...record.limitations, 'This view reads retained evidence; it neither re-ran the producer nor upgraded its coverage.'],
    locations: record.locations,
    evidence_links: [record.evidence_id],
  });
  session.evidence.record(projected);
  return evidenceResult(projected);
};

const resolveViewSource = (session: ReaSession, source: InspectAnalysisViewParams['source']): EvidenceRecord => {
  if (source.kind === 'retained-evidence') {
    const evidenceId = source.evidence_id as string;
    const record = session.evidence.get(evidenceId);
    if (record === undefined) {
      throw evidenceIntegrityMismatch(`Evidence ${evidenceId} is not retained in this session. Supply complete inline Evidence, re-run its producer, or import its bundle before using this reference.`, {
        evidence_id: evidenceId,
        reason: 'missing',
        expected: 'Evidence retained in this session',
        actual: null,
      });
    }
    return record;
  }
  if (source.kind === 'inline') {
    const candidate = source.evidence;
    if (!isEvidenceRecord(candidate) || !verifyEvidenceIdentity(candidate)) {
      throw evidenceIntegrityMismatch('Inline Evidence does not match the canonical Evidence schema, or its identifier does not match its record.', { reason: 'Evidence validation failed' });
    }
    return candidate;
  }
  throw invalidRequest(`Unsupported view source kind ${JSON.stringify(source.kind)}.`, { parameter: 'source.kind' });
};

const failClosedView = (record: EvidenceRecord, kind: unknown): never => {
  throw capabilityUnavailable(`pi-rea resolved ${record.evidence_id} but does not implement the ${JSON.stringify(kind)} view projection yet; it returns no view rather than an invented shape.`, {
    evidence_id: record.evidence_id,
    operation: record.operation,
    view_kind: kind,
    reason: 'not_implemented',
    port_version: PI_REA_VERSION,
  });
};

export { canonicalJson, type EvidenceBundle, emptyBundle, evidenceSummaryEntry };
