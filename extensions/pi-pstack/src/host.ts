import { join } from 'node:path';

import { type ExtensionContext, getDocsPath } from '@earendil-works/pi-coding-agent';
import { modelConfigPath } from './models.ts';

export const referenceToolNames =
  'Upstream prose names Reference tools. Read is the read tool, Shell is bash, Grep is grep, and Glob is find. A /skill:name or /poteto-mode invocation appears in the transcript as a <skill name="..."> block in the user message, not as a read call.';

export function hostInstructions(root: string, ctx: ExtensionContext, rule: string, catalog: string): string {
  const manager = ctx.sessionManager;
  const childTranscripts = manager.getSessionFile() ? join(manager.getSessionDir(), 'pstack-workers', manager.getSessionId()) : 'a temporary pstack-workers directory, because this session is not persisted';
  return [
    'pstack pi host contract. Follow the bundled workflow instructions in full.',
    catalog,
    `Reference snapshots live at ${join(root, 'upstream')} and ${join(root, 'upstream-team-kit')}.`,
    '/poteto-mode, /setup-pstack, /pstack, and /goal are extension commands. Every other workflow name, including the team-kit skills, is a prompt template that reads the matching SKILL.md.',
    `Model role overrides live at ${modelConfigPath()}, the Pi location of ~/.upstream/rules/pstack-models.mdc. The active rule follows:\n${rule || 'No override. Each role uses its skill default.'}`,
    `Pi session storage directory: ${manager.getSessionDir()}. The storage directory may contain other workspaces. For workspace history, call pstack_context({ history: true }) and use only its matching transcript paths. Do not glob or mine the entire storage directory. Discovery completeness is unknown. Task child transcripts owned by this parent session: ${childTranscripts}. Transcript-reading skills must distinguish storage location from workspace scope. workflow-from-chats reads this history through pstack_context.`,
    `/loop is a Pi prompt template for the local loop skill at ${join(root, 'host/skills/loop/SKILL.md')}. When a playbook arms a /loop tick, follow that skill with BackgroundShell.`,
    '/goal is native. CreateGoal arms a goal, GetGoal reads it back, and UpdateGoal completes it after an audit. A playbook that says to arm a /goal calls CreateGoal itself.',
    `A Reference rule becomes an AGENTS.md context file for a directory tree, or APPEND_SYSTEM.md for system prompt additions. Pi skills load on demand, so guidance that must apply on every turn belongs in a context file. Where a workflow calls for Reference's create-skill, follow ${join(root, 'host/skills/create-skill/SKILL.md')}, which targets Pi's format in ${join(getDocsPath(), 'skills.md')}. Where a workflow lists MCP servers, classify the tools that pstack_context returns.`,
    referenceToolNames,
    `This session transcript is ${ctx.sessionManager.getSessionFile() ?? 'in memory'}. Workspace is ${ctx.cwd}.`,
  ].join('\n\n');
}
