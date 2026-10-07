import type { Graph, GraphNode } from '../domain/graph.ts';
import type { HostCapabilities } from '../domain/run.ts';
import { conflict } from './conflicts.ts';
import { readyFrontier } from './frontier.ts';

export type ScheduledNode = { readonly id: string; readonly workspace: string };

export type Batch = { readonly concurrent: boolean; readonly nodes: readonly ScheduledNode[]; readonly serializedBecause: readonly string[] };

export function canRunConcurrently(capabilities: HostCapabilities): boolean {
  return capabilities.independentAgents && capabilities.isolatedWorktrees;
}

export function schedule(graph: Graph, capabilities: HostCapabilities): Batch {
  const frontier = readyFrontier(graph);
  if (!canRunConcurrently(capabilities)) {
    const first = frontier[0];
    const reasons = frontier.length > 1 ? ['host lacks independent agents with isolated worktrees'] : [];
    return { concurrent: false, nodes: first === undefined ? [] : [{ id: first.id, workspace: '.' }], serializedBecause: reasons };
  }
  const picked: GraphNode[] = [];
  const reasons: string[] = [];
  for (const node of frontier) {
    const clash = picked.map((other) => conflict(other, node)).find((reason) => reason !== null);
    if (clash === undefined) picked.push(node);
    else reasons.push(`${node.id}: ${clash}`);
  }
  const concurrent = picked.length > 1;
  return {
    concurrent,
    nodes: picked.map((node) => ({ id: node.id, workspace: concurrent ? `.s50/worktrees/${node.id}` : '.' })),
    serializedBecause: reasons,
  };
}
