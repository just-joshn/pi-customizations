import { join } from 'node:path';

import type { AgentDefinition } from './task/agents.ts';
import { type AvailableModel, modelLabel } from './task/models.ts';

export interface HostFacts {
  packageRoot: string;
  skillsDir: string;
  skillNames: readonly string[];
  agentDir: string;
  rulePath: string;
  sessionDir: string;
  sessionFile: string | undefined;
  subagentDir: string;
  storeDir: string;
  /** False in print and JSON runs, including subagents, which exit when they settle. */
  loopAvailable: boolean;
  /** False when nobody can answer a dialog (print and JSON runs, including subagents). */
  questionsAvailable: boolean;
}

const LOOP_LINE =
  '- /loop: the user starts `/loop [interval] <prompt>`. When a playbook says to arm /loop, call the Loop tool with prompt plus interval (fixed cadence) or wake_in (agent-paced). Inside a loop, Loop with wake_in schedules the next run and stop: true ends it.';
const NO_LOOP_LINE =
  '- /loop: this run ends when it settles (a subagent, or a print or JSON run), so it has no Loop tool and cannot arm a loop. Keep working until the goal is met, and name in the final reply anything the parent chat should loop on.';

const MODEL_LIST_LIMIT = 60;

/** The Cursor-to-Pi map that pstack's skill text needs, the way Cursor's system prompt names its own paths. */
export function hostSection(facts: HostFacts): string {
  const transcript = facts.sessionFile === undefined ? 'This chat is not persisted (--no-session), so it has no transcript file.' : `This chat's transcript is ${facts.sessionFile}.`;
  return [
    'pstack runs here through the pi-pstack package. Its skills were written for Cursor; read their Cursor references through this map.',
    `- <SKILLS> = ${facts.skillsDir}. "the X skill", "/X", and "principle-X" mean <SKILLS>/X/SKILL.md, even for skills hidden from automatic invocation. Installed skills (${facts.skillNames.length}): ${facts.skillNames.join(', ')}.`,
    '- A <skill> block in a user message means the user attached that skill to this request (Cursor: a manually attached skill). Follow its workflow from its first step, including the steps it says to take before answering, instead of answering directly.',
    `- Cursor's built-in create-skill skill is <SKILLS>/create-skill/SKILL.md. \`.cursor/skills/\` means \`.pi/skills/\`; \`~/.cursor/skills/\` means \`${join(facts.agentDir, 'skills')}/\`.`,
    `- \`~/.cursor/rules/pstack-models.mdc\` means ${facts.rulePath}. Read and write only that file and never write under ~/.cursor. Its current content is in <pstack_models>.`,
    '- Subagents: call the Task tool as the skills describe (subagent_type, model, readonly, run_in_background, resume). Types and model slugs are in <pstack_subagents>. A background agent notifies you after your turn ends; do not poll it.',
    facts.questionsAvailable
      ? '- Todo lists: the TodoWrite tool. Structured questions: the AskQuestion tool.'
      : '- Todo lists: the TodoWrite tool. Structured questions: the AskQuestion tool, but nobody can answer in this run, so every question comes back skipped; decide yourself and say what you chose.',
    `- Transcripts: \`agent-transcripts/\` and \`~/.cursor/projects/<slug>/agent-transcripts/\` mean ${facts.sessionDir}, Pi session JSONL files for this workspace. Each line is an entry: the first is a session header, and conversation turns have type "message" (the opening prompt is the first user message). ${transcript} Subagent transcripts for this workspace: ${facts.subagentDir}/*_<agent id>.jsonl. A subagent is still running while ${facts.subagentDir}/<agent id>.lock exists and names a live pid.`,
    '- Cursor tool names in pstack text: Read is read, Grep is grep, Glob is find, Shell is bash. A skill under `~/.cursor/plugins/` is one under <SKILLS>, and this package is the only pstack copy, so a search of `~/.cursor/plugins/` for `skills/<name>/SKILL.md` ends at <SKILLS>/<name>/SKILL.md. In a Pi transcript a tool call is a toolCall part of an assistant message (tool name plus arguments), and an attached skill is a <skill name="..." location="..."> block in a user message.',
    `- "The current agent's store" (orchestrate's store layout) is ${facts.storeDir}. Create it when a playbook needs it, and pass it to orch as --store.`,
    facts.loopAvailable ? LOOP_LINE : NO_LOOP_LINE,
    "- Image generation (the image tool teach reaches for, ketchup's generated image): Pi generates images through codemode's models.generateImages() when codemode is on and an image model is configured. Otherwise say no image tool is available and use a mermaid diagram or a table. Cursor's `/visualize` charts have no Pi counterpart, so draw a chart as a mermaid diagram (xychart-beta for numbers).",
    "- Custom Mode (Cursor's Option+Enter): the user runs `/mode <skill>` to keep a skill on every turn and `/mode off` to exit.",
    `- A link to \`https://github.com/cursor/plugins/blob/main/pstack/<path>\` means ${facts.packageRoot}/<path> when that file exists (skills/, agents/, docs/). Read the local copy instead of fetching it, and give the user the URL when they need a link.`,
    '- Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. A built-in PR tool means the forge command the step gives, such as `gh pr create`.',
    '- A step that needs a Cursor-only feature with no Pi counterpart gets one line in your reply, `Skipped in Pi: <step>. <reason>.`, and you go on to the next step without stopping, asking, or retrying. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in that line.',
    '- MCP tools are named mcp__<server>__<tool>; `pi mcp list` shows the servers.',
    `- pstack's guide describes Cursor. Pi usage is in ${join(facts.packageRoot, 'README.md')}.`,
    '- Cloud subagents (environment "cloud") run on this machine in their own git worktree on branch pstack/<agent id>, created from cloud_base_branch or this checkout\'s HEAD commit, so uncommitted changes do not reach them. The Task result names the worktree and branch; merge that branch to take the subagent\'s work. Pi never deletes these worktrees or branches; the worktree-cleanup playbook prunes them. Grok Bot routines (update_state, SendToUser) and Cursor Automations (routines, api2.cursor.sh/automations webhooks, routine wakes) have no Pi counterpart, so a step that needs one gets the Skipped in Pi line.',
  ].join('\n');
}

