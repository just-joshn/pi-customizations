import type { AgentNode } from './agent-node.ts';
import { moveTo, type TaskStatus, type Transition, transitionBetween } from './task-status.ts';

export type ProgressMutation = Readonly<{ kind: 'intent'; intent: string }> | Readonly<{ kind: 'tool_call' }> | Readonly<{ kind: 'executor_telemetry'; tokens: number }>;
export type RegistryChange = Readonly<{ transition?: Transition; progress?: ProgressMutation; id: string }>;
export type RegistryHooks = Readonly<{ persist: (node: AgentNode) => void }>;

export class TaskRegistry {
  private nodes: ReadonlyMap<string, AgentNode> = new Map();
  private listeners: ReadonlySet<(change: RegistryChange) => void> = new Set();

  constructor(private readonly hooks: RegistryHooks) {}

  replace(nodes: ReadonlyMap<string, AgentNode>): void {
    this.nodes = nodes;
  }

  subscribe(listener: (change: RegistryChange) => void): () => void {
    this.listeners = new Set([...this.listeners, listener]);
    return () => {
      this.listeners = new Set([...this.listeners].filter((held) => held !== listener));
    };
  }

  get(id: string): AgentNode | undefined {
    return this.nodes.get(id);
  }

  list(): readonly AgentNode[] {
    return [...this.nodes.values()];
  }

  children(registryId: string): readonly AgentNode[] {
    return this.list().filter((node) => node.parentRegistryId === registryId);
  }

  count(status: TaskStatus): number {
    return this.list().filter((node) => node.status === status).length;
  }

  register(node: AgentNode): void {
    if (this.nodes.has(node.id)) throw new Error(`Agent ${node.id} is already registered.`);
    if (node.status !== 'running') throw new Error(`Agent ${node.id} must be registered as running, not ${node.status}.`);
    this.store(undefined, node);
  }

  patch(id: string, fields: Partial<Omit<AgentNode, 'id' | 'status'>>): AgentNode {
    const before = this.require(id);
    return this.store(before, { ...before, ...fields });
  }

  transition(id: string, to: TaskStatus, fields: Partial<Omit<AgentNode, 'id' | 'status'>> = {}): AgentNode {
    const before = this.require(id);
    return this.store(before, { ...moveTo(before, to), ...fields });
  }

  promote(id: string): AgentNode {
    const before = this.require(id);
    if (before.mode !== 'sync' || before.status !== 'running') throw new Error(`Agent ${id} is not a running sync agent.`);
    return this.store(before, { ...before, mode: 'background' });
  }

  mutateProgress(id: string, mutation: ProgressMutation): AgentNode {
    const before = this.require(id);
    const next = this.next(before, mutation);
    this.nodes = new Map([...this.nodes, [id, next]]);
    this.emit({ id, progress: mutation });
    return next;
  }

  remove(id: string): void {
    this.nodes = new Map([...this.nodes].filter(([key]) => key !== id));
  }

  private next(node: AgentNode, mutation: ProgressMutation): AgentNode {
    switch (mutation.kind) {
      case 'intent':
        return { ...node, intent: mutation.intent };
      case 'tool_call':
        return { ...node, totalToolCalls: node.totalToolCalls + 1 };
      case 'executor_telemetry':
        return { ...node, totalTokens: mutation.tokens };
      default: {
        const exhaustive: never = mutation;
        return exhaustive;
      }
    }
  }

  private require(id: string): AgentNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Agent not found: ${id}`);
    return node;
  }

  private store(before: AgentNode | undefined, after: AgentNode): AgentNode {
    this.nodes = new Map([...this.nodes, [after.id, after]]);
    this.hooks.persist(after);
    const transition = transitionBetween(after.id, before, after);
    this.emit({ id: after.id, ...(transition ? { transition } : {}) });
    return after;
  }

  private emit(change: RegistryChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
