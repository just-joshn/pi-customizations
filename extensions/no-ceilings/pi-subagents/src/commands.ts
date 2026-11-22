import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SubagentsConfig } from './config.ts';
import { resolveSubagentDefinition } from './discovery.ts';
import { formatSessionTitle } from './formatters.ts';
import type { SubagentStore } from './store.ts';
import { openTasksOverlay } from './tasks-overlay.ts';
import { CommandArgsSchema, ONE, type SubagentDefinition, TWO, ZERO } from './types.ts';

export interface CommandCallbacks {
  readonly store: SubagentStore;
  readonly getDefinitions: (cwd: string) => readonly SubagentDefinition[];
  readonly reloadDefinitions: (cwd: string) => readonly SubagentDefinition[];
  readonly getConfig: (cwd: string) => SubagentsConfig;
  readonly retryRun: (agentId: string, ctx: ExtensionContext) => Promise<void>;
  readonly pruneWorktrees: (agentId: string) => Promise<boolean>;
  readonly registerAgentCommands: (definitions: readonly SubagentDefinition[]) => void;
}

const BACKGROUND_FLAG = '--bg';

function formatAgentsList(definitions: readonly SubagentDefinition[]): string {
  return definitions
    .map((definition) => {
      const tags = [
        definition.source,
        definition.permissionMode === 'readonly' ? 'readonly' : undefined,
        definition.isBackground ? 'background' : undefined,
        definition.worktree ? 'worktree' : undefined,
        definition.mcp ? 'mcp' : undefined,
        definition.thinking !== undefined ? `thinking:${definition.thinking}` : undefined,
        definition.contextWindow !== undefined ? `context:${definition.contextWindow}` : undefined,
        definition.model !== 'inherit' ? `model:${definition.model}` : undefined,
      ]
        .filter((item): item is string => item !== undefined)
        .join(', ');
      return `${definition.name} (${tags})${definition.description ? ` — ${definition.description}` : ''}`;
    })
    .join('\n');
}

function formatTasksList(store: SubagentStore): string {
  const sessions = store.listSessions();
  if (sessions.length === ZERO) {
    return 'No active tasks';
  }
  return sessions
    .map((session) => {
      const mode = session.isBackground ? 'bg' : 'fg';
      const failure = session.failureId ? ` failure:${session.failureId}` : '';
      const attempts = session.attempts > ONE ? ` attempt:${session.attempts}/${session.maxAttempts}` : '';
      const worktree = session.worktree ? ` worktree:${session.worktree.branch}` : '';
      return `${session.agentId} [${session.status}/${mode}]${attempts}${failure}${worktree} ${formatSessionTitle(session.description, session.prompt, session.agentId)}`;
    })
    .join('\n');
}

function formatConfigSummary(config: SubagentsConfig): string {
  const files = config.configFiles.length > ZERO ? config.configFiles.join(', ') : 'none (built-in defaults)';
  const errors = config.errors.length > ZERO ? `\nerrors: ${config.errors.join('; ')}` : '';
  return `config: ${files}\nexplore model: ${config.explore.model}${config.explore.enabled ? '' : ' (disabled)'}\nnesting depth: ${config.maxNestingDepth}\nretry attempts: ${config.retry.maxAttempts}${errors}`;
}

async function handleTasksCommand(rawArgs: string, ctx: ExtensionContext, callbacks: CommandCallbacks): Promise<void> {
  const args = CommandArgsSchema.parse(rawArgs).trim();
  const parts = args.length > ZERO ? args.split(/\s+/) : [];
  const subcommand = parts[ZERO]?.toLowerCase();
  const targetId = parts[ONE];

  if (subcommand === 'list') {
    ctx.ui.notify(formatTasksList(callbacks.store), 'info');
    return;
  }
  if (subcommand === 'abort' && targetId) {
    const aborted = callbacks.store.abortRun(targetId);
    ctx.ui.notify(aborted ? `Aborted subagent ${targetId}` : `No running subagent found for ${targetId}`, aborted ? 'info' : 'warning');
    return;
  }
  if (subcommand === 'bg' && targetId) {
    const moved = callbacks.store.getActiveRun(targetId)?.requestBackground?.() ?? false;
    ctx.ui.notify(moved ? `Moved subagent ${targetId} to background` : `No foreground subagent found for ${targetId}`, moved ? 'info' : 'warning');
    return;
  }
  if (subcommand === 'retry' && targetId) {
    await callbacks.retryRun(targetId, ctx);
    return;
  }
  if (subcommand === 'prune' && targetId) {
    const removed = await callbacks.pruneWorktrees(targetId);
    ctx.ui.notify(removed ? `Removed worktree for ${targetId}` : `No worktree found for ${targetId}`, removed ? 'info' : 'warning');
    return;
  }
  if (!ctx.hasUI) {
    ctx.ui.notify(formatTasksList(callbacks.store), 'info');
    return;
  }
  await openTasksOverlay(ctx, callbacks.store);
}

