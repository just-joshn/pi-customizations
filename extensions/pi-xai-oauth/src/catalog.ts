import type { Api, Model, ModelCost, ModelCostRates, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { Check } from 'typebox/value';

export const PROVIDER_ID = 'grok-build';
export const PROXY_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
export const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
export type Effort = (typeof EFFORTS)[number];

const FAST_SUFFIX = '-build-fast';

// The proxy meters 0.34 times the API list price of the physical model, and the
// fast variant at twice that. Measured against cost_in_usd_ticks on 2026-10-02.
const METER_RATIO = 34 / 100;
const FAST_RATIO = 2;

/** One model Grok Build serves. A row with no effort Pi can send is not representable. */
export type GrokModel = {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly efforts: readonly [Effort, ...Effort[]];
};

/** GET /v1/models on 2026-10-02. */
export const BASELINE: readonly GrokModel[] = [
  { id: 'grok-4.7', name: 'Grok 4.7', contextWindow: 256000, efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'grok-4.7-build-fast', name: 'Grok 4.7 Fast', contextWindow: 256000, efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 256000, efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'grok-4.5', name: 'Grok 4.5', contextWindow: 256000, efforts: ['low', 'medium', 'high'] },
];

export type CatalogParse = { readonly kind: 'ok'; readonly models: readonly GrokModel[] } | { readonly kind: 'unreadable' };

/** Pi's built-in xai list prices keyed by API model id (grok-4.7, not grok-4.7-build-fast). */
export type ListPrices = ReadonlyMap<string, ModelCost>;

export type EffortAlias = {
  readonly id: string;
  readonly name: string;
  readonly target: string;
  readonly effort: Effort;
  readonly contextWindow: number;
};

const Envelope = Type.Object({ data: Type.Array(Type.Unknown()) });

const Row = Type.Object({
  id: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }),
  name: Type.String({ minLength: 1 }),
  context_window: Type.Integer({ minimum: 1 }),
  api_backend: Type.Optional(Type.String()),
  reasoning_efforts: Type.Array(Type.Object({ value: Type.String() })),
});

function hasEffort(efforts: readonly Effort[]): efforts is [Effort, ...Effort[]] {
  return efforts.length > 0;
}

function toGrokModel(row: unknown): GrokModel | undefined {
  if (!Check(Row, row)) return undefined;
  if (row.api_backend !== undefined && row.api_backend !== 'responses') return undefined;
  const offered = new Set(row.reasoning_efforts.map((entry) => entry.value));
  const efforts = EFFORTS.filter((effort) => offered.has(effort));
  if (!hasEffort(efforts)) return undefined;
  return { id: row.id, name: row.name, contextWindow: row.context_window, efforts };
}

export function parseCatalog(body: unknown): CatalogParse {
  if (!Check(Envelope, body)) return { kind: 'unreadable' };
  return { kind: 'ok', models: body.data.flatMap((row) => toGrokModel(row) ?? []) };
}

export function listPrices(models: readonly Model<Api>[]): ListPrices {
  return new Map(models.map((model) => [model.id, model.cost]));
}

function scaled(rates: ModelCostRates, ratio: number): ModelCostRates {
  return { input: rates.input * ratio, output: rates.output * ratio, cacheRead: rates.cacheRead * ratio, cacheWrite: rates.cacheWrite * ratio };
}

export function meteredCost(id: string, prices: ListPrices): ModelCost {
  const fast = id.endsWith(FAST_SUFFIX);
  const list = prices.get(fast ? id.slice(0, -FAST_SUFFIX.length) : id);
  if (!list) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const ratio = fast ? METER_RATIO * FAST_RATIO : METER_RATIO;
  const rates = scaled(list, ratio);
  if (!list.tiers) return rates;
  return { ...rates, tiers: list.tiers.map((tier) => ({ ...scaled(tier, ratio), inputTokensAbove: tier.inputTokensAbove })) };
}

export function toPiModel(model: GrokModel, prices: ListPrices): Model<'openai-responses'> {
  const offers = (effort: Effort) => (model.efforts.includes(effort) ? effort : null);
  const thinkingLevelMap: ThinkingLevelMap = {
    off: null,
    minimal: null,
    low: offers('low'),
    medium: offers('medium'),
    high: offers('high'),
    xhigh: offers('xhigh'),
    max: null,
  };
  return {
    id: model.id,
    name: model.name,
    api: 'openai-responses',
    provider: PROVIDER_ID,
    baseUrl: PROXY_BASE_URL,
    reasoning: true,
    input: ['text', 'image'],
    cost: meteredCost(model.id, prices),
    contextWindow: model.contextWindow,
    maxTokens: model.contextWindow,
    thinkingLevelMap,
    compat: { supportsLongCacheRetention: false },
  };
}

export function effortAliases(models: readonly GrokModel[]): readonly EffortAlias[] {
  return models
    .filter((model) => model.id.endsWith(FAST_SUFFIX))
    .flatMap((model) =>
      EFFORTS.map((effort) => ({
        id: `${model.id.slice(0, -FAST_SUFFIX.length)}-${effort}-fast`,
        name: `${model.name} (${effort})`,
        target: model.id,
        effort,
        contextWindow: model.contextWindow,
      })),
    );
}

export function catalogFailure(status: number): Error {
  if (status === 401 || status === 403) return new Error(`Grok Build rejected the session (HTTP ${status}). Run /login and choose Grok Build.`);
  return new Error(`Grok Build model list failed (HTTP ${status}).`);
}
