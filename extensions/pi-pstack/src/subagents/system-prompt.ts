import type { AgentDefinition } from './definitions.ts';

export function appendedSubagentPrompt(prompt: string | undefined, env: NodeJS.ProcessEnv): string {
  const enabled = ['1', 'true', 'yes', 'on'].includes(env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT?.trim().toLowerCase() ?? '');
  return enabled && prompt ? `\n${prompt}` : '';
}

export function agentSystemPrompt(definition: AgentDefinition): string {
  const reminder = definition.criticalSystemReminder_EXPERIMENTAL;
  return definition.systemPrompt + (reminder ? `\n<critical-system-reminder>\n${reminder}\n</critical-system-reminder>` : '');
}
