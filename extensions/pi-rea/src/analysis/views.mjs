import { evidenceId } from './canonical.mjs';
import { invalidInput } from './errors.mjs';

const VIEW_KINDS = new Set(['summary', 'section', 'item', 'inventory', 'api-surface']);

export async function buildView(record, request) {
  const kind = request.kind ?? 'summary';
  if (!VIEW_KINDS.has(kind)) throw invalidInput('Unknown view kind.', [{ path: ['view', 'kind'], reason: 'invalid_value', message: `kind must be one of ${[...VIEW_KINDS].join(', ')}` }]);
  const base = {
    kind,
    view: { kind },
    evidence_id: record.evidence_id,
    view_id: evidenceId({
      operation: 'inspect_analysis_view',
      parameters: { kind, selector: request.selector ?? null, offset: request.offset ?? 0, limit: request.limit ?? null, of: record.evidence_id },
      subjectSha256: record.subject?.digest?.sha256 ?? null,
      normalizedResult: { kind },
    }),
  };
  const normalized = {
    ...base,
    ...(kind === 'summary' ? { summary: summarize(record) } : {}),
    ...(kind === 'section' ? { section: sectionOf(record, request) } : {}),
    ...(kind === 'item' ? { item: itemOf(record, request) } : {}),
    ...(kind === 'inventory' ? { inventory: inventoryOf(record, request) } : {}),
    ...(kind === 'api-surface' ? { api_surface: await apiSurfaceOf(record, request) } : {}),
    coverage: {
      status: record.normalized_result?.graph?.coverage?.status ?? record.normalized_result?.coverage?.status ?? 'partial',
      source_complete: sourceComplete(record),
      ...(kind === 'summary' ? producerCoverage(record) : {}),
    },
  };
  return {
    operation: 'inspect_analysis_view',
    predicate_type: 'rea.analysis-view',
    parameters: {
      view: { kind },
      ...(request.selector ? { selector: request.selector } : {}),
      ...(request.offset ? { offset: request.offset } : {}),
      ...(request.limit ? { limit: request.limit } : {}),
    },
    normalized_result: normalized,
  };
}

function summarize(record) {
  return {
    ...(record.normalized_result?.summary ?? {}),
    operation: record.operation,
    subject: {
      name: record.subject?.name ?? null,
      digest: record.subject?.digest?.sha256 ?? null,
      format: record.subject?.format ?? null,
    },
    statistics: record.normalized_result?.statistics ?? null,
    limitations: record.limitations ?? [],
  };
}

function producerCoverage(record) {
  return {
    application: record.normalized_result?.graph?.coverage ?? record.normalized_result?.coverage ?? null,
    ...(record.normalized_result?.semantic_graph ? { semantic: record.normalized_result.semantic_graph.coverage ?? null } : {}),
    note: 'Coverage describes the producer; the view examined only the pages it returned.',
  };
}

function sourceComplete(record) {
  const coverage = record.normalized_result?.graph?.coverage ?? record.normalized_result?.coverage ?? null;
  if (coverage === null) return false;
  if (coverage.status === 'complete' && coverage.truncated === false) return true;
  return false;
}

function sectionOf(record, request) {
  const graph = record.normalized_result?.graph;
  if (!graph) throw invalidInput('That evidence has no sections.', [{ path: ['view', 'kind'], reason: 'invalid_value', message: `operation ${record.operation} does not expose sections` }]);
  const selector = request.selector;
  if (!selector) throw invalidInput('A section view needs a selector.', [{ path: ['selector'], reason: 'required', message: 'pass --selector <kind|node_id>' }]);
  const nodes = graph.nodes.filter((node) => node.kind === selector || node.node_id === selector);
  if (nodes.length === 0) throw invalidInput('No node matches that selector.', [{ path: ['selector'], reason: 'not_found', message: `no node kind or id matches: ${selector}` }]);
  return page(nodes, request);
}

function itemOf(record, request) {
  const graph = record.normalized_result?.graph;
  if (!graph) throw invalidInput('That evidence has no items.', [{ path: ['view', 'kind'], reason: 'invalid_value', message: `operation ${record.operation} does not expose items` }]);
  const selector = request.selector;
  const matches = graph.nodes.filter((node) => node.node_id === selector);
  if (matches.length === 0) {
    const byPath = graph.nodes.filter((node) => node.observations.some((observation) => observation.properties?.path === selector));
    if (byPath.length === 0) throw invalidInput('No node matches that selector.', [{ path: ['selector'], reason: 'not_found', message: `no node id or path matches: ${selector}` }]);
    if (byPath.length > 1) {
      throw invalidInput('That path names several graph roles; select one node id.', [{ path: ['selector'], reason: 'ambiguous', message: `${selector} is ${byPath.length} nodes`, candidates: byPath.map((node) => node.node_id) }]);
    }
    return {
      nodes: byPath,
      edges: edgesTouching(
        graph,
        byPath.map((node) => node.node_id),
      ),
    };
  }
  const ids = matches.map((node) => node.node_id);
  return { nodes: matches, edges: edgesTouching(graph, ids) };
}

