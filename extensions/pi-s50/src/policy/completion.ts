import type { EvidenceRecord } from '../domain/evidence.ts';
import type { RunState } from '../domain/run.ts';
import { latestByClaim } from '../evidence/invalidation.ts';
import { consumerMethod } from '../evidence/verification.ts';

export type RequiredEvidence = { readonly criterion: string; readonly satisfied: boolean; readonly records: readonly EvidenceRecord[] };

export function satisfies(record: EvidenceRecord, revision: string): boolean {
  return record.state === 'MEASURED' && record.revision === revision;
}

export const REVIEW_CLAIM = 'review';

export function currentReview(state: RunState): EvidenceRecord | null {
  const record = latestByClaim(state.evidence).find((candidate) => candidate.claim === REVIEW_CLAIM);
  return record !== undefined && record.state === 'MEASURED' && record.revision === state.run.currentRevision ? record : null;
}

// A criterion is proven only through the consumer's own path; tests or reviews alone never stand in for it.
export function requiredEvidence(state: RunState): readonly RequiredEvidence[] {
  const latest = latestByClaim(state.evidence);
  const revision = state.run.currentRevision;
  const method = consumerMethod(state.run.consumer.kind);
  return state.run.acceptanceCriteria.map((criterion) => {
    const records = latest.filter((record) => record.criterion === criterion);
    const satisfied = records.length > 0 && records.every((record) => satisfies(record, revision)) && records.some((record) => record.method === method);
    return { criterion, records, satisfied };
  });
}

export function prReadyBlockers(state: RunState): readonly string[] {
  const { run, graph, findings } = state;
  const blockers: string[] = [];
  if (run.status.kind === 'blocked') blockers.push(`blocked on ${run.status.gate.kind} gate`);
  if (run.status.kind === 'inconclusive') blockers.push(`INCONCLUSIVE: missing ${run.status.missing}`);
  if (run.frozenRevision === null) blockers.push('revision not frozen');
  else if (run.frozenRevision !== run.currentRevision) blockers.push(`frozen revision ${run.frozenRevision} differs from current ${run.currentRevision}`);
  for (const required of requiredEvidence(state)) {
    if (required.satisfied) continue;
    const states = required.records.map((record) => `${record.state}@${record.revision}`).join(', ');
    blockers.push(`criterion "${required.criterion}" lacks MEASURED ${consumerMethod(run.consumer.kind)} evidence at ${run.currentRevision}${states === '' ? '' : ` (${states})`}`);
  }
  if (currentReview(state) === null) blockers.push(`no review at ${run.currentRevision}`);
  for (const finding of findings) if (finding.status === 'open') blockers.push(`open ${finding.severity} finding ${finding.id}`);
  if (graph.nodes.length === 0) blockers.push('graph has no nodes');
  for (const node of graph.nodes) if (node.status !== 'integrated') blockers.push(`node ${node.id} is ${node.status}`);
  for (const loop of run.diagnostics) {
    if (loop.status === 'red') blockers.push(`diagnostic ${loop.id} still red`);
    if (loop.instrumentation.length > 0) blockers.push(`diagnostic ${loop.id} still has temporary instrumentation: ${loop.instrumentation.join(', ')}`);
  }
  if (run.mode === 'bug') {
    if (run.rootCause === null) blockers.push('bug run lacks root cause');
    if (!run.diagnostics.some((loop) => loop.promotedTo !== null)) blockers.push('bug run lacks a diagnostic promoted to a confirmed seam');
  }
  return blockers;
}