function registerTasksCommand(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  pi.registerCommand('tasks', {
    description: 'View subagent tasks, or run: list | abort <id> | bg <id> | retry <id> | prune <id>',
    handler: async (rawArgs, ctx) => {
      await handleTasksCommand(rawArgs, ctx, callbacks);
    },
  });
}

function registerAgentsCommand(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  pi.registerCommand('agents', {
    description: 'List discovered subagents and the effective config, or run /agents reload',
    handler: async (rawArgs, ctx) => {
      const args = CommandArgsSchema.parse(rawArgs).trim().toLowerCase();
      if (args === 'reload') {
        const reloaded = callbacks.reloadDefinitions(ctx.cwd);
        callbacks.registerAgentCommands(reloaded);
        ctx.ui.notify(`Reloaded ${reloaded.length} subagents`, 'info');
        return;
      }
      ctx.ui.notify(`${formatAgentsList(callbacks.getDefinitions(ctx.cwd))}\n\n${formatConfigSummary(callbacks.getConfig(ctx.cwd))}`, 'info');
    },
  });
}

function buildInvocationMessage(definition: SubagentDefinition, prompt: string, background: boolean): string {
  const backgroundArg = background ? ', run_in_background: true' : '';
  return `Use the task tool with subagent_type="${definition.name}"${backgroundArg} to: ${prompt}`;
}

function registerSubagentCommand(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  pi.registerCommand('subagent', {
    description: 'Invoke a specific subagent: /subagent <name> [--bg] <prompt>',
    handler: async (rawArgs, ctx) => {
      const args = CommandArgsSchema.parse(rawArgs).trim();
      const parts = args.split(/\s+/);
      const rawName = parts[ZERO] ?? '';
      const restPrompt = parts.slice(ONE).join(' ').trim();
      if (rawName.length === ZERO || parts.length < TWO || restPrompt.length === ZERO) {
        ctx.ui.notify('Usage: /subagent <name> [--bg] <prompt>', 'warning');
        return;
      }
      const definition = resolveSubagentDefinition(callbacks.getDefinitions(ctx.cwd), rawName);
      if (!definition) {
        const available = callbacks
          .getDefinitions(ctx.cwd)
          .map((candidate) => candidate.name)
          .join(', ');
        ctx.ui.notify(`Unknown subagent "${rawName}". Available: ${available}`, 'warning');
        return;
      }
      const background = restPrompt.startsWith(BACKGROUND_FLAG);
      const prompt = background ? restPrompt.slice(BACKGROUND_FLAG.length).trim() : restPrompt;
      pi.sendUserMessage(buildInvocationMessage(definition, prompt, background), { deliverAs: 'followUp' });
    },
  });
}

function splitAgentArgs(rawArgs: string): { readonly prompt: string; readonly background: boolean } {
  const args = CommandArgsSchema.parse(rawArgs).trim();
  return args.startsWith(BACKGROUND_FLAG) ? { prompt: args.slice(BACKGROUND_FLAG.length).trim(), background: true } : { prompt: args, background: false };
}

/** One command per discovered agent, named like Pi's own `skill:` commands. */
export function registerAgentCommands(pi: ExtensionAPI, definitions: readonly SubagentDefinition[]): void {
  for (const definition of definitions) {
    pi.registerCommand(`subagent:${definition.name}`, {
      description: definition.description || `Run the ${definition.name} subagent`,
      handler: async (rawArgs, ctx) => {
        const { prompt, background } = splitAgentArgs(rawArgs);
        if (prompt.length === ZERO) {
          ctx.ui.notify(`Usage: /subagent:${definition.name} [--bg] <prompt>`, 'warning');
          return;
        }
        pi.sendUserMessage(buildInvocationMessage(definition, prompt, background), { deliverAs: 'followUp' });
      },
    });
  }
}

export function registerSubagentCommands(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  registerTasksCommand(pi, callbacks);
  registerAgentsCommand(pi, callbacks);
  registerSubagentCommand(pi, callbacks);
}
