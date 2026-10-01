export function envEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

export function backgroundTasksDisabled(env: NodeJS.ProcessEnv): boolean {
  return envEnabled(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS);
}

export function forkGateEnabled(env: NodeJS.ProcessEnv): boolean {
  return envEnabled(env.CLAUDE_CODE_FORK_SUBAGENT);
}

export function agentTeamsEnabled(env: NodeJS.ProcessEnv): boolean {
  return envEnabled(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS);
}

export function modelForced(env: NodeJS.ProcessEnv): boolean {
  return Boolean((env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? env.PI_SUBAGENT_MODEL_FORCE)?.trim());
}

export function safeModeEnabled(env: NodeJS.ProcessEnv): boolean {
  return envEnabled(env.CLAUDE_CODE_SAFE_MODE);
}
