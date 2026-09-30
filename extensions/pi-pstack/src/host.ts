import { join } from 'node:path';

import { type ExtensionContext, getDocsPath } from '@earendil-works/pi-coding-agent';
import { modelConfigPath } from './models.ts';

export const referenceToolNames =
  'Upstream prose names Reference tools. Read is the read tool, Shell is bash, Grep is grep, and Glob is find. A /skill:name or /poteto-mode invocation appears in the transcript as a <skill name="..."> block in the user message, not as a read call.';

export function hostInstructions(root: string, ctx: ExtensionContext, rule: string): string {
  const manager = ctx.sessionManager;
  const childTranscripts = manager.getSessionFile() ? join(manager.getSessionDir(), 'pstack-workers', '<parent-session-id>') : 'a temporary pstack-workers directory, because this session is not persisted';
  return [
    'pstack pi host contract. Follow the bundled workflow instructions in full. Preserve their gates and report missing dependencies.',
    `Bundled skills: ${join(root, 'skills')}. Immutable source including agents and dormant Benny pack: ${join(root, 'upstream')}.`,
    'Workflow aliases are Pi prompt templates. When one requests a skill, read its SKILL.md in full from the bundled skills directory and resolve references relative to that skill directory. /bro is a standalone prompt template. Only /poteto-mode, /setup-pstack, /pstack, and /goal are executable extension commands.',
    `team-kit is bundled at ${join(root, 'upstream-team-kit')}. Its skills, including deslop, control-cli, control-ui and verify-this, are in the same generated skills directory. Read the relevant SKILL.md in full before applying it. Its two rules remain archived, matching observed Reference plugin delivery.`,
    `Read model role overrides at ${modelConfigPath()}. This is the Pi mapping of ~/.upstream/rules/pstack-models.mdc. The active rule follows:\n${rule || 'No override. Upstream defaults remain requests, not confirmed available models.'}`,
    'Only apply active Poteto mode to tasks matching its own scope.',
    `Workspace Pi session directory: ${manager.getSessionDir()}. Task child transcripts: ${childTranscripts}. Transcript-reading skills use these directories. Reference chat links in upstream prose are source-host references; do not invent them or read other workspaces to fill gaps.`,
    'control-cli and control-ui provide local harness instructions, not installed terminal or browser tooling. Discover and use the project tools as those skills require. pr-review-canvas assets are bundled, but Pi has no Reference in-app browser. Use available local browser tooling only when it satisfies the workflow. workflow-from-chats can inspect Pi workspace history through pstack_context; identify that corpus and cite real parent session IDs without exposing private transcript paths or inventing Reference links.',
    `/loop is a Pi prompt template for the local loop skill at ${join(root, 'host/skills/loop/SKILL.md')}. When a playbook arms a terminal /loop tick, follow that skill.`,
    '/goal is native. CreateGoal arms a goal, GetGoal reads it back, and UpdateGoal completes it after an audit. A playbook that says to arm a /goal calls CreateGoal itself. Reference cloud hosting, the /automate editor and Grok Bot routines are not implemented here. MCP connectors and service credentials remain external dependencies. Stop the affected workflow at its unmet gate and name what is missing. Do not fabricate equivalent verification or approvals.',
    `Upstream prose also names Reference facilities. A Reference rule becomes an AGENTS.md context file for a directory tree, or APPEND_SYSTEM.md for system prompt additions. Pi skills load on demand, so guidance that must apply on every turn belongs in a context file. Where a workflow calls for Reference's create-skill, follow ${join(root, 'host/skills/create-skill/SKILL.md')}, which targets Pi's format in ${join(getDocsPath(), 'skills.md')}. The goal skill is ${join(root, 'host/skills/goal/SKILL.md')}. The origin CLI setup and repair skill is ${join(root, 'host/skills/origin/SKILL.md')}. Where a workflow lists MCP servers, classify the tools that pstack_context returns.`,
    referenceToolNames,
    'Benny is a dormant source pack, not a registered automation. Its Reference reviewed-editor creation and credential-isolation requirements remain unsatisfied by this extension.',
    `This session transcript is ${ctx.sessionManager.getSessionFile() ?? 'in memory'}. Workspace is ${ctx.cwd}.`,
  ].join('\n\n');
}
