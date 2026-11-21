import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ExtensionAPI, ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { Key } from '@earendil-works/pi-tui';
import { registerSubagentCommands } from './commands.ts';
import { discoverSubagents } from './discovery.ts';
import { buildSubagentsContextPrompt } from './formatters.ts';
import { createSubagentStore, type SubagentStore } from './store.ts';
import { openTasksOverlay } from './tasks-overlay.ts';
import { registerSubagentTools } from './tools.ts';
import {
  BACKGROUND_COMPLETION_CUSTOM_TYPE,
  type BackgroundCompletionMessageDetails,
  type BackgroundCompletionPayload,
  ONE,
  PersistedSubagentsStateSchema,
  SUBAGENTS_CONTEXT_CUSTOM_TYPE,
  SUBAGENTS_ENTRY_CUSTOM_TYPE,
  type SubagentDefinition,
  ZERO,
} from './types.ts';
import { renderBackgroundCompletionMessage, syncSubagentsUi } from './ui-renderers.ts';

function isStaleSubagentsContextMessage(message: AgentMessage): boolean {
  return 'customType' in message && message.customType === SUBAGENTS_CONTEXT_CUSTOM_TYPE;
}

function restorePersistedSessions(ctx: ExtensionContext, store: SubagentStore): void {
  const entries: readonly SessionEntry[] = ctx.sessionManager.getEntries();
  const lastEntry = entries.filter((entry) => entry.type === 'custom' && 'customType' in entry && entry.customType === SUBAGENTS_ENTRY_CUSTOM_TYPE).at(-ONE);
  if (!lastEntry || !('data' in lastEntry)) {
    return;
  }
  const parsed = PersistedSubagentsStateSchema.safeParse(lastEntry.data);
  if (parsed.success) {
    store.restoreFromPersisted(parsed.data);
  }
}

function buildBackgroundCompletionText(completions: readonly BackgroundCompletionPayload[]): string {
  return completions
    .map((item) => {
      const header = `## Background Subagent ${item.taskId} — ${item.status.toUpperCase()} (${item.title})`;
      const detail = item.detail ? `\n\n${item.detail}` : '';
      const pathLine = item.outputPath ? `\n\ntranscript_path: ${item.outputPath}` : '';
      return `${header}${detail}${pathLine}`;
    })
    .join('\n\n---\n\n');
}

function flushBackgroundWakeups(pi: ExtensionAPI, store: SubagentStore): void {
  const completions = store.drainWakeups();
  if (completions.length === ZERO) {
    return;
  }
  const details: BackgroundCompletionMessageDetails = { completions: [...completions] };
  pi.sendMessage(
    {
      customType: BACKGROUND_COMPLETION_CUSTOM_TYPE,
      content: buildBackgroundCompletionText(completions),
      display: true,
      details,
    },
    { triggerTurn: true, deliverAs: 'followUp' },
  );
}

function registerSubagentShortcuts(pi: ExtensionAPI, store: SubagentStore): void {
  const onOpenTasks = async (ctx: ExtensionContext): Promise<void> => {
    await openTasksOverlay(ctx, store);
  };

  const onBackgroundForeground = async (ctx: ExtensionContext): Promise<void> => {
    const fgRuns = store.listForegroundRuns();
    const movedCount = fgRuns.filter((run) => run.requestBackground?.() === true).length;
    syncSubagentsUi(ctx, store);
    if (movedCount > ZERO) {
      ctx.ui.notify(movedCount === ONE ? 'Moved 1 subagent to background' : `Moved ${movedCount} subagents to background`, 'info');
    } else {
      ctx.ui.notify('No foreground subagents running', 'info');
    }
  };

  pi.registerShortcut(Key.ctrlAlt('t'), {
    description: 'Open subagent tasks pager and live transcript viewer',
    handler: onOpenTasks,
  });

  pi.registerShortcut(Key.ctrlAlt('b'), {
    description: 'Send currently running foreground subagent(s) to background',
    handler: onBackgroundForeground,
  });
}

interface LifecycleHandlers {
  readonly store: SubagentStore;
  readonly getDefinitions: (cwd: string) => readonly SubagentDefinition[];
  readonly reloadDefinitions: (cwd: string) => readonly SubagentDefinition[];
  readonly setLatestCtx: (ctx: ExtensionContext) => void;
}

function registerLifecycleEvents(pi: ExtensionAPI, handlers: LifecycleHandlers): void {
  pi.on('context', async (event) => ({
    messages: event.messages.filter((msg) => !isStaleSubagentsContextMessage(msg)),
  }));

  pi.on('before_agent_start', async (event, ctx) => {
    handlers.setLatestCtx(ctx);
    const defs = handlers.getDefinitions(ctx.cwd);
    if (event.messageType !== 'user') {
      return undefined;
    }
    return { message: { customType: SUBAGENTS_CONTEXT_CUSTOM_TYPE, content: buildSubagentsContextPrompt(defs), display: false } };
  });

  pi.on('agent_end', async (_event, ctx) => {
    handlers.setLatestCtx(ctx);
    if (handlers.store.hasPendingWakeups()) {
      flushBackgroundWakeups(pi, handlers.store);
    }
    syncSubagentsUi(ctx, handlers.store);
  });

  pi.on('session_start', async (_event, ctx) => {
    handlers.setLatestCtx(ctx);
    handlers.store.reset();
    handlers.reloadDefinitions(ctx.cwd);
    restorePersistedSessions(ctx, handlers.store);
    syncSubagentsUi(ctx, handlers.store);
  });

  pi.on('session_shutdown', async () => {
    handlers.store.abortAllRuns();
  });
}

export default function piSubagentsExtension(pi: ExtensionAPI): void {
  const store = createSubagentStore();
  let definitions: readonly SubagentDefinition[] = [];
  let latestCtx: ExtensionContext | undefined;

  const reloadDefinitions = (cwd: string): readonly SubagentDefinition[] => {
    definitions = discoverSubagents(cwd);
    return definitions;
  };

  const getDefinitions = (cwd: string): readonly SubagentDefinition[] => (definitions.length === ZERO ? reloadDefinitions(cwd) : definitions);

  const onStateChanged = (): void => {
    pi.appendEntry(SUBAGENTS_ENTRY_CUSTOM_TYPE, store.toPersistedState());
  };

  store.subscribe(() => {
    if (latestCtx) {
      syncSubagentsUi(latestCtx, store);
    }
  });

  registerSubagentTools(pi, {
    store,
    getDefinitions,
    onBackgroundCompleted: () => flushBackgroundWakeups(pi, store),
    onStateChanged,
  });

  registerSubagentCommands(pi, {
    store,
    getDefinitions,
    reloadDefinitions,
  });

  pi.registerMessageRenderer(BACKGROUND_COMPLETION_CUSTOM_TYPE, (message, _options, theme) => renderBackgroundCompletionMessage(message, theme));
  registerSubagentShortcuts(pi, store);
  registerLifecycleEvents(pi, {
    store,
    getDefinitions,
    reloadDefinitions,
    setLatestCtx: (ctx) => {
      latestCtx = ctx;
    },
  });
}
