// A subagent learns its depth, its agent type, whether it is readonly, its parent's pid, and the main chat's store and workspace state from these variables. They are read once and
// removed, so commands the subagent runs (including a nested `pi` driven through bash) do not inherit them.
export const DEPTH_ENV = 'PI_PSTACK_DEPTH';
export const AGENT_ENV = 'PI_PSTACK_AGENT';
export const PARENT_ENV = 'PI_PSTACK_PARENT_PID';
export const READONLY_ENV = 'PI_PSTACK_READONLY';
export const ROOT_STORE_ENV = 'PI_PSTACK_ROOT_STORE';
export const WORKSPACE_ENV = 'PI_PSTACK_WORKSPACE_STATE';

export interface ChildIdentity {
  depth: number;
  agentType: string | undefined;
  parentPid: number | undefined;
  readonly: boolean;
  rootStore: string | undefined;
  /** The main chat's workspace state folder, which every agent in the tree shares, an isolated worker included. */
  workspaceState: string | undefined;
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
    workspaceState: process.env[WORKSPACE_ENV] || undefined,
  };
}

export const childIdentity: ChildIdentity = read();
delete process.env[DEPTH_ENV];
delete process.env[AGENT_ENV];
delete process.env[PARENT_ENV];
delete process.env[READONLY_ENV];
delete process.env[ROOT_STORE_ENV];
delete process.env[WORKSPACE_ENV];

/** Variables for a child of this process at `depth` (an agent keeps the depth it was created at). */
export function childVariables(agentType: string, depth: number, readonly: boolean, rootStore: string, workspaceState: string): Record<string, string> {
  return { [DEPTH_ENV]: String(depth), [AGENT_ENV]: agentType, [PARENT_ENV]: String(process.pid), [ROOT_STORE_ENV]: rootStore, [WORKSPACE_ENV]: workspaceState, ...(readonly ? { [READONLY_ENV]: '1' } : {}) };
}
