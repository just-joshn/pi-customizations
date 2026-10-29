import { NOTEPAD_APP, PARITY_ROOT, REPO_ROOT, TARGETS } from './paths.mjs';

const REPLACEMENTS = [
  [REPO_ROOT, '$REPO'],
  [PARITY_ROOT, '$PARITY'],
  [TARGETS, '$TARGETS'],
  [NOTEPAD_APP, '$NOTEPAD'],
];

const rewriteString = (text) => {
  let next = text;
  for (const [from, to] of REPLACEMENTS) {
    if (from && next.includes(from)) next = next.split(from).join(to);
  }
  return next;
};

const walk = (value) => {
  if (typeof value === 'string') return rewriteString(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = walk(nested);
  }
  return out;
};

const DROP_ALWAYS = new Set(['evidence_id', 'caller_input_path', 'relationship_coverage', 'run_id']);

const EVIDENCE_ID_RE = /^ev_[0-9a-f]{64}$/i;
const COMPARISON_ID_RE = /^(?:mmc|javc)_[0-9a-f]{64}$/i;
const GRAPH_ID_RE = /^(?:art|agm|aex|occ|ai|aio|ais|edge|dsf|dsc|dsp|dsr|dso|aap|jag|jag_node|jag_edge|jag_observation|jesc|jesc_change|javc_item|stbc|stbc_item)_[0-9a-f]{64}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const VOLATILE_HEX_KEYS = new Set([
  'files_sha256',
  'graph_sha256',
  'inventory_graph_sha256',
  'left_manifest_id',
  'right_manifest_id',
  'manifest_id',
  'root_artifact_id',
  'extraction_id',
  'source_manifest_id',
  'artifact_id',
  'snapshot_sha256',
  'inspection_id',
  'observation_id',
  'substep_id',
  'edge_id',
]);
const OUTPUT_ROOT_RE = /(?:\/private)?\/var\/folders\/[^/]+\/[^/]+\/T\/(?:pi-rea|rea)-extracted-[^/]+/g;

const scrubIdentityValue = (key, value, parentKey = '') => {
  if (typeof value !== 'string') return value;
  const withoutTempRoot = value.replace(OUTPUT_ROOT_RE, '$OUTPUT_ROOT');
  if (key === 'evidence_id' || key === 'left_evidence_id' || key === 'right_evidence_id' || EVIDENCE_ID_RE.test(withoutTempRoot)) {
    return '$EVIDENCE_ID';
  }
  if (key === 'comparison_id' || COMPARISON_ID_RE.test(withoutTempRoot)) {
    return '$COMPARISON_ID';
  }
  if (key === 'projection_id' || GRAPH_ID_RE.test(withoutTempRoot) || (VOLATILE_HEX_KEYS.has(key) && HEX64_RE.test(withoutTempRoot))) {
    return '$GRAPH_ID';
  }
  if (key === 'sha256' && parentKey === 'digest' && HEX64_RE.test(withoutTempRoot)) {
    return '$GRAPH_ID';
  }
  if (key === 'version' && parentKey === 'engine') {
    return '$SQLITE_VERSION';
  }
  return withoutTempRoot;
};

const NESTED_DROP_KEYS = new Set(['caller_input_path', 'relationship_coverage', 'run_id']);

const scrubIdentityTree = (value, key = '', parentKey = '') => {
  if (typeof value === 'string') return scrubIdentityValue(key, value, parentKey);
  if (Array.isArray(value)) {
    if (key === 'constraints') {
      return value.map((entry) => {
        if (entry !== null && typeof entry === 'object' && !Array.isArray(entry) && entry.control === 'node.parent_heap') {
          return scrubIdentityTree({ ...entry, value: '$PARENT_HEAP' }, '', key);
        }
        return scrubIdentityTree(entry, '', key);
      });
    }
    const childKey = key === 'evidence_links' || key.endsWith('_evidence_ids') ? 'evidence_id' : '';
    return value.map((entry) => scrubIdentityTree(entry, childKey, key));
  }
  if (value === null || typeof value !== 'object') return value;
  if (key === 'provider') {
    return { id: '$PROVIDER', name: '$PROVIDER_NAME', version: null };
  }
  const out = {};
  for (const [nestedKey, nested] of Object.entries(value)) {
    if (NESTED_DROP_KEYS.has(nestedKey)) continue;
    if (nestedKey === 'provenance' && key === 'normalized_result') continue;
    out[nestedKey] = scrubIdentityTree(nested, nestedKey, key);
  }
  return out;
};

