export const rubberDuckExperiment = 'copilot_cli_rubber_duck_gpt_claude';

function listed(value: string | undefined): readonly string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function featureEnabled(env: NodeJS.ProcessEnv, name: string): boolean {
  const wanted = name.toLowerCase();
  return [...listed(env.COPILOT_CLI_ENABLED_FEATURE_FLAGS), ...listed(env.COPILOT_EXPERIMENTS)].includes(wanted);
}

export function rubberDuckRollout(env: NodeJS.ProcessEnv): boolean {
  return featureEnabled(env, rubberDuckExperiment) || featureEnabled(env, 'RUBBER_DUCK_AGENT');
}

export function subconsciousEnabled(env: NodeJS.ProcessEnv): boolean {
  return ['1', 'true', 'yes', 'on'].includes(env.COPILOT_SUBCONSCIOUS?.trim().toLowerCase() ?? '') || featureEnabled(env, 'COPILOT_SUBCONSCIOUS');
}
