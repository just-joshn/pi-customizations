import type { ModelParameterValue, ModelSelection, SDKModel } from '@cursor/sdk';
import type { ThinkingLevel, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { type ChatModelConfig, chatModel } from '../stored-models.ts';
import { catalogPresets, parsePickerId, presetMatches, presetNames } from './preset.ts';

type PiLevel = keyof ThinkingLevelMap;
type ModelParameter = NonNullable<SDKModel['parameters']>[number];

/** The parameter values that select one Pi level on one model. */
type Plan = ModelParameterValue[];
type Plans = Partial<Record<PiLevel, Plan | null>>;

// Catalog parameter ids that carry reasoning effort. Models name it differently.
const EFFORT_PARAMS = new Set(['effort', 'reasoning_effort', 'reasoning']);
const THINKING_PARAM = 'thinking';
const CONTEXT_PARAM = 'context';
const PI_LEVELS: PiLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

// Catalog effort values per Pi thinking level.
const EFFORT_VALUES: Record<PiLevel, readonly string[]> = {
  off: ['none'],
  minimal: ['minimal'],
  low: ['low'],
  medium: ['medium'],
  high: ['high'],
  xhigh: ['xhigh', 'extra-high'],
  max: ['max'],
};

const DEFAULT_CONTEXT_WINDOW = 200_000;
const TOKENS_PER_THOUSAND = 1_000;
const TOKENS_PER_MILLION = 1_000_000;
const CONTEXT_UNITS: Record<string, number> = { k: TOKENS_PER_THOUSAND, m: TOKENS_PER_MILLION };

const effortParam = (model: SDKModel) => model.parameters?.find((p) => EFFORT_PARAMS.has(p.id));
const thinkingParam = (model: SDKModel) => model.parameters?.find((p) => p.id === THINKING_PARAM);
const defaultParams = (model: SDKModel): ModelParameterValue[] => model.variants?.find((v) => v.isDefault)?.params ?? [];

const setting = (id: string, value: string): ModelParameterValue => ({ id, value });

/** The catalog value that selects a Pi level on this effort parameter, or undefined when it lacks it. */
const effortValueFor = (effort: ModelParameter, level: PiLevel): string | undefined => EFFORT_VALUES[level].find((v) => effort.values.some((offered) => offered.value === v));

/**
 * What each Pi level means on this model, or undefined when the model has no reasoning controls. A level the
 * model cannot honor is null. This one table feeds both the levels Pi offers and the selection Cursor receives.
 */
function levelPlans(model: SDKModel): Plans | undefined {
  const effort = effortParam(model);
  const thinking = thinkingParam(model);
  if (!effort && !thinking) return undefined;
  const thinkingOn = thinking ? [setting(thinking.id, 'true')] : [];
  const thinkingOff = thinking?.values.some((v) => v.value === 'false') ? [setting(thinking.id, 'false')] : null;
  const planFor = (level: PiLevel): Plan | null => {
    const effortValue = effort && effortValueFor(effort, level);
    if (level === 'off') return effort && effortValue ? [setting(effort.id, effortValue)] : thinkingOff;
    if (effort) return effortValue ? [setting(effort.id, effortValue), ...thinkingOn] : null;
    return level === 'high' ? thinkingOn : null;
  };
  return PI_LEVELS.reduce<Plans>((plans, level) => ({ ...plans, [level]: planFor(level) }), {});
}

const planValue = (plan: Plan | null | undefined): string | null => plan?.at(0)?.value ?? null;

function thinkingLevelMap(plans: Plans | undefined): ThinkingLevelMap | undefined {
  return plans && PI_LEVELS.reduce<ThinkingLevelMap>((map, level) => ({ ...map, [level]: planValue(plans[level]) }), {});
}

function tokensOf(value: string): number | undefined {
  const [, amount, unit] = /^(\d+(?:\.\d+)?)([km])$/i.exec(value) ?? [];
  const scale = unit ? CONTEXT_UNITS[unit.toLowerCase()] : undefined;
  return amount && scale ? Math.round(Number(amount) * scale) : undefined;
}

function contextWindow(model: SDKModel): number {
  const value = defaultParams(model).find((p) => p.id === CONTEXT_PARAM)?.value ?? '';
  return tokensOf(value) ?? DEFAULT_CONTEXT_WINDOW;
}

function variantContext(model: SDKModel, params: readonly ModelParameterValue[]): number {
  const value = params.find((param) => param.id === CONTEXT_PARAM)?.value;
  return (value ? tokensOf(value) : undefined) ?? contextWindow(model);
}

const toPiModel = (model: SDKModel): ChatModelConfig => chatModel({ id: model.id, name: model.displayName, contextWindow: contextWindow(model), levels: thinkingLevelMap(levelPlans(model)) });

/** The base model, then one pinned preset per distinct advertised parameter set. */
export function toPiModels(model: SDKModel): ChatModelConfig[] {
  const presets = catalogPresets(model);
  const names = presetNames(model, presets);
  const pinned = presets.map((preset, index) => chatModel({ id: preset.id, name: names[index] ?? model.displayName, contextWindow: variantContext(model, preset.params), levels: undefined }));
  return [toPiModel(model), ...pinned];
}

const withParam = (params: ModelParameterValue[], change: ModelParameterValue) => [...params.filter((p) => p.id !== change.id), change];

/** What a catalog lookup produced. `unavailable` means the list could not be read, so a preset id stands on its own. */
export type CatalogLookup = { status: 'ready'; model: SDKModel | undefined } | { status: 'unavailable' };

const adjustableSelection = (model: SDKModel | undefined, modelId: string, level: ThinkingLevel | undefined): ModelSelection => {
  if (!model) return { id: modelId };
  const plan = levelPlans(model)?.[level ?? 'off'] ?? [];
  const params = plan.reduce(withParam, defaultParams(model));
  return params.length > 0 ? { id: model.id, params } : { id: model.id };
};

function presetSelection(lookup: CatalogLookup, modelId: string, sdkId: string, params: ModelParameterValue[]): ModelSelection {
  if (lookup.status === 'unavailable') return { id: sdkId, params };
  const model = lookup.model;
  const matches = model ? presetMatches(model.variants, params) : [];
  if (!model || matches.length === 0) throw new Error(`Unknown Cursor model preset: ${modelId}`);
  return { id: model.id, params, ...(matches.every((variant) => variant.isMaxMode === true) ? { maxMode: true } : {}) };
}

/**
 * The model selection for one run. A base id starts from the default variant and applies Pi's thinking level.
 * `level` undefined means thinking is off. A preset id sends that variant's parameters and ignores the thinking level.
 */
export async function selectModel(modelId: string, level: ThinkingLevel | undefined, lookupModel: (sdkId: string) => Promise<CatalogLookup>): Promise<ModelSelection> {
  const parsed = parsePickerId(modelId);
  if (parsed.kind === 'malformed') throw new Error(`Malformed Cursor model id: ${modelId}`);
  const lookup = await lookupModel(parsed.kind === 'pinned' ? parsed.sdkId : modelId);
  if (parsed.kind === 'pinned') return presetSelection(lookup, modelId, parsed.sdkId, parsed.params);
  return adjustableSelection(lookup.status === 'ready' ? lookup.model : undefined, modelId, level);
}
