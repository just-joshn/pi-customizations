import { invalidRequest } from '../contract/errors.ts';
import type { EvidenceRecord } from '../session/evidence.ts';
import { canonicalJson, digestOf, sha256Hex } from './canonical.mjs';
import { edgeEvidence, graphEdge } from './envelope.mjs';

export interface ApplicationVersionCompareInspection {
  readonly comparison_id: string;
  readonly left: SideRef;
  readonly right: SideRef;
  readonly summary: {
    readonly unchanged: number;
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly unknown: number;
  };
  readonly matching: {
    readonly exact_node_identity: number;
    readonly exact_content_digest: number;
    readonly exact_module_source_digest: number;
    readonly source_map_identity: number;
    readonly structural_fingerprint: number;
    readonly semantic_key: number;
    readonly ambiguous: number;
    readonly unmatched: number;
  };
  readonly items: readonly VersionItem[];
  readonly graph: Record<string, unknown>;
  readonly coverage: {
    readonly left_graph_status: string;
    readonly right_graph_status: string;
    readonly left_graph_omitted_count: number;
    readonly right_graph_omitted_count: number;
    readonly status: 'complete-within-inputs' | 'partial';
  };
  readonly limitations: readonly string[];
  readonly evidence_links: readonly string[];
}

interface SideRef {
  readonly evidence_id: string;
  readonly graph_id: string;
  readonly root_artifact_sha256: string;
}

interface VersionItem {
  readonly item_id: string;
  readonly node_kind: string;
  readonly dimensions: readonly string[];
  readonly evidence_links: readonly string[];
  readonly limitations: readonly string[];
  readonly status: 'unchanged' | 'added' | 'removed' | 'changed' | 'unknown';
  readonly left_node_id: string | null;
  readonly right_node_id: string | null;
  readonly match: {
    readonly status: string;
    readonly basis: string;
    readonly confidence: string;
    readonly candidate_left_node_ids: readonly string[];
    readonly candidate_right_node_ids: readonly string[];
  };
}

interface IndexedNode {
  readonly node_id: string;
  readonly kind: string;
  readonly identityStrategy: string | null;
  readonly contentDigest: string | null;
  readonly moduleSourceDigest: string | null;
  readonly semanticKey: string | null;
  readonly fingerprint: string;
}

interface GraphView {
  readonly side: SideRef;
  readonly nodes: IndexedNode[];
  readonly rawNodes: readonly Record<string, unknown>[];
  readonly rawEdges: readonly Record<string, unknown>[];
  readonly rootNodeIds: readonly string[];
  readonly graphLimitations: readonly string[];
  readonly coverageStatus: string;
  readonly coverageTruncated: boolean;
  readonly coverageLimits: readonly Record<string, unknown>[];
  readonly omittedCount: number;
}

const RESULT_LIMITATIONS = [
  'Application comparison never uses bundler module ordinals as persistent identity and performs no fuzzy pairing.',
  'Exact digest equality proves byte identity only; source-map, structural-fingerprint, and semantic-key matches retain inferred confidence.',
  'Minified names and chunk locations are not assumed stable across versions.',
  'Native Evidence is linked only by exact subject digest; provider snapshot reuse remains target/provider/profile exact.',
  'The comparison reads retained graphs and Evidence only; it does not execute either application.',
] as const;

const RELATIONSHIP_LIMITATION =
  'Relationship target identity remains unresolved; equal node kinds do not establish cross-version alignment.';

const SEMANTIC_KEY_LIMITATION =
  'Semantic-key pairing is a deterministic inference and is never promoted to exact identity.';

const BASIS_TO_MATCHING_KEY = {
  'exact-node-identity': 'exact_node_identity',
  'exact-content-digest': 'exact_content_digest',
  'exact-module-source-digest': 'exact_module_source_digest',
  'source-map-identity': 'source_map_identity',
  'structural-fingerprint': 'structural_fingerprint',
  'semantic-key': 'semantic_key',
} as const;

type MatchBasis = keyof typeof BASIS_TO_MATCHING_KEY;

