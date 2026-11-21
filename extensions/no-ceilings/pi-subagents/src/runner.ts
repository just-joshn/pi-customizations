import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  getAgentDir,
  type ProviderConfig,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { formatSessionTitle, formatToolActivity } from './formatters.ts';
import { createReadonlySubagentExtension } from './readonly-guard.ts';
import { isMatchingLineage, isValidSubagentId, type SubagentRunOutcome, type SubagentStore } from './store.ts';
import {
  AWAIT_TIMEOUT_ERROR,
  type BackgroundCompletionPayload,
  DEFAULT_TASK_DESCRIPTION,
  ONE,
  SUBAGENT_ABORTED_ERROR,
  SUBAGENT_BUSY_ERROR,
  type SubagentDefinition,
  type SubagentSessionRecord,
  type TaskToolDetails,
  type TaskToolInput,
  ZERO,
} from './types.ts';

const FAST_MODEL_HINTS = ['haiku', 'flash', 'mini', 'nano', 'fast', 'lite'] as const;
const SUBAGENTS_DIR_NAME = 'subagents';
const SLASH_CHAR = '/';

export interface RunnerCallbacks {
  readonly store: SubagentStore;
  readonly onBackgroundCompleted: (payload: BackgroundCompletionPayload) => void;
  readonly onStateChanged: () => void;
}

export interface RunTaskOptions {
  readonly toolCallId: string;
  readonly input: TaskToolInput;
  readonly definition: SubagentDefinition;
  readonly ctx: ExtensionContext;
  readonly signal?: AbortSignal;
  readonly onUpdate?: (details: TaskToolDetails) => void;
}

export function resolveModelForSubagent(requestedModel: string | undefined, definition: SubagentDefinition, ctx: ExtensionContext): Model<Api> | undefined {
  const effective = (requestedModel ?? '').trim() || definition.model;
  if (definition.forceDefaultModel || effective.length === ZERO || effective === 'inherit' || effective === 'default') {
    return ctx.model;
  }
  const available = ctx.modelRegistry.getAvailable();
  if (effective === 'fast') {
    const fastHit = available.find((m) => FAST_MODEL_HINTS.some((hint) => m.id.toLowerCase().includes(hint)));
    return fastHit ?? ctx.model;
  }
  const slashIndex = effective.indexOf(SLASH_CHAR);
  if (slashIndex > ZERO) {
    const provider = effective.slice(ZERO, slashIndex);
    const id = effective.slice(slashIndex + ONE);
    const exact = ctx.modelRegistry.find(provider, id);
    if (exact) {
      return exact;
    }
  }
  const byId = available.find((m) => m.id === effective) ?? ctx.modelRegistry.getAll().find((m) => m.id === effective);
  return byId ?? ctx.model;
}

function resolveSubagentSessionDir(ctx: ExtensionContext): string | undefined {
  const sessionDir = ctx.sessionManager.getSessionDir();
  if (!sessionDir || sessionDir.trim().length === ZERO) {
    return undefined;
  }
  const targetDir = join(sessionDir, SUBAGENTS_DIR_NAME);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
}

function createChildSessionManager(cwd: string, transcriptPath: string | undefined, isResume: boolean, sessionDir: string | undefined): SessionManager {
  if (isResume && transcriptPath && existsSync(transcriptPath)) {
    return SessionManager.open(transcriptPath, sessionDir);
  }
  if (sessionDir) {
    return SessionManager.create(cwd, sessionDir);
  }
  return SessionManager.inMemory(cwd);
}

function buildDetailsFromRecord(record: SubagentSessionRecord): TaskToolDetails {
  const transcriptText = record.transcriptItems
    .filter((item) => item.role === 'assistant' && item.text.trim().length > ZERO)
    .map((item) => item.text.trimEnd())
    .join('\n\n');
  return {
    agentId: record.agentId,
    description: record.description,
    subagentType: record.subagentType,
    ...(record.model !== undefined ? { model: record.model } : {}),
    readonly: record.readonly,
    status: record.status,
    isBackground: record.isBackground,
    backgroundReason: record.backgroundReason,
    toolCallCount: record.toolCallCount,
    ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
    ...(record.currentStep !== undefined ? { currentStep: record.currentStep } : {}),
    ...(record.activeToolVerb !== undefined ? { activeToolVerb: record.activeToolVerb } : {}),
    ...(record.activeToolDetail !== undefined ? { activeToolDetail: record.activeToolDetail } : {}),
    ...(record.streamingText !== undefined ? { streamingText: record.streamingText } : {}),
    ...(record.streamingThinking !== undefined ? { streamingThinking: record.streamingThinking } : {}),
    ...(transcriptText.length > ZERO ? { transcriptText } : {}),
    ...(record.lastMessage !== undefined ? { finalMessage: record.lastMessage } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
    ...(record.transcriptPath !== undefined ? { transcriptPath: record.transcriptPath } : {}),
  };
}

function extractRecordArgs(args: unknown): Readonly<Record<string, unknown>> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return Object.fromEntries(Object.entries(args));
  }
  return {};
}

