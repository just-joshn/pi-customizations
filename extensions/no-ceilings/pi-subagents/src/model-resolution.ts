import type { Api, Model } from '@earendil-works/pi-ai';
import { SubagentRunError } from './failures.ts';
import { type SubagentDefinition, type SubagentSampling, type SubagentThinkingLevel, ZERO } from './types.ts';

const FAST_MODEL_HINTS = ['haiku', 'flash', 'mini', 'nano', 'fast', 'lite'] as const;
const SLASH_CHAR = '/';
const PROVIDER_SEPARATOR_CHARS = 1;
const INHERIT_TOKENS = new Set(['inherit', 'auto', 'inherit-parent']);
const FAST_TOKENS = new Set(['fast', 'default']);

export interface ModelIdentity {
  readonly id: string;
  readonly provider: string;
}

export interface ModelResolutionContext<M extends ModelIdentity> {
  readonly model: M | undefined;
  readonly modelRegistry: {
    getAvailable(): readonly M[];
    getAll(): readonly M[];
    find(provider: string, id: string): M | undefined;
  };
}

export interface ResolvedSubagentModel<M extends ModelIdentity> {
  /** The child model, with the definition's per-model parameters applied. */
  readonly model: M | undefined;
  readonly thinking: SubagentThinkingLevel | undefined;
}

function isInheritToken(value: string): boolean {
  return value.length === ZERO || INHERIT_TOKENS.has(value);
}

function findFastModel<M extends ModelIdentity>(available: readonly M[], fallback: M | undefined): M | undefined {
  return available.find((candidate) => FAST_MODEL_HINTS.some((hint) => candidate.id.toLowerCase().includes(hint))) ?? fallback;
}

function sameModel<M extends ModelIdentity>(candidate: M, provider: string, id: string): boolean {
  return candidate.provider === provider && candidate.id === id;
}

function findModelByRequest<M extends ModelIdentity>(effective: string, ctx: ModelResolutionContext<M>): M | undefined {
  const slashIndex = effective.indexOf(SLASH_CHAR);
  if (slashIndex > ZERO) {
    const provider = effective.slice(ZERO, slashIndex);
    const id = effective.slice(slashIndex + PROVIDER_SEPARATOR_CHARS);
    const exact = ctx.modelRegistry.find(provider, id);
    if (exact) {
      return exact;
    }
    const listed = ctx.modelRegistry.getAvailable().find((candidate) => sameModel(candidate, provider, id)) ?? ctx.modelRegistry.getAll().find((candidate) => sameModel(candidate, provider, id));
    if (listed) {
      return listed;
    }
  }
  return ctx.modelRegistry.getAvailable().find((candidate) => candidate.id === effective) ?? ctx.modelRegistry.getAll().find((candidate) => candidate.id === effective);
}

/**
 * Resolves the model for one run. An explicit request from the caller must resolve or the run
 * fails with a clear error. A definition default that does not resolve inherits the parent model,
 * so one stale agent file cannot break every delegation.
 */
export function resolveModelForSubagent<M extends ModelIdentity>(requestedModel: string | undefined, definition: SubagentDefinition, ctx: ModelResolutionContext<M>): M | undefined {
  const requested = (requestedModel ?? '').trim();
  const effective = requested.length > ZERO ? requested : definition.model.trim();
  if (definition.forceDefaultModel || isInheritToken(effective)) {
    return ctx.model;
  }
  if (FAST_TOKENS.has(effective)) {
    return findFastModel(ctx.modelRegistry.getAvailable(), ctx.model);
  }
  const found = findModelByRequest(effective, ctx);
  if (found) {
    return found;
  }
  if (requested.length > ZERO) {
    throw new SubagentRunError('model-unknown', `"${effective}". Pass a registered model id from pi --list-models, or "inherit".`);
  }
  return ctx.model;
}

export function resolveSubagentModel<M extends ModelIdentity>(
  request: { readonly model: string | undefined; readonly thinking: SubagentThinkingLevel | undefined },
  definition: SubagentDefinition,
  ctx: ModelResolutionContext<M>,
): ResolvedSubagentModel<M> {
  return {
    model: resolveModelForSubagent(request.model, definition, ctx),
    thinking: request.thinking ?? definition.thinking,
  };
}

function mergeSampling(base: Record<string, unknown> | undefined, extra: SubagentSampling): Record<string, unknown> {
  return {
    ...(base ?? {}),
    ...(extra.temperature !== undefined ? { temperature: extra.temperature } : {}),
    ...(extra.topP !== undefined ? { top_p: extra.topP } : {}),
    ...(extra.topK !== undefined ? { top_k: extra.topK } : {}),
  };
}

/**
 * Copies the definition's per-model parameters onto a child model. The parent's model object stays
 * untouched, so a subagent cannot change how the parent session samples.
 */
export function applyDefinitionToModel(model: Model<Api>, definition: SubagentDefinition): Model<Api> {
  const samplingParams = definition.sampling ? mergeSampling(model.samplingParams, definition.sampling) : undefined;
  return {
    ...model,
    ...(definition.contextWindow !== undefined ? { contextWindow: definition.contextWindow } : {}),
    ...(definition.sampling?.maxTokens !== undefined ? { maxTokens: definition.sampling.maxTokens } : {}),
    ...(samplingParams !== undefined && Object.keys(samplingParams).length > ZERO ? { samplingParams } : {}),
  };
}

export function describeModel(model: ModelIdentity | undefined): string | undefined {
  return model === undefined ? undefined : `${model.provider}/${model.id}`;
}