function edgesTouching(graph, ids) {
  const set = new Set(ids);
  return (graph.edges ?? []).filter((edge) => set.has(edge.source_node_id) || set.has(edge.target_node_id));
}

function inventoryOf(record, request) {
  const collections = inventoryCollections(record);
  if (!collections) throw invalidInput('That evidence has no inventory.', [{ path: ['view', 'kind'], reason: 'invalid_value', message: `operation ${record.operation} does not expose an inventory` }]);
  const collection = request.collection ?? 'occurrences';
  const items = collections[collection];
  if (!items) throw invalidInput('Unknown inventory collection.', [{ path: ['collection'], reason: 'invalid_value', message: `collection must be one of ${Object.keys(collections).join(', ')}` }]);
  const selected = request.logicalPaths ? items.filter((item) => request.logicalPaths.includes(item.logical_path)) : items;
  return { ...page(selected, request), collection, source_complete: sourceComplete(record) };
}

function inventoryCollections(record) {
  const direct = record.normalized_result?.collections;
  if (direct) return direct;
  const substeps = record.normalized_result?.substeps;
  const nested = Array.isArray(substeps) ? substeps.find((step) => step?.operation === 'inventory_artifact')?.evidence?.normalized_result : undefined;
  if (!nested || typeof nested !== 'object') return null;
  return {
    occurrences: Array.isArray(nested.occurrences) ? nested.occurrences.filter((row) => row?.logical_path !== '.') : [],
    nodes: Array.isArray(nested.nodes) ? nested.nodes : [],
    edges: Array.isArray(nested.edges) ? nested.edges : [],
    integrity_contradictions: Array.isArray(nested.integrity_contradictions) ? nested.integrity_contradictions : [],
  };
}

function apiSurfaceOf(record, request) {
  const records = record.normalized_result?.records;
  if (!records) throw invalidInput('That evidence has no capture records.', [{ path: ['view', 'kind'], reason: 'invalid_value', message: `operation ${record.operation} does not expose capture records` }]);
  const groups = new Map();
  for (const entry of records) {
    const fields = surfaceFieldsFromRecord(entry);
    const template = pathTemplate(fields.path);
    const key = `${fields.method} ${fields.origin}${template}`;
    const group = groups.get(key) ?? { method: fields.method, origin: fields.origin, path_template: template, ordinals: [], observations: 0 };
    group.ordinals.push(entry.ordinal);
    group.observations += 1;
    groups.set(key, group);
  }
  const all = [...groups.values()].sort((left, right) => (left.path_template < right.path_template ? -1 : 1));
  return { ...page(all, request), matches_are_inferences: true, note: 'Format matches are inferences, not handler identity or schemas.' };
}

function surfaceFieldsFromRecord(entry) {
  const reported = entry?.reported;
  if (reported !== null && typeof reported === 'object' && !Array.isArray(reported)) {
    const request = reported.request !== null && typeof reported.request === 'object' ? reported.request : {};
    const url = typeof request.url === 'string' ? request.url : '';
    const originMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+)/.exec(url);
    const origin = originMatch === null ? '' : originMatch[1];
    const path = origin === '' ? url.split(/[?#]/, 1)[0] : url.slice(origin.length).split(/[?#]/, 1)[0];
    return {
      method: typeof request.method === 'string' ? request.method : '',
      origin,
      path,
    };
  }
  return {
    method: typeof entry?.method === 'string' ? entry.method : '',
    origin: typeof entry?.origin === 'string' ? entry.origin : '',
    path: typeof entry?.path === 'string' ? entry.path : '',
  };
}

function pathTemplate(path) {
  return String(path)
    .replace(/\/[0-9]+(?=\/|$)/g, '/{id}')
    .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/{id}');
}

function page(items, request) {
  const offset = Number.isInteger(request.offset) && request.offset >= 0 ? request.offset : 0;
  const limit = Number.isInteger(request.limit) && request.limit > 0 ? request.limit : items.length;
  return {
    offset,
    limit,
    returned: Math.max(0, Math.min(limit, items.length - offset)),
    remaining: Math.max(0, items.length - offset - limit),
    total: items.length,
    items: items.slice(offset, offset + limit),
  };
}