const asJsEvidence = (value: unknown, label: string): EvidenceRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest(`compare_application_versions ${label} must be an Evidence object.`, {
      operation: 'compare_application_versions',
      parameter: label,
    });
  }
  const record = value as EvidenceRecord;
  if (typeof record.evidence_id !== 'string' || !record.evidence_id.startsWith('ev_')) {
    throw invalidRequest(`compare_application_versions ${label} must carry an evidence_id.`, {
      operation: 'compare_application_versions',
      parameter: label,
    });
  }
  if (record.operation !== 'analyze_javascript_application') {
    throw invalidRequest(`compare_application_versions ${label} must be analyze_javascript_application Evidence.`, {
      operation: 'compare_application_versions',
      parameter: label,
      observed_operation: record.operation,
    });
  }
  return record;
};

const graphCoverage = (graph: Record<string, unknown>): { status: string; omitted: number } => {
  const coverage = (graph['coverage'] as Record<string, unknown> | undefined) ?? {};
  return {
    status: typeof coverage['status'] === 'string' ? coverage['status'] : 'unknown',
    omitted: typeof coverage['omitted_count'] === 'number' ? coverage['omitted_count'] : 0,
  };
};

const indexGraph = (record: EvidenceRecord): GraphView => {
  const nr = record.normalized_result as Record<string, unknown> | null;
  if (nr === null || typeof nr !== 'object') {
    throw invalidRequest('compare_application_versions Evidence has no normalized_result.', {
      operation: 'compare_application_versions',
      evidence_id: record.evidence_id,
    });
  }
  const graph = (nr['graph'] as Record<string, unknown> | undefined) ?? {};
  const nodesRaw = Array.isArray(graph['nodes']) ? (graph['nodes'] as Record<string, unknown>[]) : [];
  const edgesRaw = Array.isArray(graph['edges']) ? (graph['edges'] as Record<string, unknown>[]) : [];
  const rootIds = Array.isArray(graph['root_node_ids'])
    ? (graph['root_node_ids'] as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  const graphLimitations = Array.isArray(graph['limitations'])
    ? (graph['limitations'] as unknown[]).filter((row): row is string => typeof row === 'string')
    : [];
  const coverageBlock = (graph['coverage'] as Record<string, unknown> | undefined) ?? {};
  const coverageLimits = Array.isArray(coverageBlock['limits'])
    ? (coverageBlock['limits'] as Record<string, unknown>[])
    : [];
  const root = typeof nr['root_artifact_sha256'] === 'string' ? nr['root_artifact_sha256'] : digestOf(record.evidence_id);
  const graphId = typeof graph['graph_id'] === 'string' ? graph['graph_id'] : `jag_${digestOf(record.evidence_id)}`;
  const coverage = graphCoverage(graph);
  const nodes = nodesRaw.map((node) => {
    const identity = (node['identity'] as Record<string, unknown> | undefined) ?? {};
    const observations = Array.isArray(node['observations']) ? (node['observations'] as Record<string, unknown>[]) : [];
    const first = (observations[0]?.['properties'] as Record<string, unknown> | undefined) ?? {};
    const artifact =
      ((observations[0]?.['evidence'] as Record<string, unknown> | undefined)?.['artifact'] as Record<string, unknown> | undefined) ??
      {};
    const contentDigest =
      typeof identity['sha256'] === 'string'
        ? identity['sha256']
        : typeof artifact['sha256'] === 'string'
          ? (artifact['sha256'] as string)
          : typeof identity['artifact_sha256'] === 'string'
            ? (identity['artifact_sha256'] as string)
            : null;
    const moduleSourceDigest =
      typeof first['module_source_digest'] === 'string' ? first['module_source_digest'] : null;
    const pathKey = typeof first['path'] === 'string' ? first['path'] : null;
    const semanticKey =
      typeof identity['namespace'] === 'string' && identity['key'] !== undefined
        ? `${identity['namespace']}:${typeof identity['key'] === 'string' ? identity['key'] : JSON.stringify(identity['key'])}`
        : pathKey;
    return {
      node_id: String(node['node_id'] ?? ''),
      kind: String(node['kind'] ?? 'unknown'),
      identityStrategy: typeof identity['strategy'] === 'string' ? identity['strategy'] : null,
      contentDigest,
      moduleSourceDigest: typeof moduleSourceDigest === 'string' ? moduleSourceDigest : null,
      semanticKey,
      fingerprint: digestOf(JSON.stringify({ kind: node['kind'], identity, properties: first })),
    };
  });
  return {
    side: { evidence_id: record.evidence_id, graph_id: graphId, root_artifact_sha256: root },
    nodes,
    rawNodes: nodesRaw,
    rawEdges: edgesRaw,
    rootNodeIds: rootIds,
    graphLimitations,
    coverageStatus: coverage.status,
    coverageTruncated: coverageBlock['truncated'] === true,
    coverageLimits,
    omittedCount: coverage.omitted,
  };
};

const uniqueIndex = (nodes: IndexedNode[], keyOf: (node: IndexedNode) => string | null): Map<string, IndexedNode> => {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = keyOf(node);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out = new Map<string, IndexedNode>();
  for (const node of nodes) {
    const key = keyOf(node);
    if (key === null || counts.get(key) !== 1) continue;
    out.set(key, node);
  }
  return out;
};

const matchConfidence = (basis: MatchBasis): string => {
  if (basis === 'semantic-key' || basis === 'structural-fingerprint' || basis === 'source-map-identity') return 'medium';
  return 'exact';
};

const emptyCandidates = {
  candidate_left_node_ids: [] as const,
  candidate_right_node_ids: [] as const,
};

const neighborIds = (edges: readonly Record<string, unknown>[], nodeId: string): Set<string> => {
  const out = new Set<string>();
  for (const edge of edges) {
    if (edge['relation'] === 'changed_from') continue;
    const source = edge['source_node_id'];
    const target = edge['target_node_id'];
    if (source === nodeId && typeof target === 'string') out.add(target);
    if (target === nodeId && typeof source === 'string') out.add(source);
  }
  return out;
};

export const compareApplicationVersions = (params: { readonly left: unknown; readonly right: unknown }): ApplicationVersionCompareInspection => {
  const leftRecord = asJsEvidence(params.left, 'left');
  const rightRecord = asJsEvidence(params.right, 'right');
  if (leftRecord.evidence_id === rightRecord.evidence_id) {
    throw invalidRequest('Application version Evidence must be distinct', {
      operation: 'compare_application_versions',
      parameter: 'right',
    });
  }
  const left = indexGraph(leftRecord);
  const right = indexGraph(rightRecord);

  const matching = {
    exact_node_identity: 0,
    exact_content_digest: 0,
    exact_module_source_digest: 0,
    source_map_identity: 0,
    structural_fingerprint: 0,
    semantic_key: 0,
    ambiguous: 0,
    unmatched: 0,
  };

  const leftRemaining = new Map(left.nodes.map((node) => [node.node_id, node]));
  const rightRemaining = new Map(right.nodes.map((node) => [node.node_id, node]));
  const pairs: { left: IndexedNode; right: IndexedNode; basis: MatchBasis }[] = [];

  const applyTier = (basis: MatchBasis, keyOf: (node: IndexedNode) => string | null): void => {
    const leftIndex = uniqueIndex([...leftRemaining.values()], keyOf);
    const rightIndex = uniqueIndex([...rightRemaining.values()], keyOf);
    for (const [key, leftNode] of leftIndex) {
      const rightNode = rightIndex.get(key);
      if (rightNode === undefined) continue;
      if (!leftRemaining.has(leftNode.node_id) || !rightRemaining.has(rightNode.node_id)) continue;
      leftRemaining.delete(leftNode.node_id);
      rightRemaining.delete(rightNode.node_id);
      pairs.push({ left: leftNode, right: rightNode, basis });
      matching[BASIS_TO_MATCHING_KEY[basis]] += 1;
    }
  };

  applyTier('exact-node-identity', (node) =>
    node.identityStrategy === 'artifact-local-key' ? node.node_id : null,
  );
  applyTier('exact-content-digest', (node) => node.contentDigest);
  applyTier('exact-module-source-digest', (node) => node.moduleSourceDigest);
  applyTier('structural-fingerprint', (node) => node.fingerprint);
  applyTier('semantic-key', (node) => (node.kind === 'javascript-asset' || node.kind === 'source-map' ? node.semanticKey : null));

  const retainedEdges = [...left.rawEdges, ...right.rawEdges];
  const matchedIds = new Set(pairs.flatMap((pair) => [pair.left.node_id, pair.right.node_id]));

  const items: VersionItem[] = [];
  let unchanged = 0;
  let changed = 0;
  let added = 0;
  let removed = 0;
  let unknown = 0;

  for (const pair of pairs) {
    const confidence = matchConfidence(pair.basis);
    const sameFingerprint = pair.left.fingerprint === pair.right.fingerprint;
    const neighbors = new Set([
      ...neighborIds(retainedEdges, pair.left.node_id),
      ...neighborIds(retainedEdges, pair.right.node_id),
    ]);
    const unresolvedNeighbor = [...neighbors].some((id) => !matchedIds.has(id));

    let status: VersionItem['status'];
    let dimensions: string[];
    let limitations: string[];

    if (pair.basis === 'semantic-key') {
      status = sameFingerprint ? 'unchanged' : 'changed';
      dimensions = sameFingerprint ? [] : ['content', 'properties'];
      limitations = sameFingerprint ? [] : [SEMANTIC_KEY_LIMITATION, RELATIONSHIP_LIMITATION];
    } else if (unresolvedNeighbor) {
      status = 'unknown';
      dimensions = [];
      limitations = [RELATIONSHIP_LIMITATION];
    } else {
      status = 'unchanged';
      dimensions = [];
      limitations = [];
    }

    if (status === 'unchanged') unchanged += 1;
    else if (status === 'changed') changed += 1;
    else if (status === 'unknown') unknown += 1;

    items.push({
      item_id: `javc_item_${digestOf(`${pair.left.node_id}:${pair.right.node_id}`)}`,
      node_kind: pair.left.kind,
      dimensions,
      evidence_links: [left.side.evidence_id, right.side.evidence_id],
      limitations,
      status,
      left_node_id: pair.left.node_id,
      right_node_id: pair.right.node_id,
      match: {
        status: 'matched',
        basis: pair.basis,
        confidence,
        ...emptyCandidates,
      },
    });
  }

  for (const node of leftRemaining.values()) {
    removed += 1;
    matching.unmatched += 1;
    items.push({
      item_id: `javc_item_${digestOf(`removed:${node.node_id}`)}`,
      node_kind: node.kind,
      dimensions: ['availability'],
      evidence_links: [left.side.evidence_id, right.side.evidence_id],
      limitations: [],
      status: 'removed',
      left_node_id: node.node_id,
      right_node_id: null,
      match: { status: 'unmatched', basis: 'none', confidence: 'unknown', ...emptyCandidates },
    });
  }
  for (const node of rightRemaining.values()) {
    added += 1;
    matching.unmatched += 1;
    items.push({
      item_id: `javc_item_${digestOf(`added:${node.node_id}`)}`,
      node_kind: node.kind,
      dimensions: ['availability'],
      evidence_links: [left.side.evidence_id, right.side.evidence_id],
      limitations: [],
      status: 'added',
      left_node_id: null,
      right_node_id: node.node_id,
      match: { status: 'unmatched', basis: 'none', confidence: 'unknown', ...emptyCandidates },
    });
  }

  const coverageComplete = left.coverageStatus === 'complete' && right.coverageStatus === 'complete';
  const sortedItems = items.sort((a, b) => (a.item_id < b.item_id ? -1 : 1));
  const graph = buildChangeGraph({
    left,
    right,
    items: sortedItems,
  });

  return {
    comparison_id: `javc_${digestOf(`${left.side.evidence_id}:${right.side.evidence_id}`)}`,
    left: left.side,
    right: right.side,
    summary: { unchanged, added, removed, changed, unknown },
    matching,
    items: sortedItems,
    graph,
    coverage: {
      left_graph_status: left.coverageStatus,
      right_graph_status: right.coverageStatus,
      left_graph_omitted_count: left.omittedCount,
      right_graph_omitted_count: right.omittedCount,
      status: coverageComplete ? 'complete-within-inputs' : 'partial',
    },
    limitations: [...RESULT_LIMITATIONS],
    evidence_links: [left.side.evidence_id, right.side.evidence_id],
  };
};

const uniqueSortedStrings = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

const uniqueEdgesById = (edges: readonly Record<string, unknown>[]): Record<string, unknown>[] =>
  [...new Map(edges.map((edge) => [String(edge['edge_id'] ?? ''), edge])).values()].sort((left, right) =>
    String(left['edge_id'] ?? '') < String(right['edge_id'] ?? '') ? -1 : 1,
  );

const mergeNodesById = (nodes: readonly Record<string, unknown>[]): Record<string, unknown>[] => {
  const byId = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    const id = String(node['node_id'] ?? '');
    if (id.length === 0) continue;
    const existing = byId.get(id);
    if (existing === undefined) {
      byId.set(id, {
        ...node,
        observations: Array.isArray(node['observations']) ? [...(node['observations'] as unknown[])] : [],
      });
      continue;
    }
    const observations = new Map<string, unknown>();
    for (const observation of [
      ...(Array.isArray(existing['observations']) ? (existing['observations'] as Record<string, unknown>[]) : []),
      ...(Array.isArray(node['observations']) ? (node['observations'] as Record<string, unknown>[]) : []),
    ]) {
      const observationId = String(observation['observation_id'] ?? '');
      if (observationId.length === 0) continue;
      observations.set(observationId, observation);
    }
    byId.set(id, {
      ...existing,
      observations: [...observations.values()].sort((left, right) =>
        String((left as Record<string, unknown>)['observation_id'] ?? '') <
        string((right as Record<string, unknown>)['observation_id'] ?? '')
          ? -1
          : 1,
      ),
    });
  }
  return [...byId.values()].sort((left, right) =>
    String(left['node_id'] ?? '') < String(right['node_id'] ?? '') ? -1 : 1,
  );
};

