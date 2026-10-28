#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { join } from 'path';

import { deepDiff } from './lib/diff.mjs';
import { normalizeForCompare } from './lib/normalize.mjs';

const root = process.argv[2] ?? 'parity/pi-rea/evidence/differential/analyze_javascript_application--notepad';
const pi = JSON.parse(readFileSync(join(root, 'pi-rea.json'), 'utf8'));
const ora = JSON.parse(readFileSync(join(root, 'rea-agents.json'), 'utf8'));
const P = pi.body.normalized_result.graph;
const O = ora.body.normalized_result.graph;

const hist = (items, keyFn) => {
  const h = {};
  for (const item of items) {
    const key = keyFn(item);
    h[key] = (h[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(h).sort((a, b) => a[0].localeCompare(b[0])));
};

const edgeKey = (e) =>
  JSON.stringify({
    relation: e.relation,
    extractor: e.evidence?.extractor?.operation ?? null,
    props: e.properties ?? null,
    loc: e.evidence?.location?.value ?? null,
  });

const softEdgeKey = (e) => JSON.stringify({ relation: e.relation, props: e.properties ?? null });

const left = normalizeForCompare(pi.kind, pi.body);
const right = normalizeForCompare(ora.kind, ora.body);
const diffs = deepDiff(left, right);
const family = new Map();
for (const diff of diffs) {
  const key = diff.path.replace(/\[\d+\]/g, '[]');
  family.set(key, (family.get(key) || 0) + 1);
}
const top_families = [...family.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 40)
  .map(([path, count]) => ({ count, path }));

const oraBySoft = new Map();
for (const edge of O.edges) {
  const key = softEdgeKey(edge);
  if (!oraBySoft.has(key)) oraBySoft.set(key, []);
  oraBySoft.get(key).push(edge);
}
let unmatched_soft = 0;
for (const edge of P.edges) {
  const candidates = oraBySoft.get(softEdgeKey(edge)) ?? [];
  if (candidates.shift() === undefined) unmatched_soft += 1;
}

console.log(
  JSON.stringify(
    {
      nodes: { pi: P.nodes.length, oracle: O.nodes.length, pi_kinds: hist(P.nodes, (n) => n.kind), oracle_kinds: hist(O.nodes, (n) => n.kind) },
      edges: { pi: P.edges.length, oracle: O.edges.length, pi_relations: hist(P.edges, (e) => e.relation), oracle_relations: hist(O.edges, (e) => e.relation) },
      unmatched_oracle_edges: O.edges.map(edgeKey).filter((k) => !new Set(P.edges.map(edgeKey)).has(k)).length,
      unmatched_pi_edges: P.edges.map(edgeKey).filter((k) => !new Set(O.edges.map(edgeKey)).has(k)).length,
      unmatched_soft_property_edges: unmatched_soft,
      diff_count: diffs.length,
      top_families,
    },
    null,
    2,
  ),
);
