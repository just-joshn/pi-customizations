import type { ModelParameterValue, ModelSelection, SDKModel } from '@cursor/sdk';
import type { ThinkingLevel, ThinkingLevelMap } from '@earendil-works/pi-ai';
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';

type PiLevel = keyof ThinkingLevelMap;

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
const MAX_OUTPUT_TOKENS = 64_000;
const CONTEXT_UNITS: Record<string, number> = { k: 1_000, m: 1_000_000 };

const effortParam = (model: SDKModel) => model.parameters?.find((p) => EFFORT_PARAMS.has(p.id));
const thinkingParam = (model: SDKModel) => model.parameters?.find((p) => p.id === THINKING_PARAM);
const defaultParams = (model: SDKModel): ModelParameterValue[] => model.variants?.find((v) => v.isDefault)?.params ?? [];

/** The catalog value that selects a Pi level on this model, or undefined when the model lacks it. */
function effortValueFor(model: SDKModel, level: PiLevel): string | undefined {
  const values = effortParam(model)?.values.map((v) => v.value) ?? [];
  return EFFORT_VALUES[level].find((v) => values.includes(v));
}

/** Whether Pi's "off" can be honored: an effort of "none", or thinking=false. */
const canTurnOff = (model: SDKModel) => effortValueFor(model, 'off') !== undefined || thinkingParam(model)?.values.some((v) => v.value === 'false') === true;

export function thinkingLevelMap(model: SDKModel): ThinkingLevelMap | undefined {
  if (!effortParam(model)) return thinkingParam(model) ? { minimal: null, low: null, medium: null, off: canTurnOff(model) ? 'false' : null } : undefined;
  const entries = PI_LEVELS.map((level) => [level, level === 'off' ? (canTurnOff(model) ? 'off' : null) : (effortValueFor(model, level) ?? null)]);
  return Object.fromEntries(entries) as ThinkingLevelMap;
}

function contextWindow(model: SDKModel): number {
  const value = defaultParams(model).find((p) => p.id === CONTEXT_PARAM)?.value ?? '';
  const [, amount, unit] = /^(\d+(?:\.\d+)?)([km])$/i.exec(value) ?? [];
  const scale = unit ? CONTEXT_UNITS[unit.toLowerCase()] : undefined;
  return amount && scale ? Math.round(Number(amount) * scale) : DEFAULT_CONTEXT_WINDOW;
}

export function toPiModel(model: SDKModel): ProviderModelConfig {
  const levels = thinkingLevelMap(model);
  return {
    id: model.id,
    name: model.displayName,
    reasoning: levels !== undefined,
    ...(levels ? { thinkingLevelMap: levels } : {}),
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow(model),
    maxTokens: MAX_OUTPUT_TOKENS,
  };
}

const withParam = (params: ModelParameterValue[], id: string, value: string) => [...params.filter((p) => p.id !== id), { id, value }];

/**
 * The model selection for one run. Starts from the catalog's default variant, so every parameter is explicit,
 * then applies Pi's thinking level. `level` undefined means thinking is off.
 */
export function selectModel(model: SDKModel | undefined, modelId: string, level: ThinkingLevel | undefined): ModelSelection {
  if (!model) return { id: modelId };
  const base = defaultParams(model);
  const effort = effortParam(model);
  const thinking = thinkingParam(model);
  const wanted: PiLevel = level ?? 'off';
  const effortValue = effort ? effortValueFor(model, wanted) : undefined;
  let params = effort && effortValue ? withParam(base, effort.id, effortValue) : base;
  if (thinking && wanted === 'off' && !effortValue) params = withParam(params, thinking.id, 'false');
  else if (thinking && wanted !== 'off') params = withParam(params, thinking.id, 'true');
  return params.length > 0 ? { id: model.id, params } : { id: model.id };
}
