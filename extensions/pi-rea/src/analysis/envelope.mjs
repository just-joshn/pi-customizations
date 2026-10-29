import { canonicalJson, evidenceId, nodeId, observationId, sha256Hex } from './canonical.mjs';

export const PROVIDER = Object.freeze({ id: 'pi-rea', name: 'pi reverse-engineer-anything', version: '1' });

export const CONFIDENCE = new Set(['derived', 'observed', 'inferred', 'unknown']);
export const OBSERVATION_CONFIDENCE = new Set(['low', 'medium', 'high', 'exact']);
export const AUTHORITY = new Set(['shipped-artifact', 'runtime-observation', 'user-supplied', 'artifact-bytes', 'ast-static-analysis', 'static-relationship-inference', 'toolchain-observation']);
export const EVIDENCE_AUTHORITY = new Set(['artifact-bytes', 'ast-static-analysis', 'static-relationship-inference', 'runtime-observation', 'toolchain-observation', 'user-supplied', 'cross-version-comparison']);
export const STATE = Object.freeze({ observed: 'observed', inferred: 'inferred', unknown: 'unknown' });
export const COVERAGE_STATUS = new Set(['complete', 'partial', 'unavailable']);

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

export function observation({
  prefix = 'jag',
  nodeIdentifier = null,
  label,
  properties,
  authority,
  state,
  confidence,
  artifact,
  location,
  extractor,
  coverage: resultCoverage,
  limitations = [],
  evidenceIds = [],
  sourceMapReference = null,
}) {
  if (!EVIDENCE_AUTHORITY.has(authority)) throw new Error(`unknown evidence authority: ${authority}`);
  if (!Object.values(STATE).includes(state)) throw new Error(`unknown state: ${state}`);
  if (!OBSERVATION_CONFIDENCE.has(confidence)) throw new Error(`unknown observation confidence: ${confidence}`);
  if (!resultCoverage || typeof resultCoverage !== 'object') throw new Error('an observation requires coverage');
  const identifierStrategy = { strategy: 'semantic-content-sha256', stability: 'observation-exact' };
  const coverageBlock = {
    ...resultCoverage,
    limits: Array.isArray(resultCoverage.limits)
      ? [...resultCoverage.limits].sort((left, right) => {
          const leftKey = canonicalJson(left);
          const rightKey = canonicalJson(right);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        })
      : [],
  };
  const semantic = {
    label,
    source_map_reference: sourceMapReference,
    properties,
    evidence: {
      authority,
      state,
      confidence,
      artifact,
      location,
      extractor: { ...DEFAULT_EXTRACTOR, ...extractor },
      coverage: coverageBlock,
      limitations: uniqueSortedStrings(limitations),
      evidence_ids: uniqueSortedStrings(evidenceIds),
    },
    identifier_strategy: identifierStrategy,
  };
  const observationKey = nodeIdentifier === null ? { label, properties } : { node_id: nodeIdentifier, ...semantic };
  return {
    ...semantic,
    observation_id: observationId(prefix, observationKey),
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

export function graphNode({ prefix = 'jag', kind, identity, observations = [] }) {
  const resolvedIdentity = { stability: 'artifact-version', ...identity };
  const identifier = nodeId(prefix, { kind, identity: resolvedIdentity });
  const resolvedObservations = observations.map((item) => observation({ prefix, nodeIdentifier: identifier, ...item })).sort((left, right) => (left.observation_id < right.observation_id ? -1 : 1));
  return {
    node_id: identifier,
    kind,
    identity: resolvedIdentity,
    observations: resolvedObservations,
  };
}

const uniqueSortedStrings = (values) => [...new Set(values.map((value) => String(value)))].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

export function edgeEvidence({ authority, state, confidence, artifact, location, extractor, resultCoverage = null, limitations = [], evidenceIds = [] }) {
  const coverageBlock = resultCoverage ?? coverage({ status: 'complete', omittedCount: 0 });
  return {
    authority,
    state,
    confidence,
    artifact,
    location,
    extractor: { ...DEFAULT_EXTRACTOR, ...extractor },
    coverage: {
      ...coverageBlock,
      limits: Array.isArray(coverageBlock.limits)
        ? [...coverageBlock.limits].sort((left, right) => {
            const leftKey = canonicalJson(left);
            const rightKey = canonicalJson(right);
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
          })
        : [],
    },
    limitations: uniqueSortedStrings(limitations),
    evidence_ids: uniqueSortedStrings(evidenceIds),
  };
}

export function graphEdge({ source, target, relation, properties = {}, evidence = null, prefix = 'jag', edgeId = null }) {
  const identifierStrategy = { strategy: 'semantic-content-sha256', stability: 'relationship-exact' };
  const normalizedEvidence =
    evidence === null
      ? null
      : edgeEvidence({
          authority: evidence.authority,
          state: evidence.state,
          confidence: evidence.confidence,
          artifact: evidence.artifact,
          location: evidence.location,
          extractor: evidence.extractor,
          resultCoverage: evidence.coverage,
          limitations: evidence.limitations ?? [],
          evidenceIds: evidence.evidence_ids ?? [],
        });
  const semantic = {
    source_node_id: source,
    target_node_id: target,
    relation,
    properties,
    ...(normalizedEvidence ? { evidence: normalizedEvidence } : {}),
    identifier_strategy: identifierStrategy,
  };
  return {
    ...semantic,
    edge_id: edgeId ?? `${prefix}_edge_${sha256Hex(canonicalJson(semantic))}`,
  };
}
