import { envEnabled } from './gates.ts';

export type RemoteInputs = Readonly<{
  env: NodeJS.ProcessEnv;
  restricted: boolean;
  hasDisk: boolean;
  piResolvable: boolean;
  optedIn: boolean;
  hasGitRoot: boolean;
}>;

export type IsolationRoute = Readonly<{ effective: 'remote' | 'worktree' | undefined; log?: string }>;

export function remoteOptIn(env: NodeJS.ProcessEnv, setting: unknown): boolean {
  return envEnabled(env.PSTACK_REMOTE_ISOLATION) || setting === true;
}

function remoteEligible({ env, restricted, hasDisk, piResolvable, optedIn }: RemoteInputs): boolean {
  if (envEnabled(env.CLAUDE_CODE_EVAL_CONFINED) || !hasDisk || envEnabled(env.CLAUDE_CODE_REMOTE)) return false;
  return !restricted && piResolvable && optedIn;
}

function unavailableReason(inputs: RemoteInputs): string {
  if (envEnabled(inputs.env.CLAUDE_CODE_REMOTE)) return '(already inside a CCR session); running as a local agent';
  if (!inputs.hasDisk) return '(the session has no disk); running as a local agent';
  const gate = inputs.restricted ? '(--restricted)' : '(no resolvable pi binary or remote isolation is not enabled)';
  const gitUsable = !envEnabled(inputs.env.CLAUDE_CODE_EVAL_CONFINED) && inputs.hasGitRoot;
  return gitUsable ? `${gate}; falling back to isolation:'worktree'` : `${gate} and no git root; running as a local agent`;
}

export function routeRemote(inputs: RemoteInputs): IsolationRoute {
  if (remoteEligible(inputs)) return { effective: 'remote' };
  const reason = unavailableReason(inputs);
  return { effective: reason.includes("isolation:'worktree'") ? 'worktree' : undefined, log: `[remote agent] isolation:'remote' is unavailable ${reason}` };
}
