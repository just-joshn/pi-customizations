import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { signalProcess } from '../process-signal.ts';

export const processGroupEvent = 'pstack:process-group';

const GroupSpawned = Type.Object({ pid: Type.Integer({ minimum: 1 }), agentId: Type.Optional(Type.String({ minLength: 1 })) });
export type GroupSpawned = Readonly<{ pid: number; agentId?: string }>;

export function groupSpawned(payload: unknown): GroupSpawned | undefined {
  return Check(GroupSpawned, payload) ? payload : undefined;
}

/** OS process groups spawned during one agent run and by its descendants, keyed by group leader pid. */
export class ProcessGroups {
  private readonly agentId: string;
  private readonly publish: (spawned: GroupSpawned) => void;
  private groups: ReadonlyMap<number, string> = new Map();

  constructor(agentId: string, publish: (spawned: GroupSpawned) => void) {
    this.agentId = agentId;
    this.publish = publish;
  }

  add(spawned: GroupSpawned): void {
    const owner = spawned.agentId ?? this.agentId;
    this.groups = new Map([...this.groups, [spawned.pid, owner]]);
    this.publish({ pid: spawned.pid, agentId: owner });
  }

  killAll(): number {
    const owners = new Set([this.agentId, ...this.groups.values()]);
    const groups = this.groups;
    this.groups = new Map();
    for (const pid of groups.keys()) signalProcess(-pid, 'SIGKILL');
    return owners.size;
  }
}