const buildChangeGraph = ({
  left,
  right,
  items,
}: {
  left: GraphView;
  right: GraphView;
  items: readonly VersionItem[];
}): Record<string, unknown> => {
  const required = new Set<string>([
    ...left.rootNodeIds,
    ...right.rootNodeIds,
    ...items.flatMap((item) => [item.left_node_id, item.right_node_id].filter((id): id is string => id !== null)),
  ]);
  const mergedNodes = mergeNodesById(
    [...left.rawNodes, ...right.rawNodes].filter((node) => required.has(String(node['node_id'] ?? ''))),
  );
  const retained = new Set(mergedNodes.map((node) => String(node['node_id'] ?? '')));
  const preferredRoots = uniqueSortedStrings([...right.rootNodeIds, ...left.rootNodeIds]).filter((id) =>
    retained.has(id),
  );
  const sourceEdges = uniqueEdgesById([...left.rawEdges, ...right.rawEdges]).filter(
    (edge) => retained.has(String(edge['source_node_id'] ?? '')) && retained.has(String(edge['target_node_id'] ?? '')),
  );
  const leftById = new Map(left.rawNodes.map((node) => [String(node['node_id'] ?? ''), node]));
  const rightById = new Map(right.rawNodes.map((node) => [String(node['node_id'] ?? ''), node]));
  const comparisonEdges = items.flatMap((item) =>
    changedFromEdge(item, left, right, retained, leftById, rightById),
  );
  const edges = uniqueEdgesById([...sourceEdges, ...comparisonEdges]);
  const rootNodeIds =
    preferredRoots.length > 0 ? preferredRoots : mergedNodes[0] === undefined ? [] : [String(mergedNodes[0]['node_id'])];
  const coverage =
    left.coverageStatus === 'complete' && right.coverageStatus === 'complete'
      ? { status: 'complete', truncated: false, omitted_count: 0, limits: mergeCoverageLimits(left, right) }
      : {
          status: 'partial',
          truncated: left.coverageTruncated || right.coverageTruncated,
          omitted_count:
            left.omittedCount === null || right.omittedCount === null ? null : left.omittedCount + right.omittedCount,
          limits: mergeCoverageLimits(left, right),
        };
  const limitations = uniqueSortedStrings([
    ...left.graphLimitations.map((value) => `Left: ${value}`),
    ...right.graphLimitations.map((value) => `Right: ${value}`),
    'changed_from edges are cross-version inferences and never promote structural or semantic matches to exact identity.',
    'The change graph contains compared entities and their retained relationships; it is not an executable application.',
  ]);
  const content = {
    schema: 'JavaScriptApplicationGraph',
    root_node_ids: rootNodeIds,
    nodes: mergedNodes,
    edges,
    coverage,
    limitations,
  };
  return { ...content, graph_id: `jag_${sha256Hex(canonicalJson(content))}` };
};

