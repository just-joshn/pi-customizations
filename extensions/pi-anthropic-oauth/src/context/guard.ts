import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSettledEvent, CompactOptions, ExtensionAPI, SessionProjection } from '@earendil-works/pi-coding-agent';
import { fitPayload, isSummarizationRequest } from './fit.ts';
import { type BytesPerToken, bytesPerToken, type CountedBlock, contextBudget, countBlocks, estimateMessages, payloadModelId, payloadTokens } from './tokens.ts';

export const GUARD_ENTRY_TYPE = 'claude-context-guard';

const SEED_BIAS = 1.2;
const MIN_BIAS = 1;
const MAX_BIAS = 2;
const TRIMMED_NOTICE = 'Claude context guard: trimmed the outgoing request to fit the model limit. The session history is unchanged.';
const BENIGN_COMPACTION_FAILURES: readonly string[] = ['Nothing to compact (session too small)', 'Already compacted'];

export interface GuardContext {
  readonly model: Model<Api> | undefined;
  readonly hasUI: boolean;
  readonly ui: { notify(message: string, type?: 'info' | 'warning' | 'error'): void };
  isIdle(): boolean;
  getSystemPrompt(): string;
  readonly sessionManager: { buildSessionProjection(): SessionProjection };
  compact(options?: CompactOptions): void;
}

export type ContextGuardHost = Pick<ExtensionAPI, 'on' | 'getAllTools' | 'getActiveTools' | 'getSettings'>;

export interface GuardOptions {
  readonly providerId: string;
  readonly notify?: (message: string) => void;
}

export interface ContextGuard {
  fit(payload: unknown, model: Model<Api>): unknown;
  observe(payload: unknown, usageTokens: number): void;
}

function report(options: GuardOptions, message: string): void {
  try {
    options.notify?.(message);
  } catch {
    return;
  }
}

function toolBlocks(pi: ContextGuardHost): readonly CountedBlock[] {
  const active = new Set(pi.getActiveTools());
  return pi
    .getAllTools()
    .filter((tool) => active.has(tool.name))
    .map((tool) => ({ kind: 'json', json: `${tool.name}${tool.description}${JSON.stringify(tool.parameters) ?? ''}` }));
}

function projectedParity(pi: ContextGuardHost, ctx: GuardContext, bpt: BytesPerToken): number {
  const projection = ctx.sessionManager.buildSessionProjection();
  return estimateMessages(projection.messages, bpt) + Math.round(Buffer.byteLength(ctx.getSystemPrompt(), 'utf8') / bpt) + countBlocks(toolBlocks(pi), bpt);
}

function compactionDecision({ pi, ctx, model, bias }: { pi: ContextGuardHost; ctx: GuardContext; model: Model<Api>; bias: number }): { readonly shouldCompact: boolean; readonly estimate: number; readonly compactAt: number } {
  const budget = contextBudget(model);
  const estimate = Math.ceil(projectedParity(pi, ctx, budget.bytesPerToken) * bias);
  return { shouldCompact: estimate >= budget.compactAt, estimate, compactAt: budget.compactAt };
}

function compactOnce(ctx: GuardContext, onFailure: (error: Error) => void): Promise<void> {
  return new Promise((resolve) => {
    // No wall-clock timeout: a timeout does not release Pi's compaction
    // controller. Await settlement so the next run starts on the new projection.
    // The callbacks never touch ctx; a reload may have replaced it.
    ctx.compact({
      onComplete: () => resolve(),
      onError: (error) => {
        onFailure(error);
        resolve();
      },
    });
  });
}

function isBenignCompactionFailure(message: string): boolean {
  return BENIGN_COMPACTION_FAILURES.some((benign) => message.includes(benign));
}

export function calibratedBias(payload: unknown, usageTokens: number, fallback: BytesPerToken | undefined): number | undefined {
  if (!Number.isFinite(usageTokens) || usageTokens <= 0) return undefined;
  if (isSummarizationRequest(payload)) return undefined;
  const modelId = payloadModelId(payload);
  const bpt = modelId === undefined ? fallback : bytesPerToken(modelId);
  if (bpt === undefined) return undefined;
  const tokens = payloadTokens(payload, bpt);
  if (tokens <= 0) return undefined;
  return Math.min(MAX_BIAS, Math.max(MIN_BIAS, usageTokens / tokens));
}

function createSettledCompaction(pi: ContextGuardHost, options: GuardOptions, biasOf: () => number): { readonly handler: (event: AgentSettledEvent, ctx: GuardContext) => Promise<void>; readonly reset: () => void } {
  let inFlight = false;
  let failureReported = false;
  const reportFailure = (error: Error): void => {
    if (isBenignCompactionFailure(error.message)) return;
    if (failureReported) return;
    failureReported = true;
    report(options, `Claude context guard: compaction failed: ${error.message}`);
  };
  const handler = async (event: AgentSettledEvent, ctx: GuardContext): Promise<void> => {
    if (inFlight || event.aborted) return;
    try {
      const model = ctx.model;
      if (!model || model.provider !== options.providerId) return;
      if (pi.getSettings().compaction?.enabled === false) return;
      if (!ctx.isIdle()) return;
      const decision = compactionDecision({ pi, ctx, model, bias: biasOf() });
      if (!decision.shouldCompact) return;
      inFlight = true;
      const message = `Claude context guard: compacting before the next request (about ${decision.estimate} tokens against a ${decision.compactAt} threshold).`;
      report(options, message);
      if (ctx.hasUI) ctx.ui.notify(message, 'info');
      await compactOnce(ctx, reportFailure);
    } catch {
      return;
    } finally {
      inFlight = false;
    }
  };
  return {
    handler,
    reset: () => {
      inFlight = false;
      failureReported = false;
    },
  };
}

export function installContextGuard(pi: ContextGuardHost, options: GuardOptions): ContextGuard {
  let bias = SEED_BIAS;
  let lastBytesPerToken: BytesPerToken | undefined;
  let cutReported = false;
  const compaction = createSettledCompaction(pi, options, () => bias);

  const reset = (): void => {
    compaction.reset();
    bias = SEED_BIAS;
    lastBytesPerToken = undefined;
    cutReported = false;
  };

  const fit = (payload: unknown, model: Model<Api>): unknown => {
    try {
      const budget = contextBudget(model);
      lastBytesPerToken = budget.bytesPerToken;
      const fitted = fitPayload(payload, budget, (candidate) => Math.ceil(payloadTokens(candidate, budget.bytesPerToken) * bias));
      if (fitted !== payload && !cutReported) {
        cutReported = true;
        report(options, TRIMMED_NOTICE);
      }
      return fitted;
    } catch (error) {
      report(options, `Claude context guard: request fit failed, sending the request unfitted: ${error instanceof Error ? error.message : String(error)}`);
      return payload;
    }
  };

  const observe = (payload: unknown, usageTokens: number): void => {
    const next = calibratedBias(payload, usageTokens, lastBytesPerToken);
    if (next !== undefined) bias = next;
  };

  pi.on('session_start', reset);
  pi.on('session_shutdown', reset);
  pi.on('agent_settled', compaction.handler);
  return { fit, observe };
}
