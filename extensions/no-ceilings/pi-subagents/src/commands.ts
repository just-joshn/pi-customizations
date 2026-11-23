import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SubagentsConfig } from './config.ts';
import { resolveSubagentDefinition } from './discovery.ts';
import { formatSessionTitle } from './formatters.ts';
import type { SubagentStore } from './store.ts';
import { openTasksOverlay } from './tasks-overlay.ts';
import { CommandArgsSchema, ONE, type SubagentDefinition, TWO, ZERO } from './types.ts';

export interface CommandCallbacks {
  readonly store: SubagentStore;
  readonly getDefinitions: (ctx: ExtensionContext) => readonly SubagentDefinition[];
  readonly reloadDefinitions: (ctx: ExtensionContext) => readonly SubagentDefinition[];
  readonly getConfig: (ctx: ExtensionContext) => SubagentsConfig;
  readonly retryRun: (agentId: string, ctx: ExtensionContext) => Promise<void>;
  readonly pruneWorktrees: (agentId: string) => Promise<PruneResult>;
  readonly registerAgentCommands: (definitions: readonly SubagentDefinition[]) => void;
}

const BACKGROUND_FLAG = '--bg';

export type PruneResult = 'removed' | 'missing' | 'busy' | 'failed';

const PRUNE_MESSAGES: Readonly<Record<PruneResult, { readonly text: string; readonly level: 'info' | 'warning' }>> = {
  removed: { text: 'Removed worktree for', level: 'info' },
  missing: { text: 'No worktree found for', level: 'warning' },
  busy: { text: 'Subagent is still running, so its worktree was kept for', level: 'warning' },
  failed: { text: 'Could not remove the worktree for', level: 'warning' },
};

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
    const result = await callbacks.pruneWorktrees(targetId);
    const message = PRUNE_MESSAGES[result];
    ctx.ui.notify(`${message.text} ${targetId}`, message.level);
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
        const reloaded = callbacks.reloadDefinitions(ctx);
        callbacks.registerAgentCommands(reloaded);
        ctx.ui.notify(`Reloaded ${reloaded.length} subagents`, 'info');
        return;
      }
      ctx.ui.notify(`${formatAgentsList(callbacks.getDefinitions(ctx))}\n\n${formatConfigSummary(callbacks.getConfig(ctx))}`, 'info');
    },
  });
}

function buildInvocationMessage(definition: SubagentDefinition, prompt: string, background: boolean): string {
  const backgroundArg = background ? ', run_in_background: true' : '';
  return `Use the task tool with subagent_type="${definition.name}"${backgroundArg} to: ${prompt}`;
}

function findLongestAgentPrefix(parts: readonly string[], definitions: readonly SubagentDefinition[]): { readonly definition: SubagentDefinition; readonly consumed: number } | undefined {
  for (let count = parts.length; count >= ONE; count -= ONE) {
    const name = parts.slice(ZERO, count).join(' ');
    const definition = resolveSubagentDefinition(definitions, name);
    if (definition && definition.name.toLowerCase() === name.toLowerCase()) {
      return { definition, consumed: count };
    }
  }
  return undefined;
}

function promptAfterBackgroundFlag(parts: readonly string[]): { readonly prompt: string; readonly background: boolean } {
  if (parts[ZERO] === BACKGROUND_FLAG) {
    return { prompt: parts.slice(ONE).join(' ').trim(), background: true };
  }
  return { prompt: parts.join(' ').trim(), background: false };
}

function registerSubagentCommand(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  pi.registerCommand('subagent', {
    description: 'Invoke a specific subagent: /subagent <name> [--bg] <prompt>',
    handler: async (rawArgs, ctx) => {
      const args = CommandArgsSchema.parse(rawArgs).trim();
      const parts = args.length > ZERO ? args.split(/\s+/) : [];
      const definitions = callbacks.getDefinitions(ctx);
      const matched = findLongestAgentPrefix(parts, definitions);
      if (!matched) {
        const rawName = parts[ZERO] ?? '';
        if (rawName.length === ZERO) {
          ctx.ui.notify('Usage: /subagent <name> [--bg] <prompt>', 'warning');
          return;
        }
        const available = definitions.map((candidate) => candidate.name).join(', ');
        ctx.ui.notify(`Unknown subagent "${rawName}". Available: ${available}`, 'warning');
        return;
      }
      const { prompt, background } = promptAfterBackgroundFlag(parts.slice(matched.consumed));
      if (prompt.length === ZERO) {
        ctx.ui.notify('Usage: /subagent <name> [--bg] <prompt>', 'warning');
        return;
      }
      pi.sendUserMessage(buildInvocationMessage(matched.definition, prompt, background), { deliverAs: 'followUp' });
    },
  });
}

function slugifyCommandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nextCommandSlug(base: string, registered: ReadonlySet<string>): string | undefined {
  if (base.length === ZERO) {
    return undefined;
  }
  if (!registered.has(base)) {
    return base;
  }
  for (let suffix = TWO; ; suffix += ONE) {
    const candidate = `${base}-${suffix}`;
    if (!registered.has(candidate)) {
      return candidate;
    }
  }
}

function splitAgentArgs(rawArgs: string): { readonly prompt: string; readonly background: boolean } {
  const args = CommandArgsSchema.parse(rawArgs).trim();
  const parts = args.length > ZERO ? args.split(/\s+/) : [];
  return promptAfterBackgroundFlag(parts);
}

/** One command per discovered agent, named like Pi's own `skill:` commands. */
export function registerAgentCommands(pi: ExtensionAPI, definitions: readonly SubagentDefinition[], getDefinitions: (ctx: ExtensionContext) => readonly SubagentDefinition[]): void {
  const registered = new Set<string>();
  for (const definition of definitions) {
    const commandName = nextCommandSlug(slugifyCommandName(definition.name), registered);
    if (commandName === undefined) {
      continue;
    }
    registered.add(commandName);
    pi.registerCommand(`subagent:${commandName}`, {
      description: definition.description || `Run the ${definition.name} subagent`,
      handler: async (rawArgs, ctx) => {
        const current = resolveSubagentDefinition(getDefinitions(ctx), definition.name);
        if (!current) {
          ctx.ui.notify(`Unknown subagent "${definition.name}"`, 'warning');
          return;
        }
        const { prompt, background } = splitAgentArgs(rawArgs);
        if (prompt.length === ZERO) {
          ctx.ui.notify(`Usage: /subagent:${current.name} [--bg] <prompt>`, 'warning');
          return;
        }
        pi.sendUserMessage(buildInvocationMessage(current, prompt, background), { deliverAs: 'followUp' });
      },
    });
  }
}

export function registerSubagentCommands(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  registerTasksCommand(pi, callbacks);
  registerAgentsCommand(pi, callbacks);
  registerSubagentCommand(pi, callbacks);
}
