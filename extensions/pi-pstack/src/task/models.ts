export type Effort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AvailableModel {
  provider: string;
  id: string;
  reasoning: boolean;
  /** Thinking levels Pi supports for the model (pi-ai `getSupportedThinkingLevels`). */
  levels: readonly string[];
}

/** A concrete child model. `thinking` absent means the child's own default for that model. */
export interface ModelSpec {
  provider: string;
  id: string;
  thinking?: Effort;
}

// Cursor reads `inherit` as an omitted model. auto, default, and inherit-parent name Cursor's own default model or a
// pstack rule value, so they run on the parent here.
const OMITTED = new Set(['inherit', 'inherit-parent', 'auto', 'default']);
const EFFORTS = new Set<string>(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const DASH_SLUG = /^(.+?)(?:-thinking)?(?:-(none|minimal|low|medium|high|xhigh|max))?(-fast)?$/;

const asEffort = (value: string): Effort | undefined => (EFFORTS.has(value) ? (value as Effort) : undefined);

/** A model as the allowed list names it, with its thinking levels when it has more than off. */
export function modelLabel(model: AvailableModel): string {
  const levels = model.levels.filter((level) => level !== 'off').length > 0 ? ` (thinking: ${model.levels.join(', ')})` : '';
  return `${model.provider}/${model.id}${levels}`;
}

function invalid(value: string, available: readonly AvailableModel[], reason = 'Model could not be resolved to a valid subagent model.'): Error {
  return new Error(
    [
      `Invalid model selection "${value}". ${reason}`,
      'Allowed model slugs:',
      '- inherit',
      ...available.map((model) => `- ${modelLabel(model)}`),
      '',
      'Add a thinking level as <model>:<level>, for example claude-opus-5-5:xhigh, or as <model>[effort=<level>].',
      'The `model` parameter is optional. If omitted, the subagent uses the same model as the parent agent.',
    ].join('\n'),
  );
}

type Candidates = (reference: string) => AvailableModel[];

function candidatesIn(available: readonly AvailableModel[], parentProvider: string | undefined): Candidates {
  return (reference) => {
    const slash = reference.indexOf('/');
    if (slash !== -1) return available.filter((model) => model.provider === reference.slice(0, slash) && model.id === reference.slice(slash + 1));
    const matches = available.filter((model) => model.id === reference);
    const parents = matches.filter((model) => model.provider === parentProvider);
    return parents.length > 0 ? parents : matches;
  };
}

function only(reference: string, candidates: Candidates): AvailableModel | undefined {
  const matches = candidates(reference);
  return matches.length > 1 ? failAmbiguous(reference, matches) : matches[0];
}

function failAmbiguous(reference: string, matches: readonly AvailableModel[]): never {
  throw new Error(`Model "${reference}" matches more than one provider: ${matches.map((model) => `${model.provider}/${model.id}`).join(', ')}. Use <provider>/<model-id>.`);
}

/** Only listed levels are accepted, so a level the model does not support is refused instead of clamped by Pi. */
class UnsupportedLevel extends Error {}

function withThinking(model: AvailableModel, thinking: Effort | undefined): ModelSpec {
  if (thinking === undefined) return { provider: model.provider, id: model.id };
  if (!model.levels.includes(thinking)) throw new UnsupportedLevel(`${model.provider}/${model.id} does not support thinking level ${thinking}; it supports ${model.levels.join(', ')}.`);
  return { provider: model.provider, id: model.id, thinking };
}

/** A whole reference first, since model ids such as llama3:8b contain a colon; then a trailing :<effort>. */
function resolvePiSpec(value: string, candidates: Candidates): ModelSpec | undefined {
  const whole = only(value, candidates);
  if (whole !== undefined) return withThinking(whole, undefined);
  const colon = value.lastIndexOf(':');
  const level = colon === -1 ? undefined : asEffort(value.slice(colon + 1));
  if (level === undefined) return undefined;
  const model = only(value.slice(0, colon), candidates);
  return model === undefined ? undefined : withThinking(model, level);
}

/** Legacy `<id>[-<effort>][-fast]` slugs: a Pi model whose own id ends in -fast wins, else the base id; the effort is the thinking level, and `none` is Pi's `off`. */
function resolveDashSlug(value: string, candidates: Candidates): ModelSpec | undefined {
  const match = DASH_SLUG.exec(value);
  const base = match?.[1];
  const effort = match?.[2] === undefined ? undefined : asEffort(match[2] === 'none' ? 'off' : match[2]);
  const fast = match?.[3] !== undefined;
  if (base === undefined || (effort === undefined && !fast)) return undefined;
  const model = fast ? fastOrStandard(base, candidates) : only(base, candidates);
  return model === undefined ? undefined : withThinking(model, effort);
}

function fastOrStandard(base: string, candidates: Candidates): AvailableModel | undefined {
  const standards = candidates(base);
  if (standards.length === 0) return only(`${base}-fast`, candidates);
  const fasts = standards.flatMap((model) => candidates(`${model.provider}/${model.id}-fast`));
  if (fasts.length === 1) return fasts[0];
  if (standards.length === 1) return standards[0];
  return failAmbiguous(base, standards);
}

interface ModelParameters {
  effort?: Effort;
  fast?: boolean;
}

const BRACKETED = /^(.+)\[([^\]]*)\]$/;

