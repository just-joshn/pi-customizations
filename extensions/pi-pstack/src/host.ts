import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

import { type ExtensionContext, getAgentDir, getDocsPath } from '@earendil-works/pi-coding-agent';
import { modelConfigPath, projectModelConfigPath } from './models.ts';
import { childStorageDir } from './subagents/agent-storage.ts';

export const referenceToolNames =
  'Upstream prose names Reference tools. Read is the read tool, Shell is bash, Grep is grep, and Glob is find. A /skill:name or /poteto-mode invocation appears in the transcript as a <skill name="..."> block in the user message, not as a read call.';

const noOverride =
  "No override. Roles without a line keep their skill defaults. Resolve each default to an available Pi model ID. Apply the skill's fallback policy and report any model change. An omitted Task model inherits the parent; it does not select a workflow role default.";
const webTools =
  "Reference WebSearch and WebFetch have no built-in Pi tool. Prefer a web search tool that another extension registers in the active tool list. Otherwise use bash: curl -sL --max-time 20 -A 'Mozilla/5.0' 'https://www.bing.com/search?q=<url-encoded query>' searches, and curl -sL --max-time 20 <url> fetches a page. Result links in the search HTML are redirects whose u= parameter is the target URL in base64 after a two-character a1 prefix.";
const imageTool =
  'Reference image generation has no built-in Pi tool. Use an image tool that another extension registers. Otherwise write a self-contained SVG file in marker-on-whiteboard style with few short labels, or a mermaid diagram for a label-driven flow, and say that the picture is a substitute.';
const originCli = 'The origin CLI is present when `command -v origin || test -x ~/.local/bin/origin` succeeds. Load the origin host skill to repair a missing or unauthenticated CLI before any gh fallback on an the origin host remote.';
const dashboard = 'Reference dashboard cloud-agent status maps to TaskList({ repository: true }) and TaskAttach, which read status without a prompt.';

export function agentStore(cwd: string): string {
  const slug = `${basename(cwd).replace(/[^\w.-]+/g, '-')}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;
  return join(getAgentDir(), 'pstack', 'store', slug);
}

function storeInstructions(cwd: string): string {
  const store = agentStore(cwd);
  return `Agent store: ${store}.\nOrchestrate state lives in orchestrate/<project-slug>/ under ${store}, and plans default to ${store}/docs/ unless the operator names a path. orch takes --store or ORCH_STORE, so export ORCH_STORE=${store}/orchestrate/<project-slug> before the first orch call.`;
}

export function hostInstructions(root: string, ctx: ExtensionContext, rule: string, catalog = ''): string {
  const manager = ctx.sessionManager;
  const childTranscripts = manager.getSessionFile()
    ? `${childStorageDir(manager.getSessionDir(), manager.getSessionId())} and, for runs before the agent-<id>.jsonl layout, ${join(manager.getSessionDir(), 'pstack-workers', manager.getSessionId())}`
    : 'temporary directories, because this session is not persisted';
  return [
    'pstack pi host contract. Follow the bundled workflow instructions in full.',
    catalog,
    `Reference snapshots live at ${join(root, 'upstream')} and ${join(root, 'upstream-team-kit')}.`,
    '/poteto-mode, /setup-pstack, /pstack, and /goal are extension commands. Every other workflow name, including the team-kit skills, is a prompt template that reads the matching SKILL.md.',
    `Model role overrides live at ${modelConfigPath()}, the Pi location of ~/.upstream/rules/pstack-models.mdc. A project rule at ${projectModelConfigPath(ctx.cwd)} overrides the user rule for the roles it names when the file exists. The active rule follows:\n${rule || noOverride}`,
    `Pi session storage directory: ${manager.getSessionDir()}. The storage directory may contain other workspaces. For workspace history, call pstack_context({ history: true }) and use only its matching transcript paths. Do not glob or mine the entire storage directory. Discovery completeness is unknown. Task child transcripts owned by this parent session: ${childTranscripts}. Transcript-reading skills must distinguish storage location from workspace scope. workflow-from-chats reads this history through pstack_context.`,
    `/loop is a Pi prompt template for the local loop skill at ${join(root, 'host/skills/loop/SKILL.md')}. When a playbook arms a /loop tick, follow that skill with BackgroundShell.`,
    'SubscribeTimer runs fixed-delay or cron subscriptions in an explicitly named durable Pi root. ListSubscriptions reads that root and Unsubscribe cancels and drains a subscription. Timer roots continue after this UI closes. Their transcripts are separate from this active session. No timer starts merely because pstack loads.',
    '/goal is native. CreateGoal arms a goal, GetGoal reads it back, and UpdateGoal completes it after an audit. A playbook that says to arm a /goal calls CreateGoal itself.',
    `A Reference rule becomes an AGENTS.md context file for a directory tree, or APPEND_SYSTEM.md for system prompt additions. Pi skills load on demand, so guidance that must apply on every turn belongs in a context file. Where a workflow calls for Reference's create-skill, follow ${join(root, 'host/skills/create-skill/SKILL.md')}, which targets Pi's format in ${join(getDocsPath(), 'skills.md')}. Where a workflow lists MCP servers, classify the tools that pstack_context returns.`,
    referenceToolNames,
    webTools,
    imageTool,
    originCli,
    dashboard,
    `Before you edit or create any .ts or .tsx file, read ${join(root, 'skills/typescript-best-practices/SKILL.md')} in full once per session. Pi has no file-path skill trigger, so this rule replaces the upstream paths glob.`,
    storeInstructions(ctx.cwd),
    `This session transcript is ${ctx.sessionManager.getSessionFile() ?? 'in memory'}. Workspace is ${ctx.cwd}.`,
  ].join('\n\n');
}
