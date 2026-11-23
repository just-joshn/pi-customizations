import { type ExtensionAPI, type ExtensionContext, getAgentDir, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { Key } from '@earendil-works/pi-tui';
import { type PruneResult, registerAgentCommands, registerSubagentCommands } from './commands.ts';
import { DEFAULT_BROWSER_SERVER_HINTS, loadSubagentsConfig, type SubagentsConfig } from './config.ts';
import { discoverSubagents, resolveSubagentDefinition } from './discovery.ts';
import { emitSubagentEvent } from './events.ts';
import { buildSubagentsContextPrompt } from './formatters.ts';
import { runSubagentTask } from './runner.ts';
import { createSubagentStore, type SubagentStore } from './store.ts';
import { openTasksOverlay } from './tasks-overlay.ts';
import { registerSubagentTools, type SubagentToolCallbacks } from './tools.ts';
import {
  BACKGROUND_COMPLETION_CUSTOM_TYPE,
  type BackgroundCompletionMessageDetails,
  type BackgroundCompletionPayload,
  type NestedScope,
  ONE,
  PersistedSubagentRecordSchema,
  type PersistedSubagentsState,
  SUBAGENTS_CONFIG_FILE_NAME,
  SUBAGENTS_ENTRY_CUSTOM_TYPE,
  type SubagentDefinition,
  ZERO,
} from './types.ts';
import { renderBackgroundCompletionMessage, syncSubagentsUi } from './ui-renderers.ts';
import { removeSubagentWorktree } from './worktree.ts';

const EXPLORE_MODEL_FLAG = 'subagent-explore-model';
const MAX_DEPTH_FLAG = 'subagent-max-depth';
const MCP_TOOL_PREFIX = 'mcp__';

function parsePersistedSessions(data: unknown): PersistedSubagentsState | undefined {
  if (typeof data !== 'object' || data === null || !('sessions' in data) || !Array.isArray(data.sessions)) {
    return undefined;
  }
  const sessions = data.sessions.flatMap((entry) => {
    const parsed = PersistedSubagentRecordSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return { sessions };
}

function restorePersistedSessions(ctx: ExtensionContext, store: SubagentStore): void {
  const entries: readonly SessionEntry[] = ctx.sessionManager.getEntries();
  const lastEntry = entries.filter((entry) => entry.type === 'custom' && 'customType' in entry && entry.customType === SUBAGENTS_ENTRY_CUSTOM_TYPE).at(-ONE);
  if (!lastEntry || !('data' in lastEntry)) {
    return;
  }
  const parsed = parsePersistedSessions(lastEntry.data);
  if (parsed !== undefined) {
    store.restoreFromPersisted(parsed, ctx.sessionManager.getSessionId());
  }
}

export function buildBackgroundCompletionText(completions: readonly BackgroundCompletionPayload[]): string {
  return completions
    .map((item) => {
      const header = `## Background Subagent ${item.taskId} — ${item.status.toUpperCase()} (${item.title})`;
      const detail = item.detail ? `\n\n${item.detail}` : '';
      const pathLine = item.outputPath ? `\n\ntranscript_path: ${item.outputPath}` : '';
      const failureLine = item.failureId ? `\n\nfailure_id: ${item.failureId}` : '';
      const summary = item.worktreeSummary && item.worktreeSummary.trim().length > ZERO ? `\n\n${item.worktreeSummary}` : '';
      const worktreeLine = item.worktreePath ? `\nworktree_path: ${item.worktreePath}\nbranch: ${item.branch ?? '(unknown)'}${summary}` : '';
      return `${header}${detail}${pathLine}${failureLine}${worktreeLine}`;
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
  pi.registerShortcut(Key.ctrlAlt('t'), {
    description: 'Open subagent tasks pager and live transcript viewer',
    handler: async (ctx: ExtensionContext): Promise<void> => {
      await openTasksOverlay(ctx, store);
    },
  });

  pi.registerShortcut(Key.ctrlAlt('b'), {
    description: 'Send currently running foreground subagent(s) to background',
    handler: async (ctx: ExtensionContext): Promise<void> => {
      const foregroundRuns = store.listForegroundRuns();
      const movedCount = foregroundRuns.filter((run) => run.requestBackground?.() === true).length;
      syncSubagentsUi(ctx, store);
      if (movedCount > ZERO) {
        ctx.ui.notify(movedCount === ONE ? 'Moved 1 subagent to background' : `Moved ${movedCount} subagents to background`, 'info');
      } else {
        ctx.ui.notify('No foreground subagents running', 'info');
      }
    },
  });
}

function readStringFlag(pi: ExtensionAPI, name: string): string | undefined {
  const value = pi.getFlag?.(name);
  return typeof value === 'string' && value.trim().length > ZERO ? value.trim() : undefined;
}

function findBrowserIntegration(pi: ExtensionAPI, config: SubagentsConfig): string | undefined {
  const hints = (config.browser.serverHints.length > ZERO ? config.browser.serverHints : DEFAULT_BROWSER_SERVER_HINTS).map((hint) => hint.toLowerCase());
  try {
    const serverNames = (pi.getMcpServers?.() ?? []).map((server) => server.name);
    const toolNames = (pi.getAllTools?.() ?? []).filter((tool) => tool.name.startsWith(MCP_TOOL_PREFIX)).map((tool) => tool.name);
    return [...serverNames, ...toolNames].find((name) => hints.some((hint) => name.toLowerCase().includes(hint)));
  } catch {
    return undefined;
  }
}

function registerFlags(pi: ExtensionAPI): void {
  pi.registerFlag(EXPLORE_MODEL_FLAG, {
    description: `Explore subagent model: default, inherit, or a model id (also settable in ${SUBAGENTS_CONFIG_FILE_NAME})`,
    type: 'string',
  });
  pi.registerFlag(MAX_DEPTH_FLAG, {
    description: `Deepest subagent level allowed, 0-5 (also settable in ${SUBAGENTS_CONFIG_FILE_NAME})`,
    type: 'string',
  });
}

export default function piSubagentsExtension(pi: ExtensionAPI): void {
  const store = createSubagentStore();
  let definitions: readonly SubagentDefinition[] = [];
  let definitionsKey: string | undefined;
  let config: SubagentsConfig | undefined;
  let configKey: string | undefined;
  let latestCtx: ExtensionContext | undefined;

  registerFlags(pi);

  const projectTrust = (ctx: ExtensionContext): boolean => ctx.isProjectTrusted?.() ?? false;
  const cacheKey = (ctx: ExtensionContext): string => `${ctx.cwd}\0${projectTrust(ctx) ? '1' : '0'}`;

  const loadConfig = (ctx: ExtensionContext): SubagentsConfig =>
    loadSubagentsConfig(
      ctx.cwd,
      getAgentDir(),
      {
        exploreModel: readStringFlag(pi, EXPLORE_MODEL_FLAG),
        maxNestingDepth: readStringFlag(pi, MAX_DEPTH_FLAG),
      },
      projectTrust(ctx),
    );

  const getConfig = (ctx: ExtensionContext): SubagentsConfig => {
    const key = cacheKey(ctx);
    if (config === undefined || configKey !== key) {
      config = loadConfig(ctx);
      configKey = key;
    }
    return config;
  };

  const reloadDefinitions = (ctx: ExtensionContext): readonly SubagentDefinition[] => {
    const nextConfig = loadConfig(ctx);
    config = nextConfig;
    configKey = cacheKey(ctx);
    definitions = discoverSubagents(ctx.cwd, { config: nextConfig, browserIntegration: findBrowserIntegration(pi, nextConfig), projectTrusted: projectTrust(ctx) });
    definitionsKey = cacheKey(ctx);
    return definitions;
  };

  const getDefinitions = (ctx: ExtensionContext): readonly SubagentDefinition[] => (definitions.length === ZERO || definitionsKey !== cacheKey(ctx) ? reloadDefinitions(ctx) : definitions);

  const onStateChanged = (options?: { readonly includeTranscriptItems?: boolean }): void => {
    pi.appendEntry(SUBAGENTS_ENTRY_CUSTOM_TYPE, store.toPersistedState(options));
  };

  const nestedStore: SubagentStore = { ...store, enqueueWakeup: () => false };

  const createNestedExtension =
    (scope: NestedScope) =>
    (child: ExtensionAPI): void => {
      registerSubagentTools(child, { ...callbacks, store: nestedStore, scope, getParentActiveTools: () => child.getActiveTools?.() ?? [] });
    };

  const callbacks: SubagentToolCallbacks = {
    store,
    getDefinitions,
    getConfig,
    onBackgroundCompleted: () => flushBackgroundWakeups(pi, store),
    onStateChanged,
    emit: (event, record, extra) => emitSubagentEvent(pi, event, record, extra),
    getParentActiveTools: () => pi.getActiveTools?.() ?? [],
  };

  const runnerCallbacks = {
    store,
    getConfig,
    onBackgroundCompleted: callbacks.onBackgroundCompleted,
    onStateChanged,
    emit: callbacks.emit,
    getParentActiveTools: callbacks.getParentActiveTools,
  };

  const retryRun = async (agentId: string, ctx: ExtensionContext): Promise<void> => {
    const record = store.getSession(agentId);
    if (!record) {
      ctx.ui.notify(`No subagent found for ${agentId}`, 'warning');
      return;
    }
    const definition = resolveSubagentDefinition(getDefinitions(ctx), record.subagentType);
    if (!definition) {
      ctx.ui.notify(`Subagent type "${record.subagentType}" is no longer available`, 'warning');
      return;
    }
    ctx.ui.notify(`Retrying subagent ${agentId}`, 'info');
    try {
      await runSubagentTask(
        {
          toolCallId: record.toolCallId,
          input: {
            description: record.description,
            prompt: record.prompt,
            subagent_type: record.subagentType,
            resume: record.agentId,
            readonly: record.readonly,
            run_in_background: record.isBackground ?? false,
            max_attempts: record.maxAttempts,
            ...(record.model !== undefined ? { model: record.model } : {}),
            ...(record.thinking !== undefined ? { thinking: record.thinking } : {}),
          },
          definition,
          ctx,
          createNestedExtension,
        },
        runnerCallbacks,
      );
    } catch (error) {
      ctx.ui.notify(`Retry failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const pruneWorktrees = async (agentId: string): Promise<PruneResult> => {
    const record = store.getSession(agentId);
    if (!record?.worktree) {
      return 'missing';
    }
    if (store.isRunBusy(agentId)) {
      return 'busy';
    }
    const removed = await removeSubagentWorktree(record.worktree);
    return removed.ok ? 'removed' : 'failed';
  };

  store.subscribe(() => {
    if (latestCtx) {
      syncSubagentsUi(latestCtx, store);
    }
  });

  registerSubagentTools(pi, callbacks);
  registerSubagentCommands(pi, {
    store,
    getDefinitions,
    reloadDefinitions,
    getConfig,
    retryRun,
    pruneWorktrees,
    registerAgentCommands: (nextDefinitions) => registerAgentCommands(pi, nextDefinitions, getDefinitions),
  });

  pi.registerMessageRenderer(BACKGROUND_COMPLETION_CUSTOM_TYPE, (message, _options, theme) => renderBackgroundCompletionMessage(message, theme));
  registerSubagentShortcuts(pi, store);

  pi.on('before_agent_start', async (_event, ctx) => {
    latestCtx = ctx;
    const catalog = buildSubagentsContextPrompt(getDefinitions(ctx), getConfig(ctx));
    const basePrompt = ctx.getSystemPrompt().trim();
    return { systemPrompt: basePrompt.length === ZERO ? catalog : `${basePrompt}\n\n${catalog}` };
  });

  pi.on('agent_end', async (_event, ctx) => {
    latestCtx = ctx;
    if (store.hasPendingWakeups()) {
      flushBackgroundWakeups(pi, store);
    }
    syncSubagentsUi(ctx, store);
  });

  pi.on('session_start', async (_event, ctx) => {
    latestCtx = ctx;
    store.reset();
    registerAgentCommands(pi, reloadDefinitions(ctx), getDefinitions);
    restorePersistedSessions(ctx, store);
    syncSubagentsUi(ctx, store);
  });

  pi.on('session_shutdown', async () => {
    store.abortAllRuns();
    onStateChanged();
  });

  pi.on('mcp_servers_change', async (_event, ctx) => {
    registerAgentCommands(pi, reloadDefinitions(ctx), getDefinitions);
  });
}