function agentLine(agent: AgentDefinition): string {
  const notes = [agent.type === 'generalPurpose' ? 'default' : undefined, agent.background ? 'runs in the background unless run_in_background is false' : undefined, agent.readonly ? 'readonly' : undefined].filter(
    (note) => note !== undefined,
  );
  return `- ${agent.type}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}: ${agent.description}`;
}

/** Cursor puts these lists in <available_subagent_types> and <available_subagent_models>; Task's description points here. */
export function subagentsSection(agents: readonly AgentDefinition[], models: readonly AvailableModel[]): string {
  const shown = models.slice(0, MODEL_LIST_LIMIT).map(modelLabel);
  const more = models.length > MODEL_LIST_LIMIT ? `, and ${models.length - MODEL_LIST_LIMIT} more (pi --list-models)` : '';
  return [
    'Subagent types for Task:',
    ...agents.map(agentLine),
    'Model values for Task (and for role lines in the model rule):',
    '- inherit (default): the parent model and thinking level. auto and inherit-parent mean the same.',
    '- A Cursor-style slug <model-id>-<effort>[-fast], effort one of the thinking levels the model lists below; the effort becomes the thinking level and -fast is ignored.',
    '- A Pi model <provider>/<model-id> or <model-id>, optionally with :<level> from the same list. A level the model does not list is rejected.',
    "- Cursor model parameters: <model>[effort=<level>,fast=true|false,context=<size>]. effort is the thinking level, fast=true picks the model's -fast id when one is listed, [] or fast=false keeps the standard model, and context has no effect in Pi.",
    `Available models: ${shown.join(', ') || 'none with configured credentials'}${more}`,
  ].join('\n');
}
