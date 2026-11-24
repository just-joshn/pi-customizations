/**
 * Pi models for one Antigravity CLI catalog.
 *
 * A subscription turn has no per-token price Pi can bill, so every cost field is zero.
 * The CLI lists effort inside the model id (`gemini-3.8-flash-high`) and also accepts
 * the bare id plus `thought_level`. Pi shows one model per base id.
 */
import type { Model, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { API_ID, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, PROCESS_BASE_URL, PROVIDER_ID, SMALL_CONTEXT_WINDOW } from './constants.ts';
import { EFFORTS, type CatalogEntry, type Discovery, type Effort } from './types.ts';

/** What to ask the CLI for when Pi selects this model at this thinking level. */
export interface Selection {
  modelId: string;
  thoughtLevel?: Effort;
}

/** `off` and `minimal` have no CLI effort. Every other Pi level uses the same token. */
const THINKING_LEVEL_EFFORT: ReadonlyMap<string, Effort | null> = new Map([
  ['off', null],
  ['minimal', null],
  ['low', 'low'],
  ['medium', 'medium'],
  ['high', 'high'],
  ['xhigh', 'xhigh'],
  ['max', 'max'],
]);

const SUBSCRIPTION_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Families whose `usage_update.size` is well below the Gemini window. */
const SMALL_CONTEXT_FAMILIES = ['claude', 'gpt-oss'] as const;

const LEVELS_ALWAYS_MAPPED = ['low', 'medium', 'high'] as const satisfies readonly Effort[];
const LEVELS_WHEN_OFFERED = ['xhigh', 'max'] as const satisfies readonly Effort[];

/**
 * Six ids `agy models` printed on 1.5.15, already collapsed.
 * Efforts match the fake server and a live `session/new`: Claude entries advertise no `thought_level`.
 * The Opus display name follows the Sonnet fixture; the id itself is the one the CLI printed.
 */
const BASELINE_ENTRIES: readonly CatalogEntry[] = [
  {
    baseId: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    efforts: ['low', 'medium', 'high'],
    variants: ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low'],
  },
  {
    baseId: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Thinking)',
    efforts: [],
    variants: ['claude-sonnet-4-6'],
  },
  {
    baseId: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 (Thinking)',
    efforts: [],
    variants: ['claude-opus-4-6-thinking'],
  },
  {
    baseId: 'gpt-oss-120b',
    name: 'GPT-OSS 120B',
    efforts: ['medium'],
    variants: ['gpt-oss-120b-medium'],
  },
];

const BASELINE_DISCOVERY: Discovery = { version: '1.5.15', tierName: undefined, models: BASELINE_ENTRIES };

/** Models to show before any discovery has run, so Pi can start offline. */
export const BASELINE_MODELS: readonly Model<typeof API_ID>[] = catalogToModels(BASELINE_DISCOVERY);

/** Pi models for one discovery result. */
export function catalogToModels(discovery: Discovery): readonly Model<typeof API_ID>[] {
  return discovery.models.map(toModel);
}

/**
 * The CLI rejects `--effort` when the id already ends in an effort
 * (`--model %s conflicts with --effort=%s`), so a suffixed id is sent alone.
 */
export function resolveSelection(modelId: string, thinkingLevel: string | undefined): Selection {
  if (baseModelId(modelId) !== modelId) return { modelId };
  const mapped = thinkingLevel === undefined ? undefined : THINKING_LEVEL_EFFORT.get(thinkingLevel);
  if (mapped === undefined || mapped === null) return { modelId };
  return { modelId, thoughtLevel: mapped };
}

/**
 * Strip a trailing `-{effort}` only when the token is a known effort and the base stays non-empty.
 * The final segment is the whole token, so `flash-xhigh` is `xhigh`, not `high`.
 */
export function baseModelId(modelId: string): string {
  const dash = modelId.lastIndexOf('-');
  if (dash <= 0) return modelId;
  const token = modelId.slice(dash + 1);
  if (!isEffort(token)) return modelId;
  return modelId.slice(0, dash);
}

function toModel(entry: CatalogEntry): Model<typeof API_ID> {
  const reasoning = entry.efforts.length > 0;
  return {
    id: entry.baseId,
    name: `${entry.name} (Antigravity)`,
    api: API_ID,
    provider: PROVIDER_ID,
    baseUrl: PROCESS_BASE_URL,
    // `initialize` advertises `promptCapabilities.image` for the CLI, not per model.
    input: ['text', 'image'],
    cost: { ...SUBSCRIPTION_COST },
    reasoning,
    // `usage_update.size` reported 1048576 for `gemini-3.8-flash`. Claude and gpt-oss are smaller.
    contextWindow: contextWindow(entry.baseId),
    maxTokens: DEFAULT_MAX_TOKENS,
    ...(reasoning ? { thinkingLevelMap: thinkingLevelMap(entry.efforts) } : {}),
  };
}

function contextWindow(baseId: string): number {
  const small = SMALL_CONTEXT_FAMILIES.some((family) => baseId.includes(family));
  return small ? SMALL_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW;
}

function thinkingLevelMap(efforts: readonly Effort[]): ThinkingLevelMap {
  const offered = new Set<Effort>(efforts);
  return {
    off: null,
    minimal: null,
    low: valueOrNull(LEVELS_ALWAYS_MAPPED[0], offered),
    medium: valueOrNull(LEVELS_ALWAYS_MAPPED[1], offered),
    high: valueOrNull(LEVELS_ALWAYS_MAPPED[2], offered),
    ...optionalLevels(offered),
  };
}

function valueOrNull(level: Effort | undefined, offered: ReadonlySet<Effort>): Effort | null {
  if (level === undefined || !offered.has(level)) return null;
  return level;
}

function optionalLevels(offered: ReadonlySet<Effort>): Pick<ThinkingLevelMap, 'xhigh' | 'max'> {
  const offeredLevels = new Set(LEVELS_WHEN_OFFERED.filter((level) => offered.has(level)));
  return {
    ...(offeredLevels.has('xhigh') ? { xhigh: 'xhigh' } : {}),
    ...(offeredLevels.has('max') ? { max: 'max' } : {}),
  };
}

function isEffort(value: string): value is Effort {
  return EFFORTS.some((effort) => effort === value);
}
