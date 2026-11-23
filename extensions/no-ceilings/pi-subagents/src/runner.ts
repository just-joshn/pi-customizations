import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent, ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { SubagentsConfig } from './config.ts';
import type { SubagentEventName, SubagentEventPayload } from './events.ts';
import { errorMessage, failureCode, SubagentRunError } from './failures.ts';
import { formatSessionTitle } from './formatters.ts';
import { applyDefinitionToModel, describeModel, resolveSubagentModel } from './model-resolution.ts';
import { createChildSession, materializeTranscriptFile } from './session-factory.ts';
import { isMatchingLineage, isValidSubagentId, type SubagentRunOutcome, type SubagentStore } from './store.ts';
import { type RunProgress, reduceSubagentEvent } from './transcript.ts';
import {
  type BackgroundCompletionPayload,
  type BackgroundReason,
  DEFAULT_TASK_DESCRIPTION,
  type NestedScope,
  ONE,
  SUBAGENT_ABORTED_ERROR,
  SUBAGENT_FAILURE_MESSAGES,
  type SubagentDefinition,
  type SubagentFailureCode,
  type SubagentSessionRecord,
  type SubagentThinkingLevel,
  type SubagentWorktree,
  type TaskToolDetails,
  type TaskToolInput,
  ZERO,
} from './types.ts';
import { createSubagentWorktree, resolveWorktreeChildCwd, summarizeWorktreeDiff } from './worktree.ts';

const MAX_FAILURE_ID_CHARS = 12;
const MAX_RETRY_ATTEMPTS_CAP = 10;
const NON_RETRYABLE_FAILURES: ReadonlySet<SubagentFailureCode> = new Set(['resume-unavailable', 'worktree-failed', 'nesting-limit', 'invalid-id', 'empty-prompt', 'type-unknown', 'model-unknown', 'resume-not-owned', 'busy']);

export interface RunnerCallbacks {
  readonly store: SubagentStore;
  readonly onBackgroundCompleted: (payload: BackgroundCompletionPayload) => void;
  readonly onStateChanged: (options?: { readonly includeTranscriptItems?: boolean }) => void;
  readonly emit: (event: SubagentEventName, record: SubagentSessionRecord, extra?: Partial<SubagentEventPayload>) => void;
  readonly getParentActiveTools: () => readonly string[];
  readonly getConfig: (ctx: ExtensionContext) => SubagentsConfig;
}

export interface RunTaskOptions {
  readonly toolCallId: string;
  readonly input: TaskToolInput;
  readonly definition: SubagentDefinition;
  readonly ctx: ExtensionContext;
  readonly signal?: AbortSignal;
  readonly scope?: NestedScope;
  readonly createNestedExtension: (scope: NestedScope) => ExtensionFactory;
  readonly onUpdate?: (details: TaskToolDetails) => void;
  readonly retry?: boolean;
}

function createFailureId(): string {
  return randomUUID().replace(/-/g, '').slice(ZERO, MAX_FAILURE_ID_CHARS);
}

export function buildDetailsFromRecord(record: SubagentSessionRecord): TaskToolDetails {
  const transcriptText = record.transcriptItems
    .filter((item) => item.role === 'assistant' && item.text.trim().length > ZERO)
    .map((item) => item.text.trimEnd())
    .join('\n\n');
  return {
    agentId: record.agentId,
    description: record.description,
    subagentType: record.subagentType,
    ...(record.model !== undefined ? { model: record.model } : {}),
    ...(record.thinking !== undefined ? { thinking: record.thinking } : {}),
    readonly: record.readonly,
    status: record.status,
    isBackground: record.isBackground,
    backgroundReason: record.backgroundReason,
    attempts: record.attempts,
    maxAttempts: record.maxAttempts,
    toolCallCount: record.toolCallCount,
    checkpoints: record.checkpoints.length,
    ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
    ...(record.currentStep !== undefined ? { currentStep: record.currentStep } : {}),
    ...(record.activeToolVerb !== undefined ? { activeToolVerb: record.activeToolVerb } : {}),
    ...(record.activeToolDetail !== undefined ? { activeToolDetail: record.activeToolDetail } : {}),
    ...(record.streamingText !== undefined ? { streamingText: record.streamingText } : {}),
    ...(record.streamingThinking !== undefined ? { streamingThinking: record.streamingThinking } : {}),
    ...(transcriptText.length > ZERO ? { transcriptText } : {}),
    ...(record.lastMessage !== undefined ? { finalMessage: record.lastMessage } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
    ...(record.errorCode !== undefined ? { errorCode: record.errorCode } : {}),
    ...(record.failureId !== undefined ? { failureId: record.failureId } : {}),
    ...(record.transcriptPath !== undefined ? { transcriptPath: record.transcriptPath } : {}),
    ...(record.worktree !== undefined ? { worktreePath: record.worktree.path, branch: record.worktree.branch } : {}),
    ...(record.worktreeSummary !== undefined ? { worktreeSummary: record.worktreeSummary } : {}),
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= ZERO || signal.aborted) {
      resolve();
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener('abort', finish, { once: true });
  });
}

