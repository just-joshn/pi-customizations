import { agentTeamsEnabled, envEnabled } from './gates.ts';
import { AgentPreconditionError } from './precondition-error.ts';

export type TeammateCaller = Readonly<{ teammate: boolean; addressableWorkers: boolean }>;

export type TeammateSpawn = Readonly<{
  name?: string;
  runInBackground?: boolean;
  definition?: Readonly<{ agentType: string; background?: boolean }>;
  /** Set once an agent.spawn rewrite has produced the final launch, so the effective mode can be rechecked. */
  rewritten?: Readonly<{ background: boolean; remote: boolean }>;
}>;

export const nestedTeammateMessage = 'Teammates cannot spawn other teammates — the team roster is flat. To spawn a subagent instead, omit the `name` parameter.';
export const teammateBackgroundMessage = 'In-process teammates cannot spawn background agents. Use run_in_background=false for synchronous subagents.';
const definitionBackgroundMessage = (agentType: string) => `In-process teammates cannot spawn background agents. Agent '${agentType}' has background: true in its definition.`;
export const hookBackgroundMessage = "In-process teammates cannot spawn background agents; a plugin's agent.spawn hook backgrounded this one.";

export function teammateCaller(env: NodeJS.ProcessEnv): TeammateCaller {
  return { teammate: envEnabled(env.PSTACK_TEAMMATE), addressableWorkers: envEnabled(env.CLAUDE_CODE_ADDRESSABLE_WORKERS) };
}

function refuse(code: 'subagent_nested_teammate' | 'subagent_teammate_background_denied', message: string): never {
  throw new AgentPreconditionError({ code, message });
}

/** Checks run in the recovered order, each only when the data it needs is present, so callers can invoke it again after a spawn rewrite. */
export function assertTeammateSpawnAllowed(spawn: TeammateSpawn, caller: TeammateCaller): void {
  if (!caller.teammate) return;
  if (spawn.name !== undefined && !caller.addressableWorkers) refuse('subagent_nested_teammate', nestedTeammateMessage);
  if (spawn.runInBackground === true) refuse('subagent_teammate_background_denied', teammateBackgroundMessage);
  if (spawn.definition?.background === true) refuse('subagent_teammate_background_denied', definitionBackgroundMessage(spawn.definition.agentType));
  if (spawn.rewritten?.background && !spawn.rewritten.remote) refuse('subagent_teammate_background_denied', hookBackgroundMessage);
}

export type TeammateDispatchInput = Readonly<{ env: NodeJS.ProcessEnv; name?: string; agentType?: string; isolation?: string; cwd?: string; caller: TeammateCaller }>;

const localOnlyTypes = new Set(['web-fetch', 'fork']);

/** The legacy dispatch branch: a team context, a name and no isolation or cwd, while addressable workers are not rolled out. */
export function dispatchesTeammate({ env, name, agentType, isolation, cwd, caller }: TeammateDispatchInput): boolean {
  if (!agentTeamsEnabled(env) || caller.teammate || caller.addressableWorkers) return false;
  if (name === undefined || isolation !== undefined || cwd !== undefined) return false;
  return agentType === undefined || !localOnlyTypes.has(agentType);
}
