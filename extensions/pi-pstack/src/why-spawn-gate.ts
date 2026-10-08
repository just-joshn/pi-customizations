import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const whySkillMarker = /<skill\s+name="why"(?:\s|>)/;
const blockedAfterNudge = new Set(['bash', 'powershell', 'read', 'grep', 'find', 'ls', 'edit', 'write']);

export const whySpawnGateMessage =
  'The why skill is active. Spawn at least one investigator Task (subagent_type generalPurpose, why investigators role) before more parent-tool exploration or the final answer (Step 3).';

export const whySpawnUsageBlock = `<subagent_usage>
The why skill is active for this turn. Ignore "default to doing the work yourself" and the five-or-fewer direct-tool heuristic.
Step 2 may use bash/read/grep only to build the code anchor. Step 3 must spawn parallel investigator Task agents (subagent_type generalPurpose, why investigators role) before synthesizing.
Do not answer from parent-tool exploration alone. Source control is always available; spawn that investigator even when other MCP categories are absent.
</subagent_usage>`;

const spawnReminder =
  'The why skill requires Step 3 investigator Task agents before the final answer. Spawn at least one Task with subagent_type generalPurpose for the why investigators role now. Do not finish from bash/read alone.';

export function whySkillPrompt(prompt: string): boolean {
  return whySkillMarker.test(prompt);
}

export function investigatorTaskStarted(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName !== 'Task' && toolName !== 'task') return false;
  const kind = input['subagent_type'] ?? input['agent_type'];
  if (kind === 'generalPurpose' || kind === 'general-purpose' || kind === 'general_purpose') return true;
  const name = typeof input['name'] === 'string' ? input['name'] : '';
  return /why[-_]?investigat/i.test(name);
}

export function registerWhySpawnGate(pi: ExtensionAPI): void {
  let armed = false;
  let spawned = false;
  let nudged = false;

  pi.on('before_agent_start', (event) => {
    armed = whySkillPrompt(event.prompt);
    spawned = false;
    nudged = false;
    if (!armed) return;
    event.systemPromptOptions.sections['subagent_usage'] = whySpawnUsageBlock;
  });

  pi.on('tool_call', (event) => {
    if (!armed) return;
    if (investigatorTaskStarted(event.toolName, event.input as Record<string, unknown>)) {
      spawned = true;
      return;
    }
    if (spawned || !nudged || !blockedAfterNudge.has(event.toolName)) return;
    return { block: true, reason: whySpawnGateMessage };
  });

  pi.on('agent_before_settle', (event) => {
    if (!armed || spawned || nudged || event.outcome !== 'completed') return;
    nudged = true;
    return {
      entries: [{ type: 'custom_message', customType: 'pstack-why-spawn', display: true, content: spawnReminder }],
      continue: true,
    };
  });

  pi.on('agent_end', () => {
    armed = false;
    spawned = false;
    nudged = false;
  });
}