interface StreamProgressState {
  readonly toolCallCount: number;
  readonly finalMessage?: string;
}

function handleSubagentEvent(agentId: string, event: AgentSessionEvent, store: SubagentStore, progress: StreamProgressState): StreamProgressState {
  const now = Date.now();
  if (event.type === 'turn_start') {
    store.updateSession(agentId, (rec) => ({ ...rec, streamingText: undefined, streamingThinking: undefined, updatedAt: now }));
    return progress;
  }
  if (event.type === 'message_update') {
    const sub = event.assistantMessageEvent;
    if (sub.type === 'text_delta') {
      const prev = store.getSession(agentId);
      const nextText = `${prev?.streamingText ?? ''}${sub.delta}`;
      store.updateSession(agentId, (rec) => ({ ...rec, status: 'running', streamingText: nextText, currentStep: 'Responding…', updatedAt: now }));
      return { ...progress, finalMessage: nextText };
    }
    if (sub.type === 'thinking_delta') {
      const prev = store.getSession(agentId);
      const nextThinking = `${prev?.streamingThinking ?? ''}${sub.delta}`;
      store.updateSession(agentId, (rec) => ({ ...rec, status: 'running', streamingThinking: nextThinking, currentStep: 'Thinking…', updatedAt: now }));
    }
    return progress;
  }
  if (event.type === 'tool_execution_start') {
    const { verb, detail, stepLabel } = formatToolActivity(event.toolName, extractRecordArgs(event.args));
    store.updateSession(agentId, (rec) => ({ ...rec, status: 'running', activeToolVerb: verb, activeToolDetail: detail, currentStep: stepLabel, updatedAt: now }));
    store.appendTranscriptItem(agentId, { id: event.toolCallId, role: 'tool', text: stepLabel, toolName: event.toolName, toolSummary: stepLabel, completed: false, timestamp: now });
    return progress;
  }
  if (event.type === 'tool_execution_end') {
    const nextCount = progress.toolCallCount + ONE;
    store.updateSession(agentId, (rec) => ({
      ...rec,
      toolCallCount: nextCount,
      activeToolVerb: undefined,
      activeToolDetail: undefined,
      currentStep: 'Working…',
      transcriptItems: rec.transcriptItems.map((item) => (item.id === event.toolCallId ? { ...item, completed: true } : item)),
      updatedAt: now,
    }));
    return { ...progress, toolCallCount: nextCount };
  }
  return progress;
}

function createInheritedProvidersExtension(modelRegistry: ExtensionContext['modelRegistry']): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    const providerIds = modelRegistry.getRegisteredProviderIds?.() ?? [];
    for (const providerId of providerIds) {
      const nativeProvider = modelRegistry.getRegisteredNativeProvider?.(providerId);
      if (nativeProvider !== undefined) {
        pi.registerProvider(nativeProvider);
        continue;
      }
      const config = modelRegistry.getRegisteredProviderConfig?.(providerId);
      if (config !== undefined) {
        pi.registerProvider(providerId, config as ProviderConfig);
      }
    }
  };
}

async function createChildSession(
  options: RunTaskOptions,
  model: Model<Api> | undefined,
  readonly: boolean,
  existingTranscriptPath: string | undefined,
  isResume: boolean,
): Promise<{ readonly session: AgentSession; readonly transcriptPath?: string }> {
  const sessionDir = resolveSubagentSessionDir(options.ctx);
  const sessionManager = createChildSessionManager(options.ctx.cwd, existingTranscriptPath, isResume, sessionDir);
  const providerBridge = createInheritedProvidersExtension(options.ctx.modelRegistry);
  const extensionFactories = readonly ? [createReadonlySubagentExtension(), providerBridge] : [providerBridge];
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.ctx.cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories,
    appendSystemPrompt: [options.definition.prompt],
  });
  await resourceLoader.reload();
  const tools = options.definition.tools.length > ZERO ? [...options.definition.tools] : undefined;
  const { session } = await createAgentSession({
    cwd: options.ctx.cwd,
    agentDir: getAgentDir(),
    ...(model ? { model } : {}),
    ...(tools ? { tools } : {}),
    sessionManager,
    resourceLoader,
  });
  const transcriptPath = sessionManager.getSessionFile() ?? existingTranscriptPath;
  if (transcriptPath) {
    const parentDir = dirname(transcriptPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
  }
  return { session, ...(transcriptPath ? { transcriptPath } : {}) };
}

