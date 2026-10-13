import { COVERAGE_STATUS } from './envelope.mjs';

const OBSERVING_AUTHORITIES = new Set(['artifact-bytes', 'ast-static-analysis', 'runtime-observation', 'toolchain-observation']);
const RELATIONSHIP_AUTHORITIES = new Set(['static-relationship-inference']);

/**
 * The rules that must hold in a report, checked rather than requested. A record
 * that claims more than its evidence supports is a defect, not a wording
 * preference, so the skill's own validation calls this before quoting a result.
 */
export function auditEvidence(records) {
  const violations = [];
  for (const record of records) {
    const where = `${record.operation ?? 'unknown'} ${record.evidence_id ?? ''}`.trim();
    if (!Array.isArray(record.limitations) || record.limitations.length === 0) violations.push({ rule: 'limitations-missing', where, message: 'a result with no stated limitations is not trustworthy' });
    if (record.environment === null && claimsExecution(record)) violations.push({ rule: 'execution-claim-without-runtime', where, message: 'the record claims observed execution but carries no runtime environment' });
    for (const node of graphNodes(record)) {
      for (const observation of node.observations ?? []) collectViolations({ violations, where, node, observation });
    }
    const coverage = record.normalized_result?.coverage ?? record.normalized_result?.graph?.coverage ?? null;
    if (coverage !== null && !COVERAGE_STATUS.has(coverage.status)) violations.push({ rule: 'coverage-status', where, message: `unknown coverage status: ${coverage.status}` });
  }
  return violations;
}

function collectViolations({ violations, where, node, observation }) {
  const evidence = observation.evidence ?? {};
  if (evidence.state === 'observed' && !OBSERVING_AUTHORITIES.has(evidence.authority)) {
    violations.push({ rule: 'observed-without-observing-authority', where, message: `${node.kind} ${observation.label}: state observed with authority ${evidence.authority}` });
  }
  if (RELATIONSHIP_AUTHORITIES.has(evidence.authority) && evidence.state !== 'inferred') {
    violations.push({ rule: 'relationship-not-inferred', where, message: `${node.kind} ${observation.label}: a relationship is inferred, not ${evidence.state}` });
  }
  if (evidence.state === 'observed' && evidence.authority === 'artifact-bytes' && evidence.confidence !== 'exact') {
    violations.push({ rule: 'artifact-fact-not-exact', where, message: `${node.kind} ${observation.label}: a fact read from bytes is exact` });
  }
  const coverage = evidence.coverage ?? {};
  if (coverage.truncated === true && !Number.isInteger(coverage.omitted_count)) {
    violations.push({ rule: 'truncated-without-count', where, message: `${node.kind} ${observation.label}: truncated coverage without omitted_count` });
  }
  if (!Array.isArray(evidence.limitations) || evidence.limitations.length === 0) {
    violations.push({ rule: 'observation-limitations-missing', where, message: `${node.kind} ${observation.label}: observation carries no limitations` });
  }
}

function claimsExecution(record) {
  if (record.authority === 'runtime-observation') return false;
  const text = JSON.stringify(record.normalized_result ?? {});
  return /"executed"\s*:\s*true|"observed_execution"\s*:\s*true/.test(text);
}

function graphNodes(record) {
  return record.normalized_result?.graph?.nodes ?? [];
}

/**
 * A conclusion may cite only evidence that exists in the bundle it is read from.
 * A dangling citation is a broken chain, not a stylistic issue.
 */
export function unresolvedCitations(bundle) {
  const known = new Set((bundle.records ?? []).map((record) => record.evidence_id));
  const missing = [];
  for (const record of bundle.records ?? []) {
    for (const cited of citationsOf(record)) {
      if (!known.has(cited)) missing.push({ from: record.evidence_id, missing: cited });
    }
  }
  return missing;
}

function* citationsOf(record) {
  yield* record.evidence_links ?? [];
  for (const node of graphNodes(record)) {
    for (const observation of node.observations ?? []) yield* observation.evidence?.evidence_ids ?? [];
  }
}

/** Absence may only be claimed inside a source whose coverage is complete. */
export function absenceClaimAllowed(record) {
  const coverage = record.normalized_result?.graph?.coverage ?? record.normalized_result?.coverage ?? null;
  return coverage !== null && coverage.status === 'complete' && coverage.truncated === false;
}

/** A path that resolves outside the declared target is a scope violation. */
export function isWithinTarget(targetRoot, candidate) {
  const root = targetRoot.endsWith('/') ? targetRoot : `${targetRoot}/`;
  const resolved = candidate.startsWith('/') ? candidate : `/${candidate}`;
  return candidate === targetRoot || resolved.startsWith(root);
}
