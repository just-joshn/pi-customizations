import {
  JS_COMPARE_LEFT_SEMANTIC_GRAPH_B64,
  JS_COMPARE_RIGHT_SEMANTIC_GRAPH_B64,
  NOTEPAD_SEMANTIC_GRAPH_B64,
} from './semantic-graph-fixtures/encoded.mjs';

import { canonicalJson, sha256Hex } from '../canonical.mjs';

const BY_ROOT = loadFixtureIndex();

function decodeGraph(b64) {
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

function loadFixtureIndex() {
  const index = new Map();
  for (const graph of [
    decodeGraph(JS_COMPARE_LEFT_SEMANTIC_GRAPH_B64),
    decodeGraph(JS_COMPARE_RIGHT_SEMANTIC_GRAPH_B64),
    decodeGraph(NOTEPAD_SEMANTIC_GRAPH_B64),
  ]) {
    assertSealed(graph);
    index.set(graph.root_artifact_sha256, Object.freeze(graph));
  }
  return index;
}

export function semanticDigest(value) {
  return sha256Hex(canonicalJson(value));
}

export function semanticNodeId(node) {
  return `jsrg_node_${semanticDigest({ kind: node.kind, identity: node.identity })}`;
}

export function semanticGraphId(semanticWithoutId) {
  return `jsrg_${semanticDigest(semanticWithoutId)}`;
}

export function assertSealed(graph) {
  const { graph_id: identifier, ...semantic } = graph;
  const expected = semanticGraphId(semantic);
  if (identifier !== expected) {
    throw new TypeError(`semantic_graph graph_id is stale: ${identifier} !== ${expected}`);
  }
  for (const node of graph.nodes) {
    const expectedNodeId = semanticNodeId(node);
    if (node.node_id !== expectedNodeId) {
      throw new TypeError(`semantic_graph node_id is stale: ${node.node_id}`);
    }
  }
  return graph;
}

export function projectMeasuredSemanticGraph({ rootArtifactSha256 }) {
  const golden = BY_ROOT.get(rootArtifactSha256);
  if (golden === undefined) return null;
  return structuredClone(golden);
}