function finalizeSubagentSession(store: SubagentStore, agentId: string, outcome: SubagentRunOutcome, startedAt: number): SubagentSessionRecord | undefined {
  const now = Date.now();
  const durationMs = Math.max(ZERO, now - startedAt);
  if (outcome.status === 'completed') {
    return store.updateSession(agentId, (rec) => ({
      ...rec,
      status: 'success',
      lastMessage: outcome.finalMessage ?? rec.lastMessage,
      toolCallCount: outcome.toolCallCount,
      durationMs,
      currentStep: 'Done',
      activeToolVerb: undefined,
      activeToolDetail: undefined,
      streamingText: undefined,
      streamingThinking: undefined,
      closedAt: now,
      updatedAt: now,
    }));
  }
  const isAborted = outcome.status === 'aborted';
  return store.updateSession(agentId, (rec) => ({
    ...rec,
    status: isAborted ? 'cancelled' : 'error',
    error: outcome.error,
    durationMs,
    currentStep: isAborted ? 'Cancelled' : 'Failed',
    closedAt: now,
    updatedAt: now,
  }));
}

function buildBackgroundPayload(record: SubagentSessionRecord, outcome: SubagentRunOutcome): BackgroundCompletionPayload {
  const status = outcome.status === 'completed' ? 'success' : outcome.status === 'aborted' ? 'aborted' : 'error';
  const detail = outcome.status === 'completed' ? outcome.finalMessage : outcome.error;
  return {
    taskId: record.agentId,
    ...(record.toolCallId.trim().length > ZERO ? { toolCallId: record.toolCallId } : {}),
    kind: 'subagent',
    status,
    title: formatSessionTitle(record.description, record.prompt, record.agentId),
    ...(detail ? { detail } : {}),
    ...(record.transcriptPath ? { outputPath: record.transcriptPath } : {}),
  };
}

function executeSessionLifecycle(
  session: AgentSession,
  agentId: string,
  prompt: string,
  startedAt: number,
  abortController: AbortController,
  store: SubagentStore,
  onUpdate?: (details: TaskToolDetails) => void,
): Promise<SubagentRunOutcome> {
  let progress: StreamProgressState = { toolCallCount: ZERO };
  const unsubscribe = session.subscribe((event) => {
    progress = handleSubagentEvent(agentId, event, store, progress);
    const updated = store.getSession(agentId);
    if (updated && onUpdate) {
      onUpdate(buildDetailsFromRecord(updated));
    }
  });
  const onAbort = (): void => {
    void session.abort();
  };
  abortController.signal.addEventListener('abort', onAbort, { once: true });

  return session
    .prompt(prompt)
    .then((): SubagentRunOutcome => {
      const durationMs = Math.max(ZERO, Date.now() - startedAt);
      if (abortController.signal.aborted) {
        return { status: 'aborted', error: SUBAGENT_ABORTED_ERROR, durationMs };
      }
      const finalText = session.getLastAssistantText() || progress.finalMessage;
      if (finalText && finalText.trim().length > ZERO) {
        store.appendTranscriptItem(agentId, { id: randomUUID(), role: 'assistant', text: finalText, completed: true, timestamp: Date.now() });
      }
      return { status: 'completed', ...(finalText ? { finalMessage: finalText } : {}), toolCallCount: progress.toolCallCount, durationMs };
    })
    .catch((error: unknown): SubagentRunOutcome => {
      const durationMs = Math.max(ZERO, Date.now() - startedAt);
      if (abortController.signal.aborted) {
        return { status: 'aborted', error: SUBAGENT_ABORTED_ERROR, durationMs };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'error', error: message, durationMs };
    })
    .finally(() => {
      abortController.signal.removeEventListener('abort', onAbort);
      unsubscribe();
      session.dispose();
    });
}

