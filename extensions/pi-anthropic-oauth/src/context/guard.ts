// The context guard: Claude-accurate compaction timing at the only run
// boundary where Pi's compaction is safe, plus a report hook for the wire fit.
import type { Api, ImageContent, Model } from '@earendil-works/pi-ai';
import type { CompactOptions, ExtensionAPI, SessionProjection } from '@earendil-works/pi-coding-agent';
import { fitPayload, isSummarizationRequest } from './fit.ts';
import { type BytesPerToken, bytesPerToken, type CountedBlock, contextBudget, countBlocks, estimateMessages, IMAGE_TOKENS, payloadModelId, payloadTokens } from './tokens.ts';

export const GUARD_ENTRY_TYPE = 'claude-context-guard';

const SEED_BIAS = 1.2;
const MIN_BIAS = 1;
const MAX_BIAS = 2;
const TRIMMED_NOTICE = 'Claude context guard: trimmed the outgoing request to fit the model limit. The session history is unchanged.';
// Pi reports these for a normal small or already-compacted session. They are
// informational, not a compaction failure worth warning about.
const BENIGN_COMPACTION_FAILURES: readonly string[] = ['Nothing to compact (session too small)', 'Already compacted'];

export interface GuardEvent {
  readonly prompt: string;
  readonly images?: readonly ImageContent[];
  readonly systemPrompt: string;
}

/**
 * The subset of Pi's extension context the guard reads. Narrowing it keeps the
 * factory and its unit tests total without casting a host object.
 */
export interface GuardContext {
  readonly model: Model<Api> | undefined;
  readonly hasUI: boolean;
  readonly ui: { notify(message: string, type?: 'info' | 'warning' | 'error'): void };
  isIdle(): boolean;
  readonly sessionManager: { buildSessionProjection(): SessionProjection };
  compact(options?: CompactOptions): void;
}

/** The extension API methods the guard needs, straight from Pi's own type. */
export type ContextGuardHost = Pick<ExtensionAPI, 'registerProvider' | 'on' | 'getAllTools' | 'getActiveTools' | 'getSettings'>;

export interface GuardOptions {
  readonly providerId: string;
  readonly notify?: (message: string) => void;
}

export interface ContextGuard {
  /** Called from the provider's onPayload; returns the payload to send. */
  fit(payload: unknown, model: Model<Api>): unknown;
  /** Called after a successful response with the payload that produced it. */
  observe(payload: unknown, usageTokens: number): void;
}

function report(options: GuardOptions, message: string): void {
  try {
    options.notify?.(message);
  } catch {
    // Durable reporting must never break a request path.
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

/** Claude Code's accounting over Pi's projection plus the pending prompt. */
function projectedParity(pi: ContextGuardHost, ctx: GuardContext, event: GuardEvent, bpt: BytesPerToken): number {
  const projection = ctx.sessionManager.buildSessionProjection();
  return (
    estimateMessages(projection.messages, bpt) +
    Math.round(Buffer.byteLength(event.systemPrompt, 'utf8') / bpt) +
    countBlocks(toolBlocks(pi), bpt) +
    Math.round(Buffer.byteLength(event.prompt, 'utf8') / bpt) +
    (event.images?.length ?? 0) * IMAGE_TOKENS
  );
}

function compactionDecision(pi: ContextGuardHost, ctx: GuardContext, event: GuardEvent, model: Model<Api>, bias: number): { readonly shouldCompact: boolean; readonly estimate: number; readonly compactAt: number } {
  const budget = contextBudget(model);
  const estimate = Math.ceil(projectedParity(pi, ctx, event, budget.bytesPerToken) * bias);
  return { shouldCompact: estimate >= budget.compactAt, estimate, compactAt: budget.compactAt };
}

function compactOnce(ctx: GuardContext, onFailure: (error: Error) => void): Promise<void> {
  return new Promise((resolve) => {
    // No wall-clock timeout: a timeout does not release Pi's compaction
    // controller. Await settlement so the run starts on the new projection.
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

/**
 * The bias one observation produces: the measured payload-to-usage ratio
 * clamped to [1, 2]. Each successful response resets the bias to this value,
 * so the 1.2 seed applies only until the session's first measurement. Returns
 * undefined when the observation is not usable.
 */
export function calibratedBias(payload: unknown, usageTokens: number, fallback: BytesPerToken | undefined): number | undefined {
  if (!Number.isFinite(usageTokens) || usageTokens <= 0) return undefined;
  // A compaction's prose density must not re-tune the conversation's bias.
  if (isSummarizationRequest(payload)) return undefined;
  const modelId = payloadModelId(payload);
  const bpt = modelId === undefined ? fallback : bytesPerToken(modelId);
  if (bpt === undefined) return undefined;
  const tokens = payloadTokens(payload, bpt);
  if (tokens <= 0) return undefined;
  return Math.min(MAX_BIAS, Math.max(MIN_BIAS, tokens / usageTokens));
}

function createBeforeAgentStart(pi: ContextGuardHost, options: GuardOptions, biasOf: () => number): { readonly handler: (event: GuardEvent, ctx: GuardContext) => Promise<void>; readonly reset: () => void } {
  let inFlight = false;
  let failureReported = false;
  const reportFailure = (error: Error): void => {
    if (isBenignCompactionFailure(error.message)) return;
    if (failureReported) return;
    failureReported = true;
    report(options, `Claude context guard: compaction failed: ${error.message}`);
  };
  const handler = async (event: GuardEvent, ctx: GuardContext): Promise<void> => {
    if (inFlight) return;
    try {
      const model = ctx.model;
      if (!model || model.provider !== options.providerId) return;
      if (pi.getSettings().compaction?.enabled === false) return;
      if (!ctx.isIdle()) return;
      const decision = compactionDecision(pi, ctx, event, model, biasOf());
      if (!decision.shouldCompact) return;
      inFlight = true;
      const message = `Claude context guard: compacting before this request (about ${decision.estimate} tokens against a ${decision.compactAt} threshold).`;
      report(options, message);
      if (ctx.hasUI) ctx.ui.notify(message, 'info');
      await compactOnce(ctx, reportFailure);
    } catch {
      // Pi's event dispatch must never see a rejected handler from the guard.
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
  const compaction = createBeforeAgentStart(pi, options, () => bias);

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
    } catch {
      return payload;
    }
  };

  const observe = (payload: unknown, usageTokens: number): void => {
    try {
      const next = calibratedBias(payload, usageTokens, lastBytesPerToken);
      if (next !== undefined) bias = next;
    } catch {
      // Observation must never break a run.
      return;
    }
  };

  pi.on('session_start', reset);
  pi.on('session_shutdown', reset);
  pi.on('before_agent_start', compaction.handler);
  return { fit, observe };
}
