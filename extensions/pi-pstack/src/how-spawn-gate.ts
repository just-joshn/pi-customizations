import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const howSkillMarker = /<skill\s+name="how"(?:\s|>)/;
const blockedTools = new Set(['bash', 'powershell', 'read', 'grep', 'find', 'ls', 'edit', 'write']);

export const howSpawnGateMessage =
  'The how skill is active. Spawn one readonly Task (subagent_type generalPurpose, how explainer role) before direct exploration or the final answer (Step 2b / Step 2a).';

export const howSpawnUsageBlock = `<subagent_usage>
The how skill is active for this turn. Ignore "default to doing the work yourself" and the five-or-fewer direct-tool heuristic.
Step 1 chooses simple (Step 2b) or complex (Step 2a). Both require spawning Task before parent-tool exploration or the final answer.
- Simple: one readonly Task with subagent_type generalPurpose and the how explainer role.
- Complex: readonly explorer Tasks, then one readonly explainer Task.
Present the explainer output in Step 4. Do not answer from parent-tool exploration alone.
</subagent_usage>`;

const spawnReminder =
  'The how skill requires Step 2b (or 2a then 3) before the final answer. Spawn one readonly Task with subagent_type generalPurpose for the how explainer role now. Do not explore with bash/read/grep until that Task has started.';

export function howSkillPrompt(prompt: string): boolean {
  return howSkillMarker.test(prompt);
}

export function explainerTaskStarted(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName !== 'Task' && toolName !== 'task') return false;
  const prompt = typeof input['prompt'] === 'string' ? input['prompt'] : '';
  const readonly = input['readonly'] === true || /^\s*READONLY\b/i.test(prompt);
  if (!readonly) return false;
  const kind = input['subagent_type'] ?? input['agent_type'];
  if (kind === 'generalPurpose' || kind === 'general-purpose' || kind === 'general_purpose') return true;
  return kind === 'explore' && input['name'] === 'how-explainer';
}

export function registerHowSpawnGate(pi: ExtensionAPI): void {
  let armed = false;
  let spawned = false;
  let nudged = false;

  pi.on('before_agent_start', (event) => {
    armed = howSkillPrompt(event.prompt);
    spawned = false;
    nudged = false;
    if (!armed) return;
    event.systemPromptOptions.sections['subagent_usage'] = howSpawnUsageBlock;
  });

  pi.on('tool_call', (event) => {
    if (!armed) return;
    if (explainerTaskStarted(event.toolName, event.input as Record<string, unknown>)) {
      spawned = true;
      return;
    }
    if (spawned || !blockedTools.has(event.toolName)) return;
    return { block: true, reason: howSpawnGateMessage };
  });

  pi.on('agent_before_settle', (event) => {
    if (!armed || spawned || nudged || event.outcome !== 'completed') return;
    nudged = true;
    return {
      entries: [{ type: 'custom_message', customType: 'pstack-how-spawn', display: true, content: spawnReminder }],
      continue: true,
    };
  });

  pi.on('agent_end', () => {
    armed = false;
    spawned = false;
    nudged = false;
  });
}
