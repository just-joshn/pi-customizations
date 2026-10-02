import type { AgentNode } from './agent-node.ts';

export type TaskStatus = AgentNode['status'];
export type ExecutionMode = AgentNode['mode'];

const edges: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  running: ['idle', 'completed', 'failed', 'cancelled'],
  idle: ['running', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return edges[from].includes(to);
}

export function isTerminal(status: TaskStatus): boolean {
  return edges[status].length === 0;
}

export function acceptsMessages(node: Pick<AgentNode, 'status' | 'mode' | 'retired'>): boolean {
  return node.mode === 'background' && node.retired !== true && (node.status === 'running' || node.status === 'idle');
}

export function moveTo(node: AgentNode, to: TaskStatus): AgentNode {
  if (!canTransition(node.status, to)) throw new Error(`Agent ${node.id} cannot move from ${node.status} to ${to}.`);
  return { ...node, status: to };
}

export type Transition = Readonly<{ id: string; from: TaskStatus | 'registered'; to: TaskStatus }>;

export function transitionBetween(id: string, before: Pick<AgentNode, 'status'> | undefined, after: Pick<AgentNode, 'status'>): Transition | undefined {
  if (!before) return { id, from: 'registered', to: after.status };
  return before.status === after.status ? undefined : { id, from: before.status, to: after.status };
}
