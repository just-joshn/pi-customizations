import type { Graph, GraphNode } from '../domain/graph.ts';

function done(node: GraphNode | undefined): boolean {
  return node !== undefined && (node.status === 'passed' || node.status === 'integrated');
}

export function blockedBy(graph: Graph, node: GraphNode): readonly string[] {
  return node.dependencies.filter((dependency) => !done(graph.nodes.find((candidate) => candidate.id === dependency)));
}

export function readyFrontier(graph: Graph): readonly GraphNode[] {
  return graph.nodes.filter((node) => (node.status === 'pending' || node.status === 'failed') && blockedBy(graph, node).length === 0);
}
