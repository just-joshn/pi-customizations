import { evidenceId, nodeId, observationId } from './canonical.mjs';

export const PROVIDER = Object.freeze({ id: 'pi-rea', name: 'pi reverse-engineer-anything', version: '1' });

/** Envelope confidence vocabulary, taken from the reference envelopes. */
export const CONFIDENCE = new Set(['derived', 'observed', 'inferred', 'unknown']);
/** Observation confidence vocabulary, taken from the reference observations. */
export const OBSERVATION_CONFIDENCE = new Set(['low', 'medium', 'high', 'exact']);
/** Envelope authority vocabulary, taken from the reference envelopes. */
export const AUTHORITY = new Set(['shipped-artifact', 'runtime-observation', 'user-supplied', 'artifact-bytes', 'ast-static-analysis', 'static-relationship-inference', 'toolchain-observation']);
/** Per-observation evidence authority vocabulary, taken from the reference observations. */
export const EVIDENCE_AUTHORITY = new Set(['artifact-bytes', 'ast-static-analysis', 'static-relationship-inference', 'runtime-observation', 'toolchain-observation', 'user-supplied']);
/** Observation state. Static syntax is `inferred`; only a run target is `observed`. */
export const STATE = Object.freeze({ observed: 'observed', inferred: 'inferred', unknown: 'unknown' });
export const COVERAGE_STATUS = new Set(['complete', 'partial', 'unavailable']);

/**
 * Coverage block. A truncated result must say how much was omitted, so a caller
 * can never read "no more data" as "nothing else exists".
 */
export function coverage({ status, truncated = false, omittedCount = null, limits = [] }) {
  if (!COVERAGE_STATUS.has(status)) throw new Error(`unknown coverage status: ${status}`);
  if (truncated && !Number.isInteger(omittedCount)) throw new Error('truncated coverage requires an integer omittedCount');
  if (!Array.isArray(limits)) throw new Error('coverage limits must be an array');
  return { status, truncated, omitted_count: omittedCount, limits: [...limits] };
}

export function artifactRef({ available, sha256, artifactId = null, logicalPath = null, bytes = null, unpacked = null }) {
  return {
    available,
    artifact_id: artifactId ?? (sha256 ? `art_${sha256}` : null),
    sha256,
    ...(logicalPath === null ? {} : { logical_path: logicalPath }),
    ...(bytes === null ? {} : { bytes }),
    ...(unpacked === null ? {} : { unpacked }),
  };
}

export const DEFAULT_EXTRACTOR = Object.freeze({ executable_sha256: null });

/**
 * One observation with its own provenance. Properties without evidence are what
 * let inference masquerade as observation, so every observation carries
 * authority, state, confidence, artifact, location, extractor and coverage.
 */
export function observation({ prefix = 'jag', label, properties, authority, state, confidence, artifact, location, extractor, coverage: resultCoverage, limitations = [], evidenceIds = [] }) {
  if (!EVIDENCE_AUTHORITY.has(authority)) throw new Error(`unknown evidence authority: ${authority}`);
  if (!Object.values(STATE).includes(state)) throw new Error(`unknown state: ${state}`);
  if (!OBSERVATION_CONFIDENCE.has(confidence)) throw new Error(`unknown observation confidence: ${confidence}`);
  if (!resultCoverage || typeof resultCoverage !== 'object') throw new Error('an observation requires coverage');
  return {
    label,
    properties,
    evidence: {
      authority,
      state,
      confidence,
      artifact,
      location,
      extractor: { ...DEFAULT_EXTRACTOR, ...extractor },
      coverage: resultCoverage,
      limitations: [...limitations],
      evidence_ids: [...evidenceIds],
    },
    observation_id: observationId(prefix, { label, properties }),
    identifier_strategy: { strategy: 'semantic-content-sha256', stability: 'observation-exact' },
  };
}

export function createEnvelope({
  operation,
  predicateType,
  subject,
  parameters = {},
  normalizedResult,
  confidence = 'derived',
  authority = 'shipped-artifact',
  limitations,
  locations,
  evidenceLinks = [],
  environment = null,
  analysisProfile = null,
  rawResult = null,
  provider = PROVIDER,
}) {
  if (!CONFIDENCE.has(confidence)) throw new Error(`unknown confidence: ${confidence}`);
  if (!AUTHORITY.has(authority)) throw new Error(`unknown authority: ${authority}`);
  if (!Array.isArray(limitations)) throw new Error('an envelope must state its limitations, even when there are none');
  if (!Array.isArray(locations)) throw new Error('an envelope must carry its locations, even when there are none');
  if (!subject?.digest?.sha256) throw new Error('an envelope requires a subject digest');
  return {
    evidence_id: evidenceId({
      operation,
      parameters,
      subjectSha256: subject.digest.sha256,
      normalizedResult,
    }),
    subject,
    provider,
    analysis_profile: analysisProfile,
    predicate_type: predicateType,
    operation,
    parameters,
    raw_result: rawResult,
    normalized_result: normalizedResult,
    confidence,
    authority,
    environment,
    limitations: [...limitations],
    locations: [...locations],
    evidence_links: [...evidenceLinks],
  };
}

/** A node in an evidence graph: identity is artifact-local, observations carry content IDs. */
export function graphNode({ prefix = 'jag', kind, identity, observations = [] }) {
  return {
    node_id: nodeId(prefix, { kind, key: identity.key, artifact_sha256: identity.artifact_sha256 ?? null }),
    kind,
    identity: { stability: 'artifact-version', ...identity },
    observations: observations.map((item) => observation({ prefix, ...item })),
  };
}

export function graphEdge({ source, target, relation, properties = {}, evidence = null }) {
  return { source_node_id: source, target_node_id: target, relation, properties, ...(evidence ? { evidence } : {}) };
}