function validateResumeRequest(resumeId: string, prompt: string, parentSessionId: string, store: SubagentStore): SubagentSessionRecord {
  if (!isValidSubagentId(resumeId)) {
    throw new Error(`Invalid resumeAgentId format: ${resumeId}`);
  }
  if (prompt.trim().length > ZERO && store.isRunBusy(resumeId)) {
    throw new Error(SUBAGENT_BUSY_ERROR);
  }
  const existing = store.getSession(resumeId);
  if (!isMatchingLineage(existing, parentSessionId) || !existing) {
    throw new Error(`Cannot resume subagent ${resumeId}: its conversation state is no longer available. Start a new subagent instead.`);
  }
  return existing;
}

export async function awaitBackgroundSubagent(
  agentId: string,
  store: SubagentStore,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<{ readonly outcome: 'complete' | 'still_running' | 'not_found' | 'error'; readonly record?: SubagentSessionRecord; readonly error?: string }> {
  const existing = store.getSession(agentId);
  if (!existing) {
    return { outcome: 'not_found', error: `No background subagent found for id: ${agentId}` };
  }
  const active = store.getActiveRun(agentId);
  if (!active) {
    store.suppressWakeup(agentId);
    return { outcome: 'complete', record: existing };
  }
  if (signal?.aborted) {
    return { outcome: 'error', error: AWAIT_TIMEOUT_ERROR };
  }
  store.suppressWakeup(agentId);
  const raceResult = await new Promise<'done' | 'timeout' | 'aborted'>((resolveRace) => {
    let settled = false;
    const finish = (val: 'done' | 'timeout' | 'aborted'): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener('abort', onAbort);
      resolveRace(val);
    };
    const onAbort = (): void => finish('aborted');
    const timer = timeoutMs !== undefined && Number.isFinite(timeoutMs) ? setTimeout(() => finish('timeout'), timeoutMs) : undefined;
    timer?.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    void active.completionPromise.then(() => finish('done'));
  });
  if (raceResult === 'done') {
    const updated = store.getSession(agentId);
    return { outcome: 'complete', ...(updated ? { record: updated } : {}) };
  }
  store.unsuppressWakeup(agentId);
  if (raceResult === 'aborted') {
    return { outcome: 'error', error: AWAIT_TIMEOUT_ERROR };
  }
  const current = store.getSession(agentId);
  return { outcome: 'still_running', ...(current ? { record: current } : {}) };
}

function attachBackgroundCompletionHandler(agentId: string, startedAt: number, runPromise: Promise<SubagentRunOutcome>, callbacks: RunnerCallbacks): Promise<SubagentRunOutcome> {
  return runPromise.then((outcome) => {
    callbacks.store.clearActiveRun(agentId);
    const finalized = finalizeSubagentSession(callbacks.store, agentId, outcome, startedAt);
    if (finalized) {
      const payload = buildBackgroundPayload(finalized, outcome);
      if (callbacks.store.enqueueWakeup(payload)) {
        callbacks.onBackgroundCompleted(payload);
      }
    }
    callbacks.onStateChanged();
    return outcome;
  });
}

async function runForegroundSubagent(options: RunTaskOptions, initialRecord: SubagentSessionRecord, runPromise: Promise<SubagentRunOutcome>, abortController: AbortController, callbacks: RunnerCallbacks): Promise<TaskToolDetails> {
  const { agentId, startedAt } = initialRecord;
  let backgrounded = false;
  let triggerBackground: (() => void) | undefined;
  const backgroundPromise = new Promise<'backgrounded'>((resolveBg) => {
    triggerBackground = () => resolveBg('backgrounded');
  });
  const onParentAbort = (): void => {
    if (!backgrounded) {
      abortController.abort();
    }
  };
  options.signal?.addEventListener('abort', onParentAbort, { once: true });
  if (options.signal?.aborted) {
    onParentAbort();
  }
  const requestBackground = (): boolean => {
    if (backgrounded || abortController.signal.aborted) {
      return false;
    }
    backgrounded = true;
    options.signal?.removeEventListener('abort', onParentAbort);
    callbacks.store.updateSession(agentId, (rec) => ({ ...rec, isBackground: true, backgroundReason: 'user_request', currentStep: 'Running in background', updatedAt: Date.now() }));
    const settledPromise = attachBackgroundCompletionHandler(agentId, startedAt, runPromise, callbacks);
    callbacks.store.registerActiveRun({ agentId, toolCallId: options.toolCallId, isBackground: true, abort: () => abortController.abort(), completionPromise: settledPromise });
    triggerBackground?.();
    return true;
  };
  callbacks.store.registerActiveRun({ agentId, toolCallId: options.toolCallId, isBackground: false, abort: () => abortController.abort(), requestBackground, completionPromise: runPromise });

  const winner = await Promise.race([runPromise.then((outcome) => ({ kind: 'completed' as const, outcome })), backgroundPromise.then(() => ({ kind: 'backgrounded' as const }))]);
  if (winner.kind === 'backgrounded') {
    callbacks.onStateChanged();
    return buildDetailsFromRecord(callbacks.store.getSession(agentId) ?? initialRecord);
  }
  options.signal?.removeEventListener('abort', onParentAbort);
  callbacks.store.clearActiveRun(agentId);
  const finalized = finalizeSubagentSession(callbacks.store, agentId, winner.outcome, startedAt) ?? initialRecord;
  callbacks.onStateChanged();
  return buildDetailsFromRecord(finalized);
}

