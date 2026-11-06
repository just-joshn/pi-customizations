import { basename } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { aliasInputResult, aliasTable, commandNames, loadedSkillBlock, loadedTemplateBody, packageSkillNames } from './aliases.ts';
import { registerAskQuestion } from './ask.ts';
import { aliasAutocomplete } from './autocomplete.ts';
import { registerBackgroundShell } from './background-shell.ts';
import { childIdentity } from './child-env.ts';
import { registerInCloud } from './cloud/in-cloud.ts';
import { cloudDriverStatus, parseMachine } from './cloud/machine.ts';
import { machineJobSpawner, registerMachineTools } from './cloud/routed-tools.ts';
import { registerGenerateImage } from './generate-image.ts';
import { inboxDir, postItem, registerRootInbox } from './inbox.ts';
import { registerLoop } from './loop.ts';
import { registerMode } from './mode.ts';
import { canAsk, isOneShot } from './modes.ts';
import { artifactsDir, PACKAGE_ROOT, projectsDir, rootStoreDir, rulePath, SKILLS_DIR, storeDir, subagentDir, terminalsDir, workspaceStateDir } from './paths.ts';
import { registerPlanMode } from './plan.ts';
import { projectSection, registerProjects } from './project.ts';
import { registerReadonlyShell } from './readonly-shell.ts';
import { migrateLegacyRule, modelsSection, readRule } from './rule.ts';
import { registerSecretRequest } from './secrets.ts';
import { alwaysAppliedRules, hostSection, subagentsSection, todayText } from './sections.ts';
import { activateSlackTools, registerSlackTools } from './slack/tools.ts';
import { registerSubscriptions } from './subscriptions/index.ts';
import { memoryDir } from './subscriptions/memories.ts';
import { type AgentDefinition, loadAgentDefinitions } from './task/agents.ts';
import { registerAgentStatus } from './task/status.ts';
import { availableModels, parentModel, registerTask } from './task/tool.ts';
import { registerTodoWrite } from './todo.ts';
import { registerVisualize } from './visualize.ts';

const WATCHDOG_MS = 1_000;
const ORPHAN_EXIT_MS = 5_000;

// What Cursor tells every subagent in a system reminder, minus its sentence about Cursor Canvas files.
const SUBAGENT_REMINDER = 'You are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions.';

/** In a subagent, Cursor's system reminder: the shared subagent reminder, then the agent type's own reminder. */
function agentSection(agents: readonly AgentDefinition[]): Record<string, string> {
  if (childIdentity.depth === 0) return {};
  const reminder = agents.find((agent) => agent.type === childIdentity.agentType)?.reminder ?? '';
  return { pstack_subagent: reminder === '' ? SUBAGENT_REMINDER : `${SUBAGENT_REMINDER}\n\n${reminder}` };
}