const comparisonItemSortKey = (item) => {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return '';
  const match = item.match !== null && typeof item.match === 'object' && !Array.isArray(item.match) ? item.match : {};
  return JSON.stringify({
    status: item.status ?? null,
    node_kind: item.node_kind ?? null,
    dimensions: item.dimensions ?? [],
    limitations: item.limitations ?? [],
    match: {
      status: match.status ?? null,
      basis: match.basis ?? null,
      confidence: match.confidence ?? null,
    },
    has_left: item.left_node_id !== null && item.left_node_id !== undefined,
    has_right: item.right_node_id !== null && item.right_node_id !== undefined,
  });
};

const sortComparisonItems = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const nr = value.normalized_result;
  if (nr === null || typeof nr !== 'object' || Array.isArray(nr) || !Array.isArray(nr.items)) return value;
  return {
    ...value,
    normalized_result: {
      ...nr,
      items: [...nr.items].sort((left, right) => comparisonItemSortKey(left).localeCompare(comparisonItemSortKey(right))),
    },
  };
};

const graphNodeSortKey = (node) => {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return '';
  const identity = node.identity !== null && typeof node.identity === 'object' && !Array.isArray(node.identity) ? node.identity : {};
  const observations = Array.isArray(node.observations) ? node.observations : [];
  const labels = observations.map((observation) => (observation !== null && typeof observation === 'object' && !Array.isArray(observation) ? (observation.label ?? null) : null));
  return JSON.stringify({
    kind: node.kind ?? null,
    strategy: identity.strategy ?? null,
    stability: identity.stability ?? null,
    namespace: identity.namespace ?? null,
    key: identity.key ?? null,
    labels,
  });
};

const graphEdgeSortKey = (edge) => {
  if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) return '';
  return JSON.stringify({
    relation: edge.relation ?? null,
    properties: edge.properties ?? null,
    authority: edge.evidence?.authority ?? null,
    extractor: edge.evidence?.extractor?.operation ?? null,
  });
};

const sortGraphCollections = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const nr = value.normalized_result;
  if (nr === null || typeof nr !== 'object' || Array.isArray(nr)) return value;
  const graph = nr.graph;
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return value;
  const nodes = Array.isArray(graph.nodes) ? [...graph.nodes].sort((left, right) => graphNodeSortKey(left).localeCompare(graphNodeSortKey(right))) : graph.nodes;
  const edges = Array.isArray(graph.edges) ? [...graph.edges].sort((left, right) => graphEdgeSortKey(left).localeCompare(graphEdgeSortKey(right))) : graph.edges;
  return {
    ...value,
    normalized_result: {
      ...nr,
      graph: {
        ...graph,
        nodes,
        edges,
      },
    },
  };
};

const dropVolatile = (record) => {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return record;
  const { evidence_id: _id, caller_input_path: _c, relationship_coverage: _r, ...rest } = record;
  return sortGraphCollections(sortComparisonItems(scrubIdentityTree(rest)));
};

export const normalizeForCompare = (kind, body) => {
  const rewritten = walk(body);
  if (kind === 'evidence' || kind === 'configuration') return dropVolatile(rewritten);
  if (kind === 'error') {
    const { message, remediation, details, ...rest } = rewritten;
    return {
      ...rest,
      message: typeof message === 'string' ? message.replace(/\s+/g, ' ').trim() : message,
      remediation: remediation === undefined ? undefined : walk(remediation),
      details: details === undefined ? undefined : scrubErrorDetails(details),
    };
  }
  return rewritten;
};

const scrubErrorDetails = (details) => {
  if (details === null || typeof details !== 'object') return details;
  return scrubIdentityTree(details);
};

export const VOLATILE_FIELDS = [...DROP_ALWAYS, 'provider', 'normalized_result.provenance', 'evidence_links', 'comparison_id', 'left_evidence_id', 'right_evidence_id'];
