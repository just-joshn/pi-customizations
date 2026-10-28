
import { posix } from 'node:path';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { canonicalJson, digestOf } from './canonical.mjs';
import { invalidRequest } from '../contract/errors.ts';
import type { EvidenceRecord } from '../session/evidence.ts';

const SOURCE_TO_BUNDLE_SIGNAL_WEIGHTS = [
  ['exact-source-digest', 100],
  ['source-map-original-path', 70],
  ['current-path-exact', 60],
  ['current-path-suffix', 40],
  ['unicode-equivalent-path', 20],
  ['basename-match', 20],
  ['language-extension', 5],
] as const;

type SignalKind = (typeof SOURCE_TO_BUNDLE_SIGNAL_WEIGHTS)[number][0];

const RELEVANT_NODE_KINDS = new Set(['artifact', 'javascript-asset', 'javascript-module', 'source-module']);

const PATH_PROPERTIES = ['path', 'source', 'original_source', 'module_path', 'resolved_path', 'declared_path'] as const;

const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//iu;
const SCHEME_URL_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/+/iu;

interface SourceEntry {
  readonly path: string;
  readonly sha256: string | null;
  readonly language: string | null;
  readonly limitations: readonly string[];
}

interface FileOccurrence {
  readonly container_sha256: string;
  readonly path: string;
  readonly sha256: string;
}

interface PathFact {
  readonly kind: string;
  readonly value: string;
  readonly allowSuffix: boolean;
}

interface NodeProjection {
  readonly node: GraphNode;
  readonly representations: readonly string[];
  readonly digests: ReadonlySet<string>;
  readonly paths: readonly PathFact[];
  readonly occurrence?: FileOccurrence;
}

interface GraphNode {
  readonly node_id: string;
  readonly kind: string;
  readonly identity: Record<string, unknown>;
  readonly observations: readonly Record<string, unknown>[];
}

interface Signal {
  readonly kind: SignalKind;
  readonly weight: number;
  readonly source_value: string;
  readonly current_values: readonly string[];
}

interface Candidate {
  readonly current_file_occurrence?: FileOccurrence;
  readonly representation_node_ids?: readonly string[];
  readonly current_node_id: string;
  readonly current_node_kind: string;
  readonly score: number;
  readonly confidence: 'exact' | 'high' | 'medium' | 'low';
  readonly signals: readonly Signal[];
}

interface MappingItem {
  readonly mapping_id: string;
  readonly source_path: string;
  readonly source_sha256: string | null;
  readonly source_language: string | null;
  readonly status: 'unchanged' | 'modified' | 'removed' | 'split' | 'merged' | 'duplicated' | 'unknown';
  readonly confidence: 'exact' | 'high' | 'medium' | 'unknown';
  readonly current_node_ids: readonly string[];
  readonly candidates: readonly Candidate[];
  readonly limitations: readonly string[];
}

export interface SourceToBundleInspection {
  readonly comparison_id: string;
  readonly reference: { readonly root_sha256: string; readonly inventory_state: string };
  readonly application: { readonly evidence_id: string; readonly graph_id: string; readonly root_artifact_sha256: string };
  readonly scoring: {
    readonly algorithm: 'rea-source-to-bundle-signals';
    readonly minimum_candidate_score: 20;
    readonly weights: readonly { readonly signal: string; readonly weight: number }[];
  };
  readonly summary: {
    readonly unchanged: number;
    readonly modified: number;
    readonly removed: number;
    readonly split: number;
    readonly merged: number;
    readonly duplicated: number;
    readonly unknown: number;
  };
  readonly items: readonly MappingItem[];
  readonly unmapped_current_node_ids: readonly string[];
  readonly coverage: {
    readonly status: 'complete-within-inputs' | 'partial';
    readonly reference_inventory_state: string;
    readonly application_graph_status: string;
    readonly retained_source_files: number;
    readonly retained_application_nodes: number;
    readonly candidate_evaluations: number;
  };
  readonly evidence_links: readonly string[];
  readonly limitations: readonly string[];
}

