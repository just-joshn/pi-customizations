import type { AgentDefinition } from './agent-definition.ts';
import type { SubagentSettingsEntry } from './settings.ts';

export const toolHeader = 'Launch specialized agents in separate context windows for specific tasks.';

const fewCalls = 'Do not delegate work you can finish in five or fewer direct tool calls.';
const backgroundOnly = 'Use background mode only while doing independent work; do not poll.';
const waitThenStop = "Need a background result before proceeding? Say you're waiting and stop. After notification, read once; don't poll or duplicate its work.";
const noWorkerPool = 'Never process an independent batch with a fixed write_agent worker pool.';
const sinceTurn = 'Use read_agent with since_turn to get only new responses without re-reading earlier turns.';

export const delegationHeuristics: readonly string[] = [fewCalls, backgroundOnly, waitThenStop, noWorkerPool, sinceTurn];

export const subagentNamespace = { name: 'subagents', description: 'Delegate work to specialized agents that run in separate context windows.', instructions: delegationHeuristics.join('\n') } as const;
const childHeuristics: readonly string[] = [fewCalls, backgroundOnly, noWorkerPool];

const rubberDuckGuidance = 'Call rubber-duck synchronously after planning and before implementation, so its critique can change the plan.';
const securityReviewContract = 'When you call security-review, include the change under review and what it must protect, and verify its findings before you act on them.';

export function taskToolDescription(offered: readonly AgentDefinition[]): string {
  const builtIn = offered.filter((agent) => agent.source === 'built-in');
  const custom = offered.filter((agent) => agent.source !== 'built-in');
  const line = (agent: AgentDefinition) => `- ${agent.name}: ${agent.description}`;
  const sections = [
    toolHeader,
    `Available agent types:\n${builtIn.map(line).join('\n')}`,
    ...(custom.length > 0 ? [`Custom agents provided by the user:\n${custom.map(line).join('\n')}`] : []),
    'Each agent starts with no knowledge of your conversation: write a complete prompt. Its result comes back to you as a single message.',
    'mode "sync" waits for the result. mode "background" returns an agent_id at once and you are notified when the agent finishes.',
  ];
  return sections.join('\n\n');
}

export function subagentUsageBlock(options: { rubberDuck: boolean; securityReview: boolean }): string {
  const bullets = [...delegationHeuristics, 'Use custom agents sparingly.', ...(options.rubberDuck ? [rubberDuckGuidance] : []), ...(options.securityReview ? [securityReviewContract] : [])];
  return `<subagent_usage>\nDefault to doing the work yourself. Delegate only when a separate context window clearly helps.\n${bullets.map((bullet) => `- ${bullet}`).join('\n')}\n</subagent_usage>`;
}

export function childSubagentUsageBlock(): string {
  return `<subagent_usage>\nDefault to doing the work yourself.\n${childHeuristics.map((bullet) => `- ${bullet}`).join('\n')}\nAs a sub-agent, complete your parent's task yourself; use another general-purpose agent only if the parent explicitly requests nested delegation.\n</subagent_usage>`;
}

export function modelPreferencesBlock(agents: Readonly<Record<string, SubagentSettingsEntry>>): string | undefined {
  const lines = Object.entries(agents).flatMap(([name, entry]) => {
    if (entry.model === undefined) return [];
    return [`- ${name}: ${entry.model} (${entry.modelPolicy ?? 'preferred'}${entry.effortLevel ? `, effort ${entry.effortLevel}` : ''})`];
  });
  if (lines.length === 0) return undefined;
  return `<subagent_model_preferences>\nThe user configured these subagent models in /subagents:\n${lines.join('\n')}\nDo not copy them into task calls unless the user or persistent instructions require an explicit model. Required entries are enforced anyway.\n</subagent_model_preferences>`;
}
