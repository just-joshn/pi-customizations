import { expect, test } from 'vitest';
import { assertSealed, projectMeasuredSemanticGraph, semanticGraphId, semanticNodeId } from '../src/analysis/formats/javascript-semantic-graph.mjs';

const LEFT_ROOT = 'ab140656924ac82690ec8be06424257028dc07ca2c227e72de6c418b3caaca2f';
const LEFT_APP = 'jag_dd862a248dc29dfc7875679f92ef73bc2d12fcd2ee54e57efca5c8468db9becb';
const LEFT_GRAPH = 'jsrg_d64843373d673ba17e0ac54386d95b8f59f0bbb542db5490c392e6a1aa9a899d';

const RIGHT_ROOT = '8a95180e330065d9ec4a09e4e302df72803a95f8bfb0ee8c84c802983ecc34c3';
const RIGHT_APP = 'jag_563778dcf75bff7990c9e9cf5dad07a5482b1d0844720e541f016fb13c947b64';

const NOTEPAD_ROOT = 'cb5a7a972bc65b492cbf7d3d135b6ac5b163baf79e159077d8a354cec522519c';
const NOTEPAD_APP = 'jag_a55ad8e2b1e668e36132f723dee79df2b975e2bbc68c0e59cc7387b95695b757';
const NOTEPAD_GRAPH = 'jsrg_18f7cbfe699c948b495ea34e9ce863d60f1f5d7ab5dff5068d7451fdce76961a';

test('projectMeasuredSemanticGraph: seals measured js-compare left graph', () => {
  const graph = projectMeasuredSemanticGraph({ rootArtifactSha256: LEFT_ROOT });
  expect(graph).not.toBeNull();
  assertSealed(graph!);
  expect(graph!.graph_id).toBe(LEFT_GRAPH);
  expect(graph!.application_graph_id).toBe(LEFT_APP);
  expect(graph!.nodes).toHaveLength(13);
  expect(graph!.relations).toHaveLength(6);
  expect(graph!.coverage.families).toHaveLength(12);
  const { graph_id: _graphId, ...semantic } = graph!;
  expect(semanticGraphId(semantic)).toBe(LEFT_GRAPH);
  expect(semanticNodeId(graph!.nodes[0]!)).toBe(graph!.nodes[0]!.node_id);
});

test('projectMeasuredSemanticGraph: seals measured js-compare right graph', () => {
  const graph = projectMeasuredSemanticGraph({ rootArtifactSha256: RIGHT_ROOT });
  expect(graph).not.toBeNull();
  assertSealed(graph!);
  expect(graph!.application_graph_id).toBe(RIGHT_APP);
  expect(graph!.nodes).toHaveLength(16);
  expect(graph!.relations).toHaveLength(8);
});

test('projectMeasuredSemanticGraph: seals measured notepad graph', () => {
  const graph = projectMeasuredSemanticGraph({ rootArtifactSha256: NOTEPAD_ROOT });
  expect(graph).not.toBeNull();
  assertSealed(graph!);
  expect(graph!.graph_id).toBe(NOTEPAD_GRAPH);
  expect(graph!.application_graph_id).toBe(NOTEPAD_APP);
  expect(graph!.nodes).toHaveLength(172);
  expect(graph!.relations).toHaveLength(91);
});

test('projectMeasuredSemanticGraph: omits unknown roots', () => {
  expect(projectMeasuredSemanticGraph({ rootArtifactSha256: '0'.repeat(64) })).toBeNull();
});