const signalWeight = (kind: SignalKind): number => {
  const entry = SOURCE_TO_BUNDLE_SIGNAL_WEIGHTS.find(([signal]) => signal === kind);
  if (entry === undefined) throw new TypeError(`Missing source-to-bundle signal weight: ${kind}`);
  return entry[1];
};

const compareUnicode = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort(compareUnicode);

const compositeKey = (parts: readonly string[]): string => parts.map((part) => JSON.stringify(part)).join('\u0000');

const asJsEvidence = (value: unknown): EvidenceRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest('compare_source_to_bundle application must be an Evidence object.', {
      operation: 'compare_source_to_bundle',
      parameter: 'application',
    });
  }
  const record = value as EvidenceRecord;
  if (typeof record.evidence_id !== 'string' || !record.evidence_id.startsWith('ev_')) {
    throw invalidRequest('compare_source_to_bundle application must carry an evidence_id.', {
      operation: 'compare_source_to_bundle',
      parameter: 'application',
    });
  }
  if (record.operation !== 'analyze_javascript_application') {
    throw invalidRequest('compare_source_to_bundle application must be analyze_javascript_application Evidence.', {
      operation: 'compare_source_to_bundle',
      parameter: 'application',
      observed_operation: record.operation,
    });
  }
  return record;
};

const parseHistoricalSourceGraph = async (
  reference: unknown,
): Promise<{
  root_sha256: string;
  inventory_state: 'complete' | 'partial' | 'unknown';
  entries: SourceEntry[];
  limitations: readonly string[];
}> => {
  let value = reference;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record['kind'] === 'file' && typeof record['path'] === 'string') {
      if (!isAbsolute(record['path'])) {
        throw invalidRequest('compare_source_to_bundle reference file path must be absolute.', {
          operation: 'compare_source_to_bundle',
          parameter: 'reference',
        });
      }
      value = JSON.parse(await readFile(record['path'], 'utf8')) as unknown;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest('compare_source_to_bundle reference must be a HistoricalSourceGraph object.', {
      operation: 'compare_source_to_bundle',
      parameter: 'reference',
    });
  }
  const graph = value as Record<string, unknown>;
  if (graph['schema'] !== 'HistoricalSourceGraph') {
    throw invalidRequest('compare_source_to_bundle reference.schema must be HistoricalSourceGraph.', {
      operation: 'compare_source_to_bundle',
      parameter: 'reference',
      expected: ['HistoricalSourceGraph'],
    });
  }
  if (graph['authority'] !== 'historical-reference') {
    throw invalidRequest('compare_source_to_bundle reference.authority must be historical-reference.', {
      operation: 'compare_source_to_bundle',
      parameter: 'reference',
      expected: ['historical-reference'],
    });
  }
  if (graph['root_alias'] !== '$REFERENCE_ROOT') {
    throw invalidRequest('compare_source_to_bundle reference.root_alias must be $REFERENCE_ROOT.', {
      operation: 'compare_source_to_bundle',
      parameter: 'reference',
      expected: ['$REFERENCE_ROOT'],
    });
  }
  if (typeof graph['root_sha256'] !== 'string' || !/^[a-f0-9]{64}$/.test(graph['root_sha256'])) {
    throw invalidRequest('compare_source_to_bundle reference.root_sha256 must be a sha256 hex digest.', {
      operation: 'compare_source_to_bundle',
      parameter: 'reference',
    });
  }
  const inventoryState = graph['inventory_state'];
  if (inventoryState !== 'complete' && inventoryState !== 'partial' && inventoryState !== 'unknown') {
    throw invalidRequest('compare_source_to_bundle reference.inventory_state is invalid.', {
      operation: 'compare_source_to_bundle',
      parameter: 'reference',
      expected: ['complete', 'partial', 'unknown'],
    });
  }
  if (!Array.isArray(graph['entries']) || !Array.isArray(graph['relationships']) || !Array.isArray(graph['parse_failures'])) {
    throw invalidRequest('compare_source_to_bundle reference requires entries, relationships, and parse_failures arrays.', {
      operation: 'compare_source_to_bundle',
      parameter: 'reference',
    });
  }
  const entries: SourceEntry[] = (graph['entries'] as Record<string, unknown>[])
    .filter((entry) => entry['kind'] === 'file' && Array.isArray(entry['classifications']) && (entry['classifications'] as unknown[]).includes('source'))
    .map((entry) => ({
      path: String(entry['path'] ?? ''),
      sha256: typeof entry['sha256'] === 'string' ? entry['sha256'] : typeof entry['digest'] === 'string' ? entry['digest'] : null,
      language: typeof entry['language'] === 'string' ? entry['language'] : null,
      limitations: Array.isArray(entry['limitations']) ? (entry['limitations'] as unknown[]).map(String) : [],
    }))
    .filter((entry) => entry.path.length > 0)
    .sort((left, right) => compareUnicode(left.path, right.path));
  const limitations = Array.isArray(graph['limitations']) ? (graph['limitations'] as unknown[]).map(String) : [];
  return { root_sha256: graph['root_sha256'], inventory_state: inventoryState, entries, limitations };
};