async function hostSections(pi: ExtensionAPI, ctx: ExtensionContext, agents: readonly AgentDefinition[]): Promise<Record<string, string>> {
  const activeTools = pi.getActiveTools();
  const cloud = activeTools.includes('Task') ? await cloudDriverStatus() : { driver: 'worktree' as const, reason: 'no Task tool' };
  return {
    pstack_host: hostSection({
      today: todayText(new Date()),
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
      projectsDir: projectsDir(ctx.cwd),
      artifactsDir: artifactsDir(ctx.cwd, ctx.sessionManager.getSessionId()),
      terminalsDir: terminalsDir(ctx.cwd),
      loopAvailable: !isOneShot(ctx.mode),
      questionsAvailable: canAsk(ctx),
      activeTools,
      rules: alwaysAppliedRules(SKILLS_DIR),
      cloud,
    }),
    ...(activeTools.includes('Task') ? { pstack_subagents: subagentsSection(agents, availableModels(ctx), parentModel(ctx)) } : {}),
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
  // A cloud agent on a container machine runs every tool there; its own Pi process stays on the host.
  const machine = childIdentity.machine === undefined ? undefined : parseMachine(childIdentity.machine);
  if (machine !== undefined) registerMachineTools(pi, machine);

  // Before the alias handler, so a task sent with /in-cloud reaches the cloud agent as the user typed it.
  if (childIdentity.depth === 0) registerInCloud(pi, (description, prompt) => task.startBackground(description, prompt, { environment: 'cloud' }));
  pi.on('input', (event) => {
    const commands = pi.getCommands();
    return aliasInputResult(event, new Set(aliasTable(commands).keys()), loadedSkillBlock(commands), commandNames(commands), loadedTemplateBody(commands));
  });
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode === 'tui') ctx.ui.addAutocompleteProvider((current) => aliasAutocomplete(current, aliasTable(pi.getCommands())));
  });

  const mode = registerMode(pi);
  const plan = registerPlanMode(pi, {
    ...(childIdentity.buildPlan === undefined ? {} : { buildPlan: childIdentity.buildPlan }),
    setTodos: (items, ctx) => todos.replace(items, ctx),
    buildInWorker: (planFile, request) => task.startBackground(`Build ${basename(planFile)}`, request, { environment: 'cloud', buildPlan: planFile }),
  });
  registerVisualize(pi, { artifactsDir: (ctx) => artifactsDir(ctx.cwd, ctx.sessionManager.getSessionId()) });
  registerGenerateImage(pi, { artifactsDir: (ctx) => artifactsDir(ctx.cwd, ctx.sessionManager.getSessionId()), mayOffer: () => !childIdentity.readonly && !plan.enabled() });
  const ownType = agents.find((agent) => agent.type === childIdentity.agentType);
  const projects = registerProjects(pi);
  // The top of a tree owns its background work: the main chat, or a cloud agent, which gets no root identity. Registered
  // before the Task and shell settle handlers, so a one-shot run drains its inbox before deciding to exit.
  const { root } = childIdentity;
  if (root === undefined)
    registerRootInbox(pi, {
      shell: (notice) => shells?.announce(notice),
      adopt: (agentId) => task.adopt(agentId),
      settledOf: (agentId) => task.settledOf(agentId),
    });
  const task = registerTask(pi, { agents, depth: childIdentity.depth, canSpawn: childIdentity.depth < 2 && ownType?.spawns !== false, planMode: plan.enabled, project: projects.slug });
  registerAgentStatus(pi);
  registerSubscriptions(pi, {
    runFresh: async (prompt, name, meta) => {
      await task.startBackground(`timer ${name}`, prompt, {
        automation: true,
        ...(meta.model === undefined ? {} : { model: `${meta.model.provider}/${meta.model.id}${meta.model.thinking === undefined ? '' : `:${meta.model.thinking}`}` }),
        ...(meta.trusted === undefined ? {} : { trusted: meta.trusted }),
        ...(meta.environment === undefined ? {} : { environment: meta.environment, shared: [memoryDir(name)] }),
      });
      return undefined;
    },
  });
  // A subagent's background jobs belong to the top of its tree, so their notices go to that inbox, tagged with this agent's ID.
  let forwardFrom: { dir: string; agentId: string } | undefined;
  if (root !== undefined)
    pi.on('session_start', (_event, ctx) => {
      forwardFrom = { dir: inboxDir(workspaceStateDir(ctx.cwd), root.sessionId), agentId: ctx.sessionManager.getSessionId() };
    });
  // A readonly agent's shell is the sandboxed one, and a background job would run outside that sandbox. On a container
  // machine the readonly boundary is the machine's read-only clone, so jobs run there.
  const shells =
    childIdentity.readonly && machine === undefined
      ? undefined
      : registerBackgroundShell(pi, {
          terminalsDir: (ctx) => terminalsDir(ctx.cwd),
          waitsForJobs: (ctx) => childIdentity.depth === 0 && (ctx.mode === 'print' || ctx.mode === 'json'),
          forward:
            root !== undefined
              ? (notice) => {
                  if (forwardFrom !== undefined) postItem(forwardFrom.dir, { type: 'shell', from: forwardFrom.agentId, notice });
                }
              : undefined,
          spawner: machine === undefined ? undefined : machineJobSpawner(machine),
        });
  const loop = registerLoop(pi, { hasPendingWork: () => task.hasBackgroundWork() || shells?.hasRunningJobs() === true });
  const todos = registerTodoWrite(pi, childIdentity.readonly ? {} : { onWrite: plan.syncTodos });
  registerAskQuestion(pi);
  if (childIdentity.depth === 0) registerSecretRequest(pi, () => activateSlackTools(pi));
  if (childIdentity.depth === 0 || childIdentity.automation) registerSlackTools(pi);
  if (childIdentity.parentPid !== undefined) watchParent(pi, childIdentity.parentPid);
  if (childIdentity.readonly && machine === undefined) registerReadonlyShell(pi);

  pi.on('before_agent_start', async (event, ctx) => {
    const onlyTools = ownType?.onlyTools;
    if (onlyTools !== undefined) pi.setActiveTools(pi.getActiveTools().filter((name) => onlyTools.includes(name)));
    const loopText = loop.section();
    const planText = plan.section();
    const todoText = todos.section();
    const projectText = projectSection(ctx.cwd, projects.slug());
    Object.assign(
      event.systemPromptOptions.sections,
      await hostSections(pi, ctx, agents),
      mode.sections(),
      loopText === undefined ? {} : { pstack_loop: loopText },
      planText === undefined ? {} : { pstack_plan: planText },
      todoText === undefined ? {} : { pstack_todos: todoText },
      projectText === undefined ? {} : { pstack_project: projectText },
    );
  });

  pi.on('session_start', () => migrateLegacyRule(rulePath()));
}
