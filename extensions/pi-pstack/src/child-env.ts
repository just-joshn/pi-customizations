// A subagent learns its depth, its agent type, whether it is readonly, its parent's pid, and the main chat's store from these variables. They are read once and
// removed, so commands the subagent runs (including a nested `pi` driven through bash) do not inherit them.
export const DEPTH_ENV = 'PI_PSTACK_DEPTH';
export const AGENT_ENV = 'PI_PSTACK_AGENT';
export const PARENT_ENV = 'PI_PSTACK_PARENT_PID';
export const READONLY_ENV = 'PI_PSTACK_READONLY';
export const ROOT_STORE_ENV = 'PI_PSTACK_ROOT_STORE';

export interface ChildIdentity {
  depth: number;
  agentType: string | undefined;
  parentPid: number | undefined;
  readonly: boolean;
  rootStore: string | undefined;
}

function read(): ChildIdentity {
  const depth = Number(process.env[DEPTH_ENV] ?? '0');
  const parentPid = Number(process.env[PARENT_ENV] ?? '');
  return {
    depth: Number.isInteger(depth) && depth > 0 ? depth : 0,
    agentType: process.env[AGENT_ENV],
    parentPid: Number.isInteger(parentPid) && parentPid > 1 ? parentPid : undefined,
    readonly: process.env[READONLY_ENV] === '1',
    rootStore: process.env[ROOT_STORE_ENV] || undefined,
  };
}

export const childIdentity: ChildIdentity = read();
delete process.env[DEPTH_ENV];
delete process.env[AGENT_ENV];
delete process.env[PARENT_ENV];
delete process.env[READONLY_ENV];
delete process.env[ROOT_STORE_ENV];

/** Variables for a child of this process at `depth` (an agent keeps the depth it was created at). */
export function childVariables(agentType: string, depth: number, readonly: boolean, rootStore: string): Record<string, string> {
  return { [DEPTH_ENV]: String(depth), [AGENT_ENV]: agentType, [PARENT_ENV]: String(process.pid), [ROOT_STORE_ENV]: rootStore, ...(readonly ? { [READONLY_ENV]: '1' } : {}) };
}
