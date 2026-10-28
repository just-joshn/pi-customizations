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

const INHERIT = new Set(['', 'inherit', 'inherit-parent', 'auto', 'default']);
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

type Find = (reference: string) => AvailableModel | undefined;

/** A bare id that several providers offer means the parent chat's provider when it is one of them. */
function findModel(reference: string, available: readonly AvailableModel[], parentProvider: string | undefined): AvailableModel | undefined {
  const slash = reference.indexOf('/');
  if (slash !== -1) return available.find((model) => model.provider === reference.slice(0, slash) && model.id === reference.slice(slash + 1));
  const matches = available.filter((model) => model.id === reference);
  if (matches.length > 1) return matches.find((model) => model.provider === parentProvider) ?? failAmbiguous(reference, matches);
  return matches[0];
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
function resolvePiSpec(value: string, find: Find): ModelSpec | undefined {
  const whole = find(value);
  if (whole !== undefined) return withThinking(whole, undefined);
  const colon = value.lastIndexOf(':');
  const level = colon === -1 ? undefined : asEffort(value.slice(colon + 1));
  if (level === undefined) return undefined;
  const model = find(value.slice(0, colon));
  return model === undefined ? undefined : withThinking(model, level);
}

/** Legacy `<id>[-<effort>][-fast]` slugs: a Pi model whose own id ends in -fast wins, else the base id; the effort is the thinking level, and `none` is Pi's `off`. */
function resolveDashSlug(value: string, find: Find): ModelSpec | undefined {
  const match = DASH_SLUG.exec(value);
  const base = match?.[1];
  const effort = match?.[2] === undefined ? undefined : asEffort(match[2] === 'none' ? 'off' : match[2]);
  const fast = match?.[3] !== undefined;
  if (base === undefined || (effort === undefined && !fast)) return undefined;
  const model = (fast ? find(`${base}-fast`) : undefined) ?? find(base);
  return model === undefined ? undefined : withThinking(model, effort);
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
    const effort = asEffort(value);
    if (key === 'effort' && effort !== undefined) parsed = { ...parsed, effort };
    else if (key === 'fast' && (value === 'true' || value === 'false')) parsed = { ...parsed, fast: value === 'true' };
    else if (key !== 'context') return undefined;
  }
  return parsed;
}

/** `<model>[effort=high,fast=false,context=300k]`, per-model parameters; `[]` is the standard variant. */
function resolveBracketed(value: string, find: Find): ModelSpec | undefined {
  const match = BRACKETED.exec(value);
  const base = match?.[1];
  const parameters = parseModelParameters(match?.[2] ?? '');
  if (base === undefined || parameters === undefined) return undefined;
  const model = (parameters.fast === true ? find(`${base}-fast`) : undefined) ?? find(base);
  return model === undefined ? undefined : withThinking(model, parameters.effort);
}

/**
 * Resolves Task's `model`: aliases run on the parent, a listed model runs as asked, and anything else fails with the
 * allowed list. Legacy slugs `<id>-<effort>[-fast]` still map to a Pi model plus thinking level.
 */
export function resolveSubagentModel(value: string | undefined, available: readonly AvailableModel[], parent: ModelSpec | undefined): ModelSpec | undefined {
  const requested = (value ?? '').trim();
  if (INHERIT.has(requested)) return parent;
  try {
    const find: Find = (reference) => findModel(reference, available, parent?.provider);
    const resolved = resolveBracketed(requested, find) ?? resolvePiSpec(requested, find) ?? resolveDashSlug(requested, find);
    if (resolved === undefined) throw invalid(requested, available);
    return resolved;
  } catch (error) {
    if (error instanceof UnsupportedLevel) throw invalid(requested, available, error.message);
    throw error;
  }
}
