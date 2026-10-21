import { homedir } from 'node:os';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { aliasInputResult, aliasTable, packageSkillNames } from './aliases.ts';
import { registerAskQuestion } from './ask.ts';
import { aliasAutocomplete } from './autocomplete.ts';
import { childIdentity } from './child-env.ts';
import { registerLoop } from './loop.ts';
import { registerMode } from './mode.ts';
import { isOneShot } from './modes.ts';
import { PACKAGE_ROOT, rootStoreDir, rulePath, SKILLS_DIR, storeDir, subagentDir } from './paths.ts';
import { registerReadonlyShell } from './readonly-shell.ts';
import { cursorRuleWriteReason, modelsSection, readRule } from './rule.ts';
import { hostSection, subagentsSection } from './sections.ts';
import { type AgentDefinition, loadAgentDefinitions } from './task/agents.ts';
import { availableModels, registerTask } from './task/tool.ts';
import { registerTodoWrite } from './todo.ts';

const WATCHDOG_MS = 1_000;
const ORPHAN_EXIT_MS = 5_000;

/** In a subagent, the agent definition body joins the system prompt, as Cursor uses an agent file's body as its prompt. */
function agentSection(agents: readonly AgentDefinition[]): Record<string, string> {
  const prompt = agents.find((agent) => agent.type === childIdentity.agentType)?.prompt ?? '';
  return prompt === '' ? {} : { pstack_agent: prompt };
}

function hostSections(pi: ExtensionAPI, ctx: ExtensionContext, agents: readonly AgentDefinition[]): Record<string, string> {
  return {
    pstack_host: hostSection({
      packageRoot: PACKAGE_ROOT,
      skillsDir: SKILLS_DIR,
      skillNames: packageSkillNames(pi.getCommands()),
      agentDir: getAgentDir(),
      rulePath: rulePath(),
      sessionDir: ctx.sessionManager.getSessionDir(),
      sessionFile: ctx.sessionManager.getSessionFile(),
      subagentDir: subagentDir(ctx.cwd),
      storeDir: storeDir(ctx.cwd, ctx.sessionManager.getSessionId()),
      rootStoreDir: rootStoreDir(ctx.cwd, ctx.sessionManager.getSessionId(), childIdentity.rootStore),
      loopAvailable: !isOneShot(ctx.mode),
      questionsAvailable: ctx.hasUI,
    }),
    pstack_subagents: subagentsSection(agents, availableModels(ctx)),
    pstack_models: modelsSection(readRule(rulePath()), rulePath()),
    ...agentSection(agents),
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A subagent runs in its own process group so abort and shutdown can stop everything it started, which also means
 * it outlives a parent that crashes or is killed. The subagent therefore exits once its parent is gone. Normally the
 * parent Pi is the direct parent, and a live `process.ppid` change (the OS reparents an orphan) cannot be fooled by a
 * reused pid. When a launcher that does not exec sits in between, the parent pid is checked as well.
 */
function watchParent(pi: ExtensionAPI, parentPid: number): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const initialParent = process.ppid;
  const parentGone = () => process.ppid !== initialParent || (initialParent !== parentPid && !alive(parentPid));
  pi.on('session_start', (_event, ctx) => {
    timer = setInterval(() => {
      if (!parentGone()) return;
      clearInterval(timer);
      ctx.abort();
      ctx.shutdown();
      setTimeout(() => process.exit(0), ORPHAN_EXIT_MS).unref();
    }, WATCHDOG_MS);
    timer.unref();
  });
  pi.on('session_shutdown', () => clearInterval(timer));
}

export default function piPstack(pi: ExtensionAPI): void {
  const agents = loadAgentDefinitions();

  pi.on('input', (event) => aliasInputResult(event, new Set(aliasTable(pi.getCommands()).keys())));
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode === 'tui') ctx.ui.addAutocompleteProvider((current) => aliasAutocomplete(current, aliasTable(pi.getCommands())));
  });

  const mode = registerMode(pi);
  const task = registerTask(pi, { agents, depth: childIdentity.depth });
  const loop = registerLoop(pi, { hasPendingWork: task.hasBackgroundWork });
  registerTodoWrite(pi);
  registerAskQuestion(pi);
  if (childIdentity.parentPid !== undefined) watchParent(pi, childIdentity.parentPid);
  if (childIdentity.readonly) registerReadonlyShell(pi);

  pi.on('before_agent_start', (event, ctx) => {
    const modeText = mode.section();
    const loopText = loop.section();
    Object.assign(event.systemPromptOptions.sections, hostSections(pi, ctx, agents), modeText === undefined ? {} : { pstack_mode: modeText }, loopText === undefined ? {} : { pstack_loop: loopText });
  });

  pi.on('tool_call', (event, ctx) => {
    const reason = cursorRuleWriteReason(event.toolName, event.input, { cwd: ctx.cwd, home: homedir(), piRulePath: rulePath() });
    return reason === undefined ? undefined : { block: true, reason };
  });
}