function resolveChildDepth(existing: SubagentSessionRecord | undefined, scope: NestedScope | undefined, store: SubagentStore): number {
  if (scope !== undefined) {
    return scope.depth + ONE;
  }
  let depth = ONE;
  const visited = new Set<string>();
  let ownerId = existing?.ownerAgentId;
  while (ownerId !== undefined && !visited.has(ownerId)) {
    visited.add(ownerId);
    depth += ONE;
    ownerId = store.getSession(ownerId)?.ownerAgentId;
  }
  return depth;
}

function finalizeSubagentSession(store: SubagentStore, agentId: string, outcome: SubagentRunOutcome, startedAt: number): SubagentSessionRecord | undefined {
  const now = Date.now();
  const durationMs = Math.max(ZERO, now - startedAt);
  if (outcome.status === 'completed') {
    return store.updateSession(agentId, (record) => ({
      ...record,
      status: 'success',
      lastMessage: outcome.finalMessage ?? record.lastMessage,
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
  return store.updateSession(agentId, (record) => ({
    ...record,
    status: isAborted ? 'cancelled' : 'error',
    error: outcome.error,
    errorCode: outcome.errorCode,
    failureId: record.failureId ?? createFailureId(),
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
    ...(record.failureId ? { failureId: record.failureId } : {}),
    attempts: record.attempts,
    ...(record.worktree ? { worktreePath: record.worktree.path, branch: record.worktree.branch, ...(record.worktreeSummary !== undefined ? { worktreeSummary: record.worktreeSummary } : {}) } : {}),
  };
}

interface LifecycleRequest {
  readonly session: AgentSession;
  readonly agentId: string;
  readonly prompt: string;
  readonly startedAt: number;
  readonly abortController: AbortController;
  readonly transcriptPath: string | undefined;
  readonly nestedScope: NestedScope | undefined;
  readonly store: SubagentStore;
  readonly callbacks: RunnerCallbacks;
  readonly onUpdate?: (details: TaskToolDetails) => void;
}

function ensureFinalAssistantItem(store: SubagentStore, agentId: string, finalText: string): void {
  const trimmed = finalText.trim();
  const record = store.getSession(agentId);
  const lastAssistant = [...(record?.transcriptItems ?? [])].reverse().find((item) => item.role === 'assistant');
  if (lastAssistant?.text.trim() === trimmed) {
    return;
  }
  store.appendTranscriptItem(agentId, { id: randomUUID(), role: 'assistant', text: trimmed, completed: true, timestamp: Date.now() });
}

function applyChildEvent(request: LifecycleRequest, event: AgentSessionEvent, progress: RunProgress): RunProgress {
  const previous = request.store.getSession(request.agentId);
  if (!previous) {
    return progress;
  }
  const reduced = reduceSubagentEvent(previous, event, progress, Date.now());
  request.store.upsertSession(reduced.record);
  if (reduced.checkpoint) {
    const before = previous.checkpoints.length;
    const checkpoint = request.store.withCheckpoint(request.agentId, { transcriptPath: request.transcriptPath });
    const after = request.store.getSession(request.agentId)?.checkpoints.length ?? before;
    if (checkpoint && after > before) {
      request.callbacks.emit('checkpoint', request.store.getSession(request.agentId) ?? reduced.record, { checkpointSeq: checkpoint.seq });
      request.callbacks.onStateChanged({ includeTranscriptItems: false });
    }
  }
  if (event.type === 'tool_execution_start') {
    request.callbacks.emit('toolCall', request.store.getSession(request.agentId) ?? reduced.record, { toolName: event.toolName });
  }
  request.onUpdate?.(buildDetailsFromRecord(reduced.record));
  return reduced.progress;
}

function abortNestedRuns(scope: NestedScope | undefined, store: SubagentStore): void {
  for (const agentId of scope?.agentIds ?? []) {
    store.abortRun(agentId);
  }
}

const MODEL_REQUEST_FAILED = 'Subagent model request failed';

interface AssistantStop {
  readonly stopReason: string;
  readonly errorMessage?: string;
}

function readAssistantStop(message: { readonly role: string; readonly stopReason?: unknown; readonly errorMessage?: unknown }): AssistantStop | undefined {
  if (message.role !== 'assistant' || typeof message.stopReason !== 'string') {
    return undefined;
  }
  const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage : undefined;
  return { stopReason: message.stopReason, ...(errorMessage !== undefined ? { errorMessage } : {}) };
}

function listedMessages(session: AgentSession): readonly { readonly role: string; readonly stopReason?: unknown; readonly errorMessage?: unknown }[] | undefined {
  if (!('messages' in session)) {
    return undefined;
  }
  const messages = session.messages;
  return Array.isArray(messages) ? messages : undefined;
}

function lastAssistantStop(messages: readonly { readonly role: string; readonly stopReason?: unknown; readonly errorMessage?: unknown }[], start: number): AssistantStop | undefined {
  let found: AssistantStop | undefined;
  for (const message of messages.slice(start)) {
    const stop = readAssistantStop(message);
    if (stop !== undefined) {
      found = stop;
    }
  }
  return found;
}

function abortedOutcome(durationMs: number): SubagentRunOutcome {
  return { status: 'aborted', error: SUBAGENT_ABORTED_ERROR, errorCode: 'aborted', durationMs };
}

function promptOutcome(request: LifecycleRequest, progress: RunProgress, fromEvents: AssistantStop | undefined, messageStart: number): SubagentRunOutcome {
  const durationMs = Math.max(ZERO, Date.now() - request.startedAt);
  if (request.abortController.signal.aborted) {
    return abortedOutcome(durationMs);
  }
  const assistant = lastAssistantStop(listedMessages(request.session) ?? [], messageStart) ?? fromEvents;
  if (assistant?.stopReason === 'aborted') {
    return abortedOutcome(durationMs);
  }
  if (assistant?.stopReason === 'error') {
    return { status: 'error', error: assistant.errorMessage || MODEL_REQUEST_FAILED, errorCode: 'failed', durationMs };
  }
  const finalText = (request.session.getLastAssistantText() ?? progress.finalMessage ?? '').trim();
  if (finalText.length > ZERO) {
    ensureFinalAssistantItem(request.store, request.agentId, finalText);
  }
  return { status: 'completed', ...(finalText.length > ZERO ? { finalMessage: finalText } : {}), toolCallCount: progress.toolCallCount, durationMs };
}

function runSession(request: LifecycleRequest): Promise<SubagentRunOutcome> {
  if (request.abortController.signal.aborted) {
    request.session.dispose();
    return Promise.resolve(abortedOutcome(Math.max(ZERO, Date.now() - request.startedAt)));
  }
  let progress: RunProgress = { toolCallCount: request.store.getSession(request.agentId)?.toolCallCount ?? ZERO, finalMessage: undefined };
  let fromEvents: AssistantStop | undefined;
  const messageStart = listedMessages(request.session)?.length ?? ZERO;
  const unsubscribe = request.session.subscribe((event) => {
    if (event.type === 'message_end') {
      fromEvents = readAssistantStop(event.message) ?? fromEvents;
    }
    progress = applyChildEvent(request, event, progress);
  });
  const onAbort = (): void => {
    void request.session.abort();
  };
  request.abortController.signal.addEventListener('abort', onAbort, { once: true });

  return request.session
    .prompt(request.prompt)
    .then((): SubagentRunOutcome => promptOutcome(request, progress, fromEvents, messageStart))
    .catch((error: unknown): SubagentRunOutcome => {
      const durationMs = Math.max(ZERO, Date.now() - request.startedAt);
      if (request.abortController.signal.aborted) {
        return abortedOutcome(durationMs);
      }
      return { status: 'error', error: errorMessage(error), errorCode: failureCode(error), durationMs };
    })
    .finally(() => {
      request.abortController.signal.removeEventListener('abort', onAbort);
      unsubscribe();
      request.session.dispose();
      abortNestedRuns(request.nestedScope, request.store);
    });
}

function validateResumeRequest(resumeId: string, prompt: string, parentSessionId: string, store: SubagentStore, allowMissingTranscript = false): SubagentSessionRecord {
  if (!isValidSubagentId(resumeId)) {
    throw new SubagentRunError('invalid-id', resumeId);
  }
  const running = store.isRunBusy(resumeId);
  if (prompt.trim().length > ZERO && running) {
    throw new SubagentRunError('busy');
  }
  const existing = store.getSession(resumeId);
  if (!isMatchingLineage(existing, parentSessionId) || !existing) {
    throw new SubagentRunError('resume-unavailable', resumeId);
  }
  if (existing.worktree !== undefined && !existsSync(existing.worktree.path)) {
    throw new SubagentRunError('resume-unavailable', resumeId);
  }
  // The path is recorded when the child starts, and the file is flushed when the run ends.
  if (!running && existing.transcriptPath !== undefined && !existsSync(existing.transcriptPath)) {
    throw new SubagentRunError('resume-unavailable', resumeId);
  }
  if (!running && existing.transcriptPath === undefined && !allowMissingTranscript) {
    throw new SubagentRunError('resume-unavailable', resumeId);
  }
  return existing;
}

export interface AwaitSubagentResult {
  readonly outcome: 'complete' | 'still_running' | 'not_found' | 'error';
  readonly record?: SubagentSessionRecord;
  readonly error?: string;
  readonly errorCode?: 'await-timeout' | 'await-not-found' | 'aborted';
}

export async function awaitBackgroundSubagent(agentId: string, store: SubagentStore, timeoutMs: number | undefined, signal?: AbortSignal): Promise<AwaitSubagentResult> {
  const existing = store.getSession(agentId);
  if (!existing) {
    return { outcome: 'not_found', error: `${SUBAGENT_FAILURE_MESSAGES['await-not-found']}: ${agentId}`, errorCode: 'await-not-found' };
  }
  const active = store.getActiveRun(agentId);
  if (!active) {
    store.suppressWakeup(agentId);
    return { outcome: 'complete', record: existing };
  }
  if (signal?.aborted) {
    return { outcome: 'error', error: SUBAGENT_ABORTED_ERROR, errorCode: 'aborted' };
  }
  store.suppressWakeup(agentId);
  const raceResult = await new Promise<'done' | 'timeout' | 'aborted'>((resolveRace) => {
    let settled = false;
    const timer = timeoutMs !== undefined && Number.isFinite(timeoutMs) ? setTimeout(() => finish('timeout'), timeoutMs) : undefined;
    timer?.unref?.();
    function finish(value: 'done' | 'timeout' | 'aborted'): void {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener('abort', onAbort);
      resolveRace(value);
    }
    function onAbort(): void {
      finish('aborted');
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    void active.completionPromise.then(() => finish('done'));
  });
  if (raceResult === 'done') {
    store.unsuppressWakeup(agentId);
    const updated = store.getSession(agentId);
    return { outcome: 'complete', ...(updated ? { record: updated } : {}) };
  }
  store.unsuppressWakeup(agentId);
  if (raceResult === 'aborted') {
    return { outcome: 'error', error: SUBAGENT_ABORTED_ERROR, errorCode: 'aborted' };
  }
  const current = store.getSession(agentId);
  return { outcome: 'still_running', ...(current ? { record: current } : {}) };
}

interface AttemptPlan {
  readonly agentId: string;
  readonly prompt: string;
  readonly parentSessionId: string;
  readonly startedAt: number;
  readonly existing: SubagentSessionRecord | undefined;
  readonly isResume: boolean;
  readonly childDepth: number;
  readonly ownedAgentIds: readonly string[];
  readonly nestedScope: NestedScope | undefined;
  readonly abortController: AbortController;
  readonly childCwd: string;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly model: Model<Api> | undefined;
  readonly thinking: SubagentThinkingLevel | undefined;
  readonly readonly: boolean;
}

function failedOutcome(plan: AttemptPlan, error: string, code: SubagentFailureCode): SubagentRunOutcome {
  return { status: 'error', error, errorCode: code, durationMs: Math.max(ZERO, Date.now() - plan.startedAt) };
}

async function runOneAttempt(options: RunTaskOptions, callbacks: RunnerCallbacks, plan: AttemptPlan, attempt: number): Promise<SubagentRunOutcome> {
  const attemptRecord = callbacks.store.updateSession(plan.agentId, (record) => ({
    ...record,
    attempts: attempt,
    status: 'running',
    error: undefined,
    errorCode: undefined,
    streamingText: undefined,
    streamingThinking: undefined,
    currentStep: attempt === ONE ? 'Starting…' : `Retry ${attempt}/${plan.maxAttempts}`,
    updatedAt: Date.now(),
  }));
  if (attemptRecord) {
    callbacks.emit('status', attemptRecord);
  }
  try {
    const child = await createChildSession(
      {
        ctx: options.ctx,
        definition: options.definition,
        agentId: plan.agentId,
        parentSessionId: plan.parentSessionId,
        childDepth: plan.childDepth,
        ownedAgentIds: plan.ownedAgentIds,
        model: plan.model,
        thinking: plan.thinking,
        readonly: plan.readonly,
        existingTranscriptPath: attempt === ONE ? plan.existing?.transcriptPath : undefined,
        isResume: attempt === ONE && plan.isResume,
        cwd: plan.childCwd,
        projectTrusted: options.ctx.isProjectTrusted?.() ?? false,
        nestedScope: plan.nestedScope,
        createNestedExtension: options.createNestedExtension,
      },
      callbacks.getParentActiveTools(),
    );
    callbacks.store.updateSession(plan.agentId, (record) => ({ ...record, ...(child.transcriptPath !== undefined ? { transcriptPath: child.transcriptPath } : {}) }));
    callbacks.onStateChanged({ includeTranscriptItems: false });
    try {
      return await runSession({
        session: child.session,
        agentId: plan.agentId,
        prompt: plan.prompt,
        startedAt: plan.startedAt,
        abortController: plan.abortController,
        transcriptPath: child.transcriptPath,
        nestedScope: plan.nestedScope,
        store: callbacks.store,
        callbacks,
        ...(options.onUpdate ? { onUpdate: options.onUpdate } : {}),
      });
    } finally {
      try {
        materializeTranscriptFile(child.sessionManager);
      } catch {
        // Best-effort repair. A transcript write must not turn a finished run into a failure.
      }
    }
  } catch (error) {
    return { status: 'error', error: errorMessage(error), errorCode: failureCode(error), durationMs: Math.max(ZERO, Date.now() - plan.startedAt) };
  }
}

async function runAttempts(options: RunTaskOptions, callbacks: RunnerCallbacks, plan: AttemptPlan): Promise<SubagentRunOutcome> {
  let lastOutcome: SubagentRunOutcome = failedOutcome(plan, 'Subagent did not run', 'failed');
  for (let attempt: number = ONE; attempt <= plan.maxAttempts; attempt += ONE) {
    if (attempt > ONE) {
      await delay(plan.retryDelayMs, plan.abortController.signal);
    }
    if (plan.abortController.signal.aborted) {
      return { status: 'aborted', error: SUBAGENT_ABORTED_ERROR, errorCode: 'aborted', durationMs: Math.max(ZERO, Date.now() - plan.startedAt) };
    }
    lastOutcome = await runOneAttempt(options, callbacks, plan, attempt);
    if (lastOutcome.status !== 'error' || plan.abortController.signal.aborted) {
      return lastOutcome;
    }
    if (NON_RETRYABLE_FAILURES.has(lastOutcome.errorCode)) {
      return lastOutcome;
    }
  }
  return lastOutcome;
}

function attachBackgroundCompletionHandler(agentId: string, startedAt: number, runPromise: Promise<SubagentRunOutcome>, callbacks: RunnerCallbacks): Promise<SubagentRunOutcome> {
  return runPromise.then((outcome) => {
    callbacks.store.clearActiveRun(agentId);
    const finalized = finalizeSubagentSession(callbacks.store, agentId, outcome, startedAt);
    if (finalized) {
      callbacks.emit('runEnd', finalized);
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
  const backgroundPromise = new Promise<'backgrounded'>((resolveBackground) => {
    triggerBackground = () => resolveBackground('backgrounded');
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
    callbacks.store.updateSession(agentId, (record) => ({ ...record, isBackground: true, backgroundReason: 'user_request', currentStep: 'Running in background', updatedAt: Date.now() }));
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
  callbacks.emit('runEnd', finalized);
  callbacks.onStateChanged();
  return buildDetailsFromRecord(finalized);
}

interface InitialRecordRequest {
  readonly options: RunTaskOptions;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly existing: SubagentSessionRecord | undefined;
  readonly resolvedModel: string | undefined;
  readonly thinking: SubagentThinkingLevel | undefined;
  readonly readonly: boolean;
  readonly wantBackground: boolean;
  readonly backgroundReason: BackgroundReason;
  readonly startedAt: number;
  readonly maxAttempts: number;
}

function buildInitialSessionRecord(request: InitialRecordRequest): SubagentSessionRecord {
  const prompt = request.options.input.prompt.trim();
  const description = request.options.input.description.trim() || request.existing?.description || DEFAULT_TASK_DESCRIPTION;
  const ownerAgentId = request.options.scope?.ownerAgentId ?? request.existing?.ownerAgentId;
  return {
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    ...(ownerAgentId !== undefined ? { ownerAgentId } : {}),
    toolCallId: request.options.toolCallId,
    subagentType: request.options.definition.name,
    description,
    prompt,
    ...(request.resolvedModel !== undefined ? { model: request.resolvedModel } : {}),
    ...(request.thinking !== undefined ? { thinking: request.thinking } : {}),
    readonly: request.readonly,
    status: 'running',
    isBackground: request.wantBackground,
    backgroundReason: request.backgroundReason,
    attempts: ONE,
    maxAttempts: request.maxAttempts,
    currentStep: request.wantBackground ? 'Running in background' : 'Starting…',
    toolCallCount: request.existing?.toolCallCount ?? ZERO,
    startedAt: request.startedAt,
    updatedAt: request.startedAt,
    checkpoints: request.existing?.checkpoints ?? [],
    ...(request.existing?.worktree !== undefined ? { worktree: request.existing.worktree } : {}),
    ...(request.existing?.worktreeSummary !== undefined ? { worktreeSummary: request.existing.worktreeSummary } : {}),
    ...(request.existing?.transcriptPath !== undefined ? { transcriptPath: request.existing.transcriptPath } : {}),
    transcriptItems: [...(request.existing?.transcriptItems ?? []), { id: randomUUID(), role: 'user', text: prompt, completed: true, timestamp: request.startedAt }],
  };
}

async function prepareWorktree(options: RunTaskOptions, callbacks: RunnerCallbacks, agentId: string, config: SubagentsConfig, description: string): Promise<SubagentWorktree> {
  const created = await createSubagentWorktree({
    cwd: options.ctx.cwd,
    description,
    agentId,
    sessionDir: options.ctx.sessionManager.getSessionDir(),
    root: config.worktrees.root,
    branchPrefix: config.worktrees.branchPrefix,
  });
  if (!created.ok) {
    const failed = callbacks.store.markFailure(agentId, 'worktree-failed', created.error);
    if (failed) {
      callbacks.emit('runEnd', failed);
    }
    callbacks.onStateChanged();
    throw new SubagentRunError('worktree-failed', failed?.failureId === undefined ? created.error : `${created.error} (failure_id: ${failed.failureId})`);
  }
  const updated = callbacks.store.updateSession(agentId, (record) => ({ ...record, worktree: created.worktree, updatedAt: Date.now() }));
  if (updated) {
    callbacks.emit('worktree', updated);
  }
  callbacks.onStateChanged();
  return created.worktree;
}

async function attachWorktreeSummary(agentId: string, callbacks: RunnerCallbacks): Promise<void> {
  const record = callbacks.store.getSession(agentId);
  if (record?.worktree === undefined) {
    return;
  }
  const summary = await summarizeWorktreeDiff(record.worktree);
  callbacks.store.updateSession(agentId, (current) => ({ ...current, worktreeSummary: summary, updatedAt: Date.now() }));
}

interface RunSetup {
  readonly parentSessionId: string;
  readonly prompt: string;
  readonly existing: SubagentSessionRecord | undefined;
  readonly isReadonly: boolean;
  readonly wantBackground: boolean;
  readonly detach: boolean;
  readonly backgroundReason: BackgroundReason;
  readonly maxAttempts: number;
  readonly model: Model<Api> | undefined;
  readonly thinking: SubagentThinkingLevel | undefined;
}

function resolveRunSetup(options: RunTaskOptions, callbacks: RunnerCallbacks, config: SubagentsConfig, parentSessionId: string, prompt: string, resumeId: string | undefined): RunSetup {
  const existing = resumeId === undefined ? undefined : validateResumeRequest(resumeId, prompt, parentSessionId, callbacks.store, options.retry === true);
  const resolved = resolveSubagentModel({ model: options.input.model ?? existing?.model, thinking: options.input.thinking ?? existing?.thinking }, options.definition, options.ctx);
  const explicitBackground = options.input.run_in_background ?? options.definition.isBackground;
  const wantBackground = explicitBackground ?? existing?.isBackground ?? config.defaultBackground;
  const backgroundReason: BackgroundReason = wantBackground && explicitBackground !== undefined ? 'agent_request' : 'unspecified';
  return {
    parentSessionId,
    prompt,
    existing,
    isReadonly: options.definition.permissionMode === 'readonly' || (options.input.readonly ?? existing?.readonly ?? false),
    wantBackground,
    detach: wantBackground,
    backgroundReason,
    maxAttempts: Math.min(MAX_RETRY_ATTEMPTS_CAP, Math.max(ONE, options.input.max_attempts ?? options.definition.retryAttempts ?? config.retry.maxAttempts)),
    model: resolved.model === undefined ? undefined : applyDefinitionToModel(resolved.model, options.definition),
    thinking: resolved.thinking,
  };
}

function buildNestedScope(options: RunTaskOptions, callbacks: RunnerCallbacks, config: SubagentsConfig, setup: RunSetup, agentId: string): NestedScope | undefined {
  const childDepth = resolveChildDepth(setup.existing, options.scope, callbacks.store);
  const ownedAgentIds = setup.existing
    ? callbacks.store
        .listSessions()
        .filter((session) => session.ownerAgentId === agentId)
        .map((session) => session.agentId)
    : [];
  if (setup.isReadonly || !options.definition.nestedTasks || childDepth >= config.maxNestingDepth) {
    return undefined;
  }
  return { depth: childDepth, maxDepth: config.maxNestingDepth, ownerAgentId: agentId, rootSessionId: setup.parentSessionId, agentIds: new Set(ownedAgentIds) };
}

function startBackgroundRun(
  options: RunTaskOptions,
  callbacks: RunnerCallbacks,
  agentId: string,
  initialRecord: SubagentSessionRecord,
  startedAt: number,
  runPromise: Promise<SubagentRunOutcome>,
  abortController: AbortController,
): TaskToolDetails {
  const settledPromise = attachBackgroundCompletionHandler(agentId, startedAt, runPromise, callbacks);
  callbacks.store.registerActiveRun({ agentId, toolCallId: options.toolCallId, isBackground: true, abort: () => abortController.abort(), completionPromise: settledPromise });
  callbacks.onStateChanged();
  return buildDetailsFromRecord(callbacks.store.getSession(agentId) ?? initialRecord);
}

async function launchRun(options: RunTaskOptions, callbacks: RunnerCallbacks, config: SubagentsConfig, setup: RunSetup, agentId: string, startedAt: number): Promise<TaskToolDetails> {
  const nestedScope = buildNestedScope(options, callbacks, config, setup, agentId);
  const childDepth = resolveChildDepth(setup.existing, options.scope, callbacks.store);
  const initialRecord = buildInitialSessionRecord({
    options,
    agentId,
    parentSessionId: setup.parentSessionId,
    existing: setup.existing,
    resolvedModel: describeModel(setup.model),
    thinking: setup.thinking,
    readonly: setup.isReadonly,
    wantBackground: setup.wantBackground,
    backgroundReason: setup.backgroundReason,
    startedAt,
    maxAttempts: setup.maxAttempts,
  });
  callbacks.store.upsertSession(initialRecord);
  options.scope?.agentIds.add(agentId);
  callbacks.emit('runStart', initialRecord);
  callbacks.onStateChanged();

  const abortController = new AbortController();
  if (!setup.detach && options.signal?.aborted) {
    abortController.abort();
  }
  const requestedWorktree = options.input.worktree ?? options.definition.worktree;
  const worktree = setup.existing?.worktree ?? (requestedWorktree && !abortController.signal.aborted ? await prepareWorktree(options, callbacks, agentId, config, initialRecord.description) : undefined);
  const childCwd = worktree === undefined ? options.ctx.cwd : resolveWorktreeChildCwd(worktree, options.ctx.cwd);
  const plan: AttemptPlan = {
    agentId,
    prompt: setup.prompt,
    parentSessionId: setup.parentSessionId,
    startedAt,
    existing: setup.existing,
    isResume: setup.existing !== undefined,
    childDepth,
    ownedAgentIds: [...(nestedScope?.agentIds ?? [])],
    nestedScope,
    abortController,
    childCwd,
    maxAttempts: setup.maxAttempts,
    retryDelayMs: config.retry.delayMs,
    model: setup.model,
    thinking: setup.thinking,
    readonly: setup.isReadonly,
  };
  const runPromise = runAttempts(options, callbacks, plan).then(async (outcome) => {
    await attachWorktreeSummary(agentId, callbacks);
    return outcome;
  });
  options.onUpdate?.(buildDetailsFromRecord(initialRecord));

  if (!setup.detach) {
    return runForegroundSubagent(options, initialRecord, runPromise, abortController, callbacks);
  }
  return startBackgroundRun(options, callbacks, agentId, initialRecord, startedAt, runPromise, abortController);
}

export async function runSubagentTask(options: RunTaskOptions, callbacks: RunnerCallbacks): Promise<TaskToolDetails> {
  const config = callbacks.getConfig(options.ctx);
  if (config.maxNestingDepth < ONE) {
    throw new SubagentRunError('nesting-limit');
  }
  const parentSessionId = options.scope?.rootSessionId ?? options.ctx.sessionManager.getSessionId();
  const prompt = options.input.prompt.trim();
  const resumeId = options.input.resume?.trim();
  const resumed = resumeId === undefined ? undefined : validateResumeRequest(resumeId, prompt, parentSessionId, callbacks.store, options.retry === true);
  const provisionalReadonly = options.definition.permissionMode === 'readonly' || (options.input.readonly ?? resumed?.readonly ?? false);

  if (resumeId && prompt.length === ZERO && provisionalReadonly && options.input.run_in_background !== true) {
    const awaited = await awaitBackgroundSubagent(resumeId, callbacks.store, undefined, options.signal);
    if (awaited.outcome === 'complete' && awaited.record) {
      return buildDetailsFromRecord(awaited.record);
    }
    if (awaited.errorCode === 'aborted') {
      throw new SubagentRunError('aborted');
    }
    throw new SubagentRunError('await-timeout', resumeId);
  }
  if (prompt.length === ZERO) {
    throw new SubagentRunError('empty-prompt');
  }

  const setup = resolveRunSetup(options, callbacks, config, parentSessionId, prompt, resumeId);
  const agentId = setup.existing ? setup.existing.agentId : randomUUID();
  return launchRun(options, callbacks, config, setup, agentId, Date.now());
}
