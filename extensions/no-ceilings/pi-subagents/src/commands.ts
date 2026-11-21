import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { resolveSubagentDefinition } from './discovery.ts';
import { formatSessionTitle } from './formatters.ts';
import type { SubagentStore } from './store.ts';
import { openTasksOverlay } from './tasks-overlay.ts';
import { CommandArgsSchema, ONE, type SubagentDefinition, TWO, ZERO } from './types.ts';

export interface CommandCallbacks {
  readonly store: SubagentStore;
  readonly getDefinitions: (cwd: string) => readonly SubagentDefinition[];
  readonly reloadDefinitions: (cwd: string) => readonly SubagentDefinition[];
}

function formatAgentsList(definitions: readonly SubagentDefinition[]): string {
  return definitions
    .map((def) => {
      const tags = [def.source, def.permissionMode === 'readonly' ? 'readonly' : undefined, def.isBackground ? 'background' : undefined, def.model !== 'inherit' ? `model:${def.model}` : undefined]
        .filter((item): item is string => item !== undefined)
        .join(', ');
      return `${def.name} (${tags})${def.description ? ` — ${def.description}` : ''}`;
    })
    .join('\n');
}

function formatTasksList(store: SubagentStore): string {
  const sessions = store.listSessions();
  if (sessions.length === ZERO) {
    return 'No active tasks';
  }
  return sessions
    .map((s) => {
      const mode = s.isBackground ? 'bg' : 'fg';
      return `${s.agentId} [${s.status}/${mode}] ${formatSessionTitle(s.description, s.prompt, s.agentId)}`;
    })
    .join('\n');
}

function registerTasksCommand(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  pi.registerCommand('tasks', {
    description: 'View active and recent subagent tasks (or: /tasks list | /tasks abort <id> | /tasks bg <id>)',
    handler: async (rawArgs, ctx) => {
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
      if (!ctx.hasUI) {
        ctx.ui.notify(formatTasksList(callbacks.store), 'info');
        return;
      }
      await openTasksOverlay(ctx, callbacks.store);
    },
  });
}

function registerAgentsCommand(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  pi.registerCommand('agents', {
    description: 'List discovered built-in and custom subagents (or: /agents reload)',
    handler: async (rawArgs, ctx) => {
      const args = CommandArgsSchema.parse(rawArgs).trim().toLowerCase();
      if (args === 'reload') {
        const reloaded = callbacks.reloadDefinitions(ctx.cwd);
        ctx.ui.notify(`Reloaded ${reloaded.length} subagents`, 'info');
        return;
      }
      ctx.ui.notify(formatAgentsList(callbacks.getDefinitions(ctx.cwd)), 'info');
    },
  });
}

function registerSubagentCommand(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  pi.registerCommand('subagent', {
    description: 'Invoke a specific subagent by name: /subagent <name> <prompt>',
    handler: async (rawArgs, ctx) => {
      const args = CommandArgsSchema.parse(rawArgs).trim();
      const parts = args.split(/\s+/);
      const rawName = parts[ZERO] ?? '';
      const restPrompt = parts.slice(ONE).join(' ').trim();
      if (rawName.length === ZERO || parts.length < TWO || restPrompt.length === ZERO) {
        ctx.ui.notify('Usage: /subagent <name> <prompt>', 'warning');
        return;
      }
      const defs = callbacks.getDefinitions(ctx.cwd);
      const def = resolveSubagentDefinition(defs, rawName);
      if (!def) {
        const available = defs.map((d) => d.name).join(', ');
        ctx.ui.notify(`Unknown subagent "${rawName}". Available: ${available}`, 'warning');
        return;
      }
      pi.sendUserMessage(`Use the task tool with subagent_type="${def.name}" to: ${restPrompt}`, { deliverAs: 'followUp' });
    },
  });
}

export function registerSubagentCommands(pi: ExtensionAPI, callbacks: CommandCallbacks): void {
  registerTasksCommand(pi, callbacks);
  registerAgentsCommand(pi, callbacks);
  registerSubagentCommand(pi, callbacks);
}