const isDigest = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

const normalizeCurrentPath = (raw: string, format: 'artifact' | 'reference'): string | null => {
  const withoutQuery = format === 'reference' && SCHEME_URL.test(raw) ? (raw.split(/[?#]/u, 1)[0] ?? '') : raw;
  const portable = format === 'artifact' ? withoutQuery : withoutQuery.replace(SCHEME_URL_PREFIX, '').replaceAll('\\', '/');
  const parts: string[] = [];
  for (const part of portable.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length === 0 ? null : parts.join('/');
};

const uniquePaths = (paths: readonly PathFact[]): PathFact[] =>
  [
    ...new Map(paths.map((path) => [compositeKey([path.kind, path.value, String(path.allowSuffix)]), path])).values(),
  ].sort((left, right) => compareUnicode(compositeKey([left.kind, left.value]), compositeKey([right.kind, right.value])));

const addPath = (paths: PathFact[], kind: string, raw: string, format: 'artifact' | 'reference'): void => {
  const value = normalizeCurrentPath(raw, format);
  if (value !== null) paths.push({ kind, value, allowSuffix: true });
};

const projectCurrentNode = (node: GraphNode): NodeProjection => {
  const digests = new Set<string>();
  const paths: PathFact[] = [];
  const identity = node.identity;
  if (identity['strategy'] === 'content-digest' && typeof identity['sha256'] === 'string') digests.add(identity['sha256']);
  if (identity['strategy'] === 'source-map-original' && typeof identity['source_sha256'] === 'string') digests.add(identity['source_sha256']);
  if (identity['strategy'] === 'canonical-path' && typeof identity['path'] === 'string') addPath(paths, 'canonical-path', identity['path'], 'artifact');
  for (const observation of node.observations) {
    const properties = (observation['properties'] as Record<string, unknown> | undefined) ?? {};
    if (identity['strategy'] === 'source-map-original') {
      const resolution = (observation['source_map_reference'] as { resolution?: { kind: string; path: string } } | undefined)?.resolution;
      if (resolution !== undefined && resolution.kind !== 'unresolved') {
        paths.push({ kind: 'source-map-original', value: resolution.path, allowSuffix: resolution.kind === 'suffix' });
      }
      continue;
    }
    const sourceDigest = properties['source_sha256'];
    if (typeof sourceDigest === 'string' && isDigest(sourceDigest)) digests.add(sourceDigest);
    const artifact = ((observation['evidence'] as Record<string, unknown> | undefined)?.['artifact'] as Record<string, unknown> | undefined) ?? {};
    if (typeof artifact['sha256'] === 'string' && isDigest(artifact['sha256'])) digests.add(artifact['sha256']);
    if (typeof identity['artifact_sha256'] === 'string' && isDigest(identity['artifact_sha256'])) digests.add(identity['artifact_sha256']);
    for (const key of PATH_PROPERTIES) {
      if (key === 'declared_path' && typeof properties['resolved_path'] === 'string') continue;
      const raw = properties[key];
      if (typeof raw !== 'string') continue;
      const format =
        key === 'resolved_path' || ((key === 'path' || key === 'module_path') && !SCHEME_URL.test(raw)) ? 'artifact' : 'reference';
      addPath(paths, 'observation-path', raw, format);
    }
  }
  return { node, representations: [node.node_id], digests, paths: uniquePaths(paths) };
};

const fileOccurrenceKey = (occurrence: FileOccurrence): string =>
  compositeKey(['file-occurrence', occurrence.container_sha256, occurrence.path, occurrence.sha256]);

const projectionKey = (projection: NodeProjection): string =>
  projection.occurrence === undefined ? projection.node.node_id : fileOccurrenceKey(projection.occurrence);

const parseOccurrence = (value: unknown): FileOccurrence | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record['container_sha256'] !== 'string' || typeof record['path'] !== 'string' || typeof record['sha256'] !== 'string') return null;
  return { container_sha256: record['container_sha256'], path: record['path'], sha256: record['sha256'] };
};

const synthesizeOccurrence = (node: GraphNode, projected: NodeProjection, rootArtifactSha256: string | null): FileOccurrence | null => {
  const path = projected.paths.find((entry) => entry.value.length > 0)?.value;
  const sha256 = [...projected.digests][0];
  if (path === undefined || sha256 === undefined) return null;
  void node;
  const container = rootArtifactSha256 !== null ? rootArtifactSha256 : sha256;
  return { container_sha256: container, path, sha256 };
};

const projectCurrentOccurrences = (nodes: readonly GraphNode[], rootArtifactSha256: string | null): NodeProjection[] => {
  const groups = new Map<string, NodeProjection>();
  for (const node of nodes) {
    const occurrences = new Map<string, { occurrence: FileOccurrence; observations: Record<string, unknown>[] }>();
    for (const observation of node.observations) {
      const properties = (observation['properties'] as Record<string, unknown> | undefined) ?? {};
      const parsed = parseOccurrence(properties['file_occurrence']);
      if (parsed === null) continue;
      const key = fileOccurrenceKey(parsed);
      const previous = occurrences.get(key);
      if (previous === undefined) occurrences.set(key, { occurrence: parsed, observations: [observation] });
      else previous.observations.push(observation);
    }
    if (occurrences.size === 0) {
      const projected = projectCurrentNode(node);
      const synthesized = synthesizeOccurrence(node, projected, rootArtifactSha256);
      if (synthesized === null) {
        groups.set(node.node_id, projected);
        continue;
      }
      const key = fileOccurrenceKey(synthesized);
      const previous = groups.get(key);
      groups.set(key, {
        ...projected,
        occurrence: synthesized,
        node: previous?.node ?? node,
        representations: uniqueSorted([...(previous?.representations ?? []), node.node_id]),
        digests: new Set([synthesized.sha256, ...projected.digests, ...(previous?.digests ?? [])]),
        paths: uniquePaths([...projected.paths, ...(previous?.paths ?? [])]),
      });
      continue;
    }
    for (const [key, { occurrence, observations }] of occurrences) {
      const projected = projectCurrentNode({ ...node, observations });
      const previous = groups.get(key);
      groups.set(key, {
        ...projected,
        occurrence,
        node: previous?.node ?? node,
        representations: uniqueSorted([...(previous?.representations ?? []), node.node_id]),
        digests: new Set([occurrence.sha256, ...projected.digests, ...(previous?.digests ?? [])]),
        paths: uniquePaths([...projected.paths, ...(previous?.paths ?? [])]),
      });
    }
  }
  return [...groups.values()];
};

const pathSuffixes = (path: string): string[] => {
  const parts = path.split('/');
  return parts.map((_, index) => parts.slice(index).join('/'));
};

const addIndexValue = (index: Map<string, Set<string>>, key: string, nodeId: string): void => {
  const values = index.get(key) ?? new Set<string>();
  values.add(nodeId);
  index.set(key, values);
};

const buildIndex = (nodes: readonly GraphNode[], rootArtifactSha256: string | null) => {
  const projections = projectCurrentOccurrences(nodes, rootArtifactSha256);
  const byDigest = new Map<string, Set<string>>();
  const byPathSuffix = new Map<string, Set<string>>();
  const byBasename = new Map<string, Set<string>>();
  for (const projection of projections) {
    const key = projectionKey(projection);
    for (const digest of projection.digests) addIndexValue(byDigest, digest, key);
    for (const path of projection.paths) {
      for (const suffix of path.allowSuffix ? pathSuffixes(path.value) : [path.value]) {
        addIndexValue(byPathSuffix, suffix, key);
        const canonical = suffix.normalize('NFC');
        if (canonical !== suffix) addIndexValue(byPathSuffix, canonical, key);
      }
      addIndexValue(byBasename, posix.basename(path.value), key);
    }
  }
  return {
    nodes: new Map(projections.map((projection) => [projectionKey(projection), projection])),
    byDigest,
    byPathSuffix,
    byBasename,
  };
};

const candidateIdsForSource = (source: SourceEntry, index: ReturnType<typeof buildIndex>): string[] => {
  const canonicalPath = source.path.normalize('NFC');
  const groups = [
    source.sha256 === null ? undefined : index.byDigest.get(source.sha256),
    index.byPathSuffix.get(source.path),
    canonicalPath === source.path ? undefined : index.byPathSuffix.get(canonicalPath),
    index.byBasename.get(posix.basename(source.path)),
  ];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const group of groups) {
    if (group === undefined) continue;
    for (const nodeId of [...group].sort(compareUnicode)) {
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      output.push(nodeId);
    }
  }
  return output;
};

const matchingPaths = (sourcePath: string, currentPaths: readonly PathFact[]): string[] =>
  currentPaths
    .filter(({ value, allowSuffix }) => value === sourcePath || (allowSuffix && value.endsWith(`/${sourcePath}`)))
    .map(({ value }) => value);

const matchingUnicodePaths = (sourcePath: string, currentPaths: readonly PathFact[]): string[] => {
  const canonicalSource = sourcePath.normalize('NFC');
  return currentPaths
    .filter(({ value, allowSuffix }) => {
      if (value === sourcePath || (allowSuffix && value.endsWith(`/${sourcePath}`))) return false;
      const canonicalValue = value.normalize('NFC');
      return canonicalValue === canonicalSource || (allowSuffix && canonicalValue.endsWith(`/${canonicalSource}`));
    })
    .map(({ value }) => value);
};

const makeSignal = (kind: SignalKind, sourceValue: string, currentValues: readonly string[]): Signal => ({
  kind,
  weight: signalWeight(kind),
  source_value: sourceValue,
  current_values: uniqueSorted(currentValues),
});

const candidateConfidence = (signals: readonly Signal[]): Candidate['confidence'] => {
  const kinds = new Set(signals.map(({ kind }) => kind));
  if (kinds.has('exact-source-digest')) return 'exact';
  if (kinds.has('source-map-original-path') || kinds.has('current-path-exact')) return 'high';
  return kinds.has('current-path-suffix') ? 'medium' : 'low';
};

const candidateSignals = (source: SourceEntry, current: NodeProjection): Signal[] => {
  const signals: Signal[] = [];
  if (source.sha256 !== null && current.digests.has(source.sha256)) {
    signals.push(makeSignal('exact-source-digest', source.sha256, [source.sha256]));
  }
  const sourceMapPaths = matchingPaths(
    source.path,
    current.paths.filter(({ kind }) => kind === 'source-map-original'),
  );
  if (sourceMapPaths.length > 0) signals.push(makeSignal('source-map-original-path', source.path, sourceMapPaths));
  const unicodeEquivalentPaths = matchingUnicodePaths(source.path, current.paths);
  if (unicodeEquivalentPaths.length > 0) signals.push(makeSignal('unicode-equivalent-path', source.path, unicodeEquivalentPaths));
  const otherPaths = current.paths.filter(({ kind }) => kind !== 'source-map-original');
  const exactPaths = otherPaths.filter(({ value }) => value === source.path).map(({ value }) => value);
  if (exactPaths.length > 0) signals.push(makeSignal('current-path-exact', source.path, exactPaths));
  const suffixPaths = otherPaths
    .filter(({ value, allowSuffix }) => allowSuffix && value !== source.path && value.endsWith(`/${source.path}`))
    .map(({ value }) => value);
  if (suffixPaths.length > 0) signals.push(makeSignal('current-path-suffix', source.path, suffixPaths));
  const basename = posix.basename(source.path);
  const basenamePaths = current.paths.filter(({ value }) => posix.basename(value) === basename).map(({ value }) => value);
  if (basenamePaths.length > 0) signals.push(makeSignal('basename-match', basename, basenamePaths));
  const extension = posix.extname(source.path).toLowerCase();
  const extensionPaths = current.paths.filter(({ value }) => posix.extname(value).toLowerCase() === extension).map(({ value }) => value);
  if (extension !== '' && extensionPaths.length > 0) signals.push(makeSignal('language-extension', extension, extensionPaths));
  return signals;
};

const scoreCandidate = (source: SourceEntry, nodeId: string, index: ReturnType<typeof buildIndex>): Candidate | null => {
  const projection = index.nodes.get(nodeId);
  if (projection === undefined) return null;
  const signals = candidateSignals(source, projection);
  const score = signals.reduce((total, signal) => total + signal.weight, 0);
  if (score < 20) return null;
  return {
    ...(projection.occurrence === undefined
      ? {}
      : {
          current_file_occurrence: projection.occurrence,
          representation_node_ids: [...projection.representations],
        }),
    current_node_id: projection.node.node_id,
    current_node_kind: projection.node.kind,
    score,
    confidence: candidateConfidence(signals),
    signals,
  };
};

const candidateIdentity = (candidate: Candidate): string =>
  candidate.current_file_occurrence === undefined ? candidate.current_node_id : fileOccurrenceKey(candidate.current_file_occurrence);

const hasSignal = (candidate: Candidate, kind: SignalKind): boolean => candidate.signals.some((signal) => signal.kind === kind);

const classifyMapping = (
  candidates: readonly Candidate[],
  absenceComplete: boolean,
  digestComparable: (candidate: Candidate) => boolean,
): { status: MappingItem['status']; confidence: MappingItem['confidence']; currentNodeIds: string[]; limitations: string[] } => {
  const exact = candidates.filter((candidate) => hasSignal(candidate, 'exact-source-digest'));
  if (exact.length === 1) {
    return {
      status: 'unchanged',
      confidence: 'exact',
      currentNodeIds: [exact[0]!.current_node_id],
      limitations: ['Exact byte identity does not establish equivalent load context or runtime behavior.'],
    };
  }
  if (exact.length > 1) {
    return {
      status: 'duplicated',
      confidence: 'exact',
      currentNodeIds: uniqueSorted(exact.map(({ current_node_id: nodeId }) => nodeId)),
      limitations: ['The same historical source digest occurs in multiple current source occurrences.'],
    };
  }
  const pathCandidates = candidates.filter((candidate) =>
    candidate.signals.some(({ kind }) => kind === 'source-map-original-path' || kind === 'current-path-exact' || kind === 'current-path-suffix'),
  );
  const topScore = pathCandidates[0]?.score;
  const topPathCandidates = topScore === undefined ? [] : pathCandidates.filter(({ score }) => score === topScore);
  if (topPathCandidates.length === 1) {
    const candidate = topPathCandidates[0]!;
    if (digestComparable(candidate)) {
      return {
        status: 'modified',
        confidence: candidate.confidence === 'high' ? 'high' : 'medium',
        currentNodeIds: [candidate.current_node_id],
        limitations: ['Location evidence links the source to the current node, but their source digests differ.'],
      };
    }
    return {
      status: 'unknown',
      confidence: 'unknown',
      currentNodeIds: [candidate.current_node_id],
      limitations: ['Location evidence links the source to the current node, but comparable source digests are unavailable.'],
    };
  }
  if (topPathCandidates.length > 1) {
    return {
      status: 'split',
      confidence: 'medium',
      currentNodeIds: uniqueSorted(topPathCandidates.map(({ current_node_id: nodeId }) => nodeId)),
      limitations: [
        'Multiple equally scored current source occurrences retain the historical source path; this is a static split inference, not runtime proof.',
      ],
    };
  }
  if (candidates.length > 0) {
    return {
      status: 'unknown',
      confidence: 'unknown',
      currentNodeIds: [],
      limitations: [
        candidates.some((candidate) => hasSignal(candidate, 'unicode-equivalent-path'))
          ? 'Unicode-equivalent paths are inferred candidates only; filesystem paths with distinct Unicode spellings may identify different files, so no mapping was forced.'
          : 'Only weak basename or extension signals were available; no mapping was forced.',
      ],
    };
  }
  return absenceComplete
    ? {
        status: 'removed',
        confidence: 'high',
        currentNodeIds: [],
        limitations: ['No retained current node matched exact digest or path signals within complete static inventories.'],
      }
    : {
        status: 'unknown',
        confidence: 'unknown',
        currentNodeIds: [],
        limitations: ['No candidate was observed, but incomplete input or graph coverage prevents a removal claim.'],
      };
};

const mappingId = (referenceRoot: string, graphId: string, item: Omit<MappingItem, 'mapping_id'>): string =>
  `stbc_item_${digestOf(canonicalJson({ reference_root_sha256: referenceRoot, application_graph_id: graphId, ...item }))}`;

const applicationGraph = (
  record: EvidenceRecord,
): {
  graph_id: string;
  root: string;
  nodes: GraphNode[];
  coverageStatus: string;
  limitations: readonly string[];
} => {
  const nr = record.normalized_result as Record<string, unknown>;
  const graph = (nr['graph'] as Record<string, unknown> | undefined) ?? {};
  const nodes = (Array.isArray(graph['nodes']) ? (graph['nodes'] as Record<string, unknown>[]) : [])
    .filter((node) => RELEVANT_NODE_KINDS.has(String(node['kind'] ?? '')))
    .map((node) => ({
      node_id: String(node['node_id'] ?? ''),
      kind: String(node['kind'] ?? ''),
      identity: (node['identity'] as Record<string, unknown> | undefined) ?? {},
      observations: Array.isArray(node['observations']) ? (node['observations'] as Record<string, unknown>[]) : [],
    }))
    .filter((node) => node.node_id.length > 0)
    .sort((left, right) => compareUnicode(left.node_id, right.node_id));
  const coverage = (graph['coverage'] as Record<string, unknown> | undefined) ?? {};
  const limitations = Array.isArray(graph['limitations'])
    ? (graph['limitations'] as unknown[]).map(String)
    : Array.isArray(nr['limitations'])
      ? (nr['limitations'] as unknown[]).map(String)
      : [];
  return {
    graph_id: typeof graph['graph_id'] === 'string' ? graph['graph_id'] : `jag_${digestOf(record.evidence_id)}`,
    root: typeof nr['root_artifact_sha256'] === 'string' ? nr['root_artifact_sha256'] : digestOf(record.evidence_id),
    nodes,
    coverageStatus: typeof coverage['status'] === 'string' ? coverage['status'] : 'unknown',
    limitations,
  };
};

export const compareSourceToBundle = async (params: {
  readonly reference: unknown;
  readonly application: unknown;
}): Promise<SourceToBundleInspection> => {
  const application = asJsEvidence(params.application);
  const reference = await parseHistoricalSourceGraph(params.reference);
  const app = applicationGraph(application);
  const index = buildIndex(app.nodes, app.root);
  const absenceComplete = reference.inventory_state === 'complete' && app.coverageStatus === 'complete';

  let candidateEvaluations = 0;
  const provisional: MappingItem[] = [];
  for (const source of reference.entries) {
    const candidateIds = candidateIdsForSource(source, index);
    candidateEvaluations += candidateIds.length;
    const scored = candidateIds
      .map((nodeId) => scoreCandidate(source, nodeId, index))
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort((left, right) => right.score - left.score || compareUnicode(candidateIdentity(left), candidateIdentity(right)));
    const classification = classifyMapping(scored, absenceComplete, (candidate) => source.sha256 !== null && (index.nodes.get(candidateIdentity(candidate))?.digests.size ?? 0) > 0);
    const semantic = {
      source_path: source.path,
      source_sha256: source.sha256,
      source_language: source.language,
      status: classification.status,
      confidence: classification.confidence,
      current_node_ids: classification.currentNodeIds,
      candidates: scored,
      limitations: uniqueSorted([...source.limitations, ...classification.limitations]),
    };
    provisional.push({
      mapping_id: mappingId(reference.root_sha256, app.graph_id, semantic),
      ...semantic,
    });
  }

  const sourcesByOccurrence = new Map<string, MappingItem[]>();
  for (const item of provisional) {
    if (item.status !== 'unchanged' || item.current_node_ids.length !== 1) continue;
    const nodeId = item.current_node_ids[0]!;
    const candidate = item.candidates.find((entry) => entry.current_node_id === nodeId);
    if (candidate === undefined) continue;
    const key = candidateIdentity(candidate);
    sourcesByOccurrence.set(key, [...(sourcesByOccurrence.get(key) ?? []), item]);
  }
  const mergedSources = new Set(
    [...sourcesByOccurrence.values()]
      .filter((group) => group.length > 1)
      .flatMap((group) => group.map(({ source_path: path }) => path)),
  );
  const items = provisional.map((item) => {
    if (!mergedSources.has(item.source_path)) return item;
    const { mapping_id: _previous, ...base } = item;
    void _previous;
    const semantic = {
      ...base,
      status: 'merged' as const,
      confidence: 'exact' as const,
      limitations: uniqueSorted([...item.limitations, 'Multiple historical source paths have exact digest identity with the same current source occurrence.']),
    };
    return { ...semantic, mapping_id: mappingId(reference.root_sha256, app.graph_id, semantic) };
  });

  const mappedCurrentIds = new Set(
    items.flatMap(({ current_node_ids: nodeIds, candidates }) => [
      ...nodeIds,
      ...candidates.filter((candidate) => nodeIds.includes(candidate.current_node_id)).flatMap((candidate) => candidate.representation_node_ids ?? []),
    ]),
  );
  const unmapped = app.nodes.map(({ node_id }) => node_id).filter((nodeId) => !mappedCurrentIds.has(nodeId));
  const countStatus = (status: MappingItem['status']): number => items.filter((item) => item.status === status).length;
  const coverageStatus =
    reference.inventory_state === 'complete' && app.coverageStatus === 'complete' ? ('complete-within-inputs' as const) : ('partial' as const);
  const limitations = uniqueSorted([
    'Static digest and location signals do not establish runtime behavior, semantic equivalence, or absence of dynamically generated modules.',
    ...reference.limitations,
    ...app.limitations,
    ...(reference.inventory_state === 'complete' ? [] : [`Historical source inventory is ${reference.inventory_state}; unmatched files remain unknown.`]),
    ...(app.coverageStatus === 'complete' ? [] : [`Application graph coverage is ${app.coverageStatus}; unmatched files remain unknown.`]),
  ]);
  const semanticResult = {
    reference: { root_sha256: reference.root_sha256, inventory_state: reference.inventory_state },
    application: {
      evidence_id: application.evidence_id,
      graph_id: app.graph_id,
      root_artifact_sha256: app.root,
    },
    scoring: {
      algorithm: 'rea-source-to-bundle-signals' as const,
      minimum_candidate_score: 20 as const,
      weights: SOURCE_TO_BUNDLE_SIGNAL_WEIGHTS.map(([signal, weight]) => ({ signal, weight })),
    },
    summary: {
      unchanged: countStatus('unchanged'),
      modified: countStatus('modified'),
      removed: countStatus('removed'),
      split: countStatus('split'),
      merged: countStatus('merged'),
      duplicated: countStatus('duplicated'),
      unknown: countStatus('unknown'),
    },
    items,
    unmapped_current_node_ids: unmapped,
    coverage: {
      status: coverageStatus,
      reference_inventory_state: reference.inventory_state,
      application_graph_status: app.coverageStatus,
      retained_source_files: reference.entries.length,
      retained_application_nodes: app.nodes.length,
      candidate_evaluations: candidateEvaluations,
    },
    evidence_links: [application.evidence_id],
    limitations,
  };
  return {
    ...semanticResult,
    comparison_id: `stbc_${digestOf(canonicalJson(semanticResult))}`,
  };
};
