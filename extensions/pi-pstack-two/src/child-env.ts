// A subagent learns its depth, its agent type, and its parent's pid from these variables. They are read once and
// removed, so commands the subagent runs (including a nested `pi` driven through bash) do not inherit them.
export const DEPTH_ENV = 'PI_PSTACK_TWO_DEPTH';
export const AGENT_ENV = 'PI_PSTACK_TWO_AGENT';
export const PARENT_ENV = 'PI_PSTACK_TWO_PARENT_PID';

export interface ChildIdentity {
  depth: number;
  agentType: string | undefined;
  parentPid: number | undefined;
}

function read(): ChildIdentity {
  const depth = Number(process.env[DEPTH_ENV] ?? '0');
  const parentPid = Number(process.env[PARENT_ENV] ?? '');
  return { depth: Number.isInteger(depth) && depth > 0 ? depth : 0, agentType: process.env[AGENT_ENV], parentPid: Number.isInteger(parentPid) && parentPid > 1 ? parentPid : undefined };
}

export const childIdentity: ChildIdentity = read();
delete process.env[DEPTH_ENV];
delete process.env[AGENT_ENV];
delete process.env[PARENT_ENV];

/** Variables for a child of this process at `depth` (an agent keeps the depth it was created at). */
export function childVariables(agentType: string, depth: number): Record<string, string> {
  return { [DEPTH_ENV]: String(depth), [AGENT_ENV]: agentType, [PARENT_ENV]: String(process.pid) };
}
