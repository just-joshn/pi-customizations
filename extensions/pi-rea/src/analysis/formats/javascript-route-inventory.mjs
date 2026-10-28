import { canonicalJson, sha256Hex } from '../canonical.mjs';

const INVENTORY_LIMITATIONS = [
  'Routes are static candidates from the provided code sources. Reachability, permissions, server-only routes and the complete application route set are unverified.',
  'Pattern IDs are exact path identities within this inventory. Occurrence and source IDs retain source/content identity and precise syntax ranges; metadata-only discoveries have no AST range.',
  'System classification is a path-name heuristic. Asset URL prefixes can differ from routing bases; inferred prefixes retain the original unprefixed path.',
  'Unbound path strings require a top-level segment supported by structural routes or navigation candidates. Unknown or missing source facts do not establish route absence.',
];

const hash = (value) => sha256Hex(canonicalJson(value));
const lookupId = (prefix, value) => `${prefix}:${hash(value).slice(0, 32)}`;
const order = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export function buildRouteInventory(inputs) {
  const sources = [];
  const manifestIds = [];
  let partial = false;

  for (const input of inputs) {
    const id = lookupId('jss', [
      input.key,
      input.path,
      input.url,
      input.sha256,
      input.container_sha256,
      ...(input.next_app_context === undefined ? [] : [input.next_app_context]),
    ]);
    manifestIds.push(id);
    sources.push({
      id,
      key: input.key,
      path: input.path,
      url: input.url,
      sha256: input.sha256,
      container_sha256: input.container_sha256,
      status: input.status,
      ...(input.next_app_context === undefined ? {} : { next_app_context: input.next_app_context }),
      reported_route_capacity: input.facts?.capacity ?? null,
      reason: input.reason,
      base_path: null,
    });
    if (input.status !== 'complete' || input.facts === null) partial = true;
  }

  sources.sort((left, right) => order(left.key, right.key) || order(left.id, right.id));
  const source_manifest_sha256 = hash([...manifestIds].sort(order));
  const body = {
    source_manifest_sha256,
    sources,
    routes: [],
    occurrences: [],
    unknowns: [],
    capacity: null,
    coverage: {
      scope: 'provided-code-sources',
      source_parsing:
        sources.length === 0
          ? 'unknown'
          : sources.some((source) => source.status !== 'complete')
            ? 'partial'
            : 'complete',
      candidate_enumeration: partial ? 'partial' : 'complete',
      application_routes: 'unknown',
    },
    statistics: {
      sources_seen: inputs.length,
      sources_retained: sources.length,
      route_patterns: 0,
      occurrences: 0,
      unanchored_literals_excluded: 0,
    },
    limitations: [...INVENTORY_LIMITATIONS],
  };

  return {
    inventory_id: `jsri:${hash(['javascript-routes-v1', body])}`,
    source_manifest_sha256: body.source_manifest_sha256,
    sources: body.sources,
    routes: body.routes,
    occurrences: body.occurrences,
    unknowns: body.unknowns,
    coverage: body.coverage,
    statistics: body.statistics,
    capacity: body.capacity,
    limitations: body.limitations,
  };
}
