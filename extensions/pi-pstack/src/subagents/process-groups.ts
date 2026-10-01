import { Type } from 'typebox';
import { Check } from 'typebox/value';

export const processGroupEvent = 'pstack:process-group';

const GroupSpawned = Type.Object({ pid: Type.Integer({ minimum: 1 }), agentId: Type.Optional(Type.String({ minLength: 1 })) });
export type GroupSpawned = Readonly<{ pid: number; agentId?: string }>;

export function groupSpawned(payload: unknown): GroupSpawned | undefined {
  return Check(GroupSpawned, payload) ? payload : undefined;
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group already exited; there is nothing left to kill.
  }
}

/** OS process groups spawned during one agent run and by its descendants, keyed by group leader pid. */
export class ProcessGroups {
  private groups: ReadonlyMap<number, string> = new Map();

  constructor(
    private readonly agentId: string,
    private readonly publish: (spawned: GroupSpawned) => void,
  ) {}

  add(spawned: GroupSpawned): void {
    const owner = spawned.agentId ?? this.agentId;
    this.groups = new Map([...this.groups, [spawned.pid, owner]]);
    this.publish({ pid: spawned.pid, agentId: owner });
  }

  killAll(): number {
    const owners = new Set([this.agentId, ...this.groups.values()]);
    for (const pid of this.groups.keys()) killGroup(pid);
    return owners.size;
  }
}