const mergeCoverageLimits = (left: GraphView, right: GraphView): Record<string, unknown>[] => {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const limit of [...left.coverageLimits, ...right.coverageLimits]) {
    const key = `${String(limit['name'] ?? '')}\0${String(limit['value'] ?? '')}\0${String(limit['unit'] ?? '')}`;
    byKey.set(key, limit);
  }
  return [...byKey.values()].sort((a, b) => (String(a['name'] ?? '') < String(b['name'] ?? '') ? -1 : 1));
};

const changedFromEdge = (
  item: VersionItem,
  left: GraphView,
  right: GraphView,
  retained: Set<string>,
  leftById: Map<string, Record<string, unknown>>,
  rightById: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] => {
  const leftId = item.left_node_id;
  const rightId = item.right_node_id;
  const nonLocationCoverageOnly =
    item.status === 'unknown' &&
    !item.dimensions.some((dimension) => dimension !== 'location' && dimension !== 'coverage');
  if (
    item.match.status !== 'matched' ||
    item.status === 'unchanged' ||
    nonLocationCoverageOnly ||
    leftId === null ||
    rightId === null ||
    leftId === rightId ||
    !retained.has(leftId) ||
    !retained.has(rightId)
  ) {
    return [];
  }
  const rightNode = rightById.get(rightId);
  const leftNode = leftById.get(leftId);
  const sourceObs =
    ((rightNode?.['observations'] as Record<string, unknown>[] | undefined)?.[0] as Record<string, unknown> | undefined) ??
    ((leftNode?.['observations'] as Record<string, unknown>[] | undefined)?.[0] as Record<string, unknown> | undefined);
  const sourceEvidence = (sourceObs?.['evidence'] as Record<string, unknown> | undefined) ?? {};
  const complete = left.coverageStatus === 'complete' && right.coverageStatus === 'complete';
  return [
    graphEdge({
      source: rightId,
      target: leftId,
      relation: 'changed_from',
      properties: {
        comparison_item_id: item.item_id,
        status: item.status,
        match_basis: item.match.basis,
        match_confidence: item.match.confidence,
        dimensions: item.dimensions,
      },
      evidence: edgeEvidence({
        authority: 'cross-version-comparison',
        state: 'inferred',
        confidence: item.match.confidence === 'medium' ? 'medium' : 'high',
        artifact: (sourceEvidence['artifact'] as Record<string, unknown> | undefined) ?? {
          available: false,
          reason: 'unresolved',
          detail: 'Compared node has no artifact-backed observation.',
        },
        location: (sourceEvidence['location'] as Record<string, unknown> | undefined) ?? {
          available: false,
          reason: 'unresolved',
          detail: 'Compared node has no actionable source location.',
        },
        extractor: {
          name: 'rea-application-version-comparison',
          version: '1',
          operation: 'compare_application_versions',
          executable_sha256: null,
        },
        resultCoverage: complete
          ? { status: 'complete', truncated: false, omitted_count: 0, limits: mergeCoverageLimits(left, right) }
          : {
              status: 'partial',
              truncated: left.coverageTruncated || right.coverageTruncated,
              omitted_count:
                left.omittedCount === null || right.omittedCount === null
                  ? null
                  : left.omittedCount + right.omittedCount,
              limits: mergeCoverageLimits(left, right),
            },
        limitations: [
          'Cross-version pairing is inferred from the stated match basis; changed_from does not prove runtime reachability.',
          ...item.limitations,
        ],
        evidenceIds: [left.side.evidence_id, right.side.evidence_id],
      }),
    }),
  ];
};