/** `id=value` pairs. Pi sets a context window per model, not per call, so `context` is accepted and has no effect. */
function parseModelParameters(text: string): ModelParameters | undefined {
  let parsed: ModelParameters = {};
  for (const pair of text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')) {
    const [key, value, ...rest] = pair.split('=').map((part) => part.trim());
    if (value === undefined || value === '' || rest.length > 0) return undefined;
    const effort = asEffort(value === 'none' ? 'off' : value);
    if ((key === 'effort' || key === 'reasoning' || key === 'reasoning_effort') && effort !== undefined) parsed = { ...parsed, effort };
    else if (key === 'fast' && (value === 'true' || value === 'false')) parsed = { ...parsed, fast: value === 'true' };
    else if (key === 'speed' && (value === 'fast' || value === 'default')) parsed = { ...parsed, fast: value === 'fast' };
    else if (key !== 'context') return undefined;
  }
  return parsed;
}

/** `<model>[effort=high,fast=false,context=300k]`, per-model parameters; `[]` is the standard variant. */
function resolveBracketed(value: string, candidates: Candidates): ModelSpec | undefined {
  const match = BRACKETED.exec(value);
  const base = match?.[1];
  const parameters = parseModelParameters(match?.[2] ?? '');
  if (base === undefined || parameters === undefined) return undefined;
  const model = parameters.fast === true ? fastOrStandard(base, candidates) : only(base, candidates);
  return model === undefined ? undefined : withThinking(model, parameters.effort);
}

/** The parent model's -fast variant when Pi lists one, keeping the parent's thinking level where it applies; else the parent. */
export function fastVariant(available: readonly AvailableModel[], parent: ModelSpec | undefined): ModelSpec | undefined {
  if (parent === undefined) return undefined;
  const candidate = available.find((model) => model.provider === parent.provider && model.id === `${parent.id}-fast`);
  if (candidate === undefined) return parent;
  return { provider: candidate.provider, id: candidate.id, ...(parent.thinking === undefined || !candidate.levels.includes(parent.thinking) ? {} : { thinking: parent.thinking }) };
}

/**
 * Resolves Task's `model`. An omitted value, an alias, or an ignored `fast` runs on `fallback`, the parent model or the
 * type's default. A listed model runs as asked, and anything else fails with the allowed list. Legacy slugs
 * `<id>-<effort>[-fast]` still map to a Pi model plus thinking level.
 */
export function resolveSubagentModel(value: string | undefined, available: readonly AvailableModel[], fallback: ModelSpec | undefined, parent: ModelSpec | undefined = fallback): ModelSpec | undefined {
  if (value === undefined) return fallback;
  const requested = value.trim();
  if (requested === '') throw invalid(value, available, 'Model must be a non-empty string when provided.');
  if (OMITTED.has(requested.toLowerCase())) return fallback;
  try {
    const candidates = candidatesIn(available, parent?.provider);
    const resolved = resolveBracketed(requested, candidates) ?? resolvePiSpec(requested, candidates) ?? resolveDashSlug(requested, candidates);
    if (resolved !== undefined) return resolved;
    // Cursor ignores a `fast` alias it cannot resolve, as if the call named no model.
    if (requested.toLowerCase() === 'fast') return fallback;
    throw invalid(requested, available);
  } catch (error) {
    if (error instanceof UnsupportedLevel) throw invalid(requested, available, error.message);
    throw error;
  }
}