function buildInitialSessionRecord(
  options: RunTaskOptions,
  agentId: string,
  parentSessionId: string,
  existing: SubagentSessionRecord | undefined,
  resolvedModel: Model<Api> | undefined,
  isReadonly: boolean,
  wantBackground: boolean,
  startedAt: number,
  transcriptPath: string | undefined,
): SubagentSessionRecord {
  const prompt = options.input.prompt.trim();
  const description = options.input.description.trim() || existing?.description || DEFAULT_TASK_DESCRIPTION;
  return {
    agentId,
    parentSessionId,
    toolCallId: options.toolCallId,
    subagentType: options.definition.name,
    description,
    prompt,
    ...(resolvedModel ? { model: `${resolvedModel.provider}/${resolvedModel.id}` } : {}),
    readonly: isReadonly,
    status: 'running',
    isBackground: wantBackground,
    backgroundReason: wantBackground ? 'agent_request' : 'unspecified',
    currentStep: wantBackground ? 'Running in background' : 'Starting…',
    toolCallCount: existing?.toolCallCount ?? ZERO,
    startedAt,
    updatedAt: startedAt,
    ...(transcriptPath ? { transcriptPath } : {}),
    transcriptItems: [...(existing?.transcriptItems ?? []), { id: randomUUID(), role: 'user', text: prompt, completed: true, timestamp: startedAt }],
  };
}

export async function runSubagentTask(options: RunTaskOptions, callbacks: RunnerCallbacks): Promise<TaskToolDetails> {
  const parentSessionId = options.ctx.sessionManager.getSessionId();
  const prompt = options.input.prompt.trim();
  const resumeId = options.input.resume?.trim();
  const isReadonly = options.input.readonly ?? options.definition.permissionMode === 'readonly';

  if (resumeId && prompt.length === ZERO && isReadonly && options.input.run_in_background !== true) {
    const awaited = await awaitBackgroundSubagent(resumeId, callbacks.store, undefined, options.signal);
    if (awaited.outcome === 'complete' && awaited.record) {
      return buildDetailsFromRecord(awaited.record);
    }
    throw new Error(awaited.error ?? AWAIT_TIMEOUT_ERROR);
  }
  if (prompt.length === ZERO) {
    throw new Error('Subagent task requires a non-empty prompt.');
  }

  const wantBackground = options.input.run_in_background ?? options.definition.isBackground;
  const existing = resumeId ? validateResumeRequest(resumeId, prompt, parentSessionId, callbacks.store) : undefined;
  const agentId = existing ? existing.agentId : randomUUID();
  const startedAt = Date.now();
  const resolvedModel = resolveModelForSubagent(options.input.model, options.definition, options.ctx);
  const { session, transcriptPath } = await createChildSession(options, resolvedModel, isReadonly, existing?.transcriptPath, existing !== undefined);
  const initialRecord = buildInitialSessionRecord(options, agentId, parentSessionId, existing, resolvedModel, isReadonly, wantBackground, startedAt, transcriptPath);
  callbacks.store.upsertSession(initialRecord);
  options.onUpdate?.(buildDetailsFromRecord(initialRecord));

  const abortController = new AbortController();
  if (!wantBackground && options.signal?.aborted) {
    abortController.abort();
  }
  const runPromise = executeSessionLifecycle(session, agentId, prompt, startedAt, abortController, callbacks.store, wantBackground ? undefined : options.onUpdate);

  if (wantBackground) {
    const settledPromise = attachBackgroundCompletionHandler(agentId, startedAt, runPromise, callbacks);
    callbacks.store.registerActiveRun({ agentId, toolCallId: options.toolCallId, isBackground: true, abort: () => abortController.abort(), completionPromise: settledPromise });
    callbacks.onStateChanged();
    return buildDetailsFromRecord(initialRecord);
  }
  return runForegroundSubagent(options, initialRecord, runPromise, abortController, callbacks);
}
