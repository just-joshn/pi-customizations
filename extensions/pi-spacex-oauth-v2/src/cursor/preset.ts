import type { ModelParameterValue, ModelVariant, SDKModel } from '@cursor/sdk';

/**
 * A pinned preset id is `<sdk id>@<param id>=<value>+...`, with parameters sorted by id.
 * Bytes outside [A-Za-z0-9._-] are percent-encoded, so `/model` and `--model` can pass the id unchanged.
 * The id is the variant. It does not use the variant's position or display name.
 */
const RAW_TOKEN_CHARACTER = /[!'()*~]/g;
const INVISIBLE = /\u200b|\u200c|\u200d|\ufeff/g;
const HEX_RADIX = 16;
const LABEL_ORDER = ['context', 'thinking', 'effort', 'reasoning', 'reasoning_effort', 'fast'];

interface PinnedId {
  sdkId: string;
  params: ModelParameterValue[];
}

export type ParsedPickerId = { kind: 'base' } | { kind: 'malformed' } | ({ kind: 'pinned' } & PinnedId);

export interface CatalogPreset {
  id: string;
  params: ModelParameterValue[];
}

const byParamId = (a: ModelParameterValue, b: ModelParameterValue): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const sortParams = (params: readonly ModelParameterValue[]): ModelParameterValue[] => [...params].sort(byParamId);

/** Sorted copy, or undefined when the set cannot be a preset identity. */
function canonicalParams(params: readonly ModelParameterValue[]): ModelParameterValue[] | undefined {
  if (params.length === 0 || params.some((param) => param.id.length === 0 || param.value.length === 0)) return undefined;
  const sorted = sortParams(params);
  return new Set(sorted.map((param) => param.id)).size === sorted.length ? sorted : undefined;
}

function encodeToken(text: string): string {
  return encodeURIComponent(text).replace(RAW_TOKEN_CHARACTER, (char) => `%${char.charCodeAt(0).toString(HEX_RADIX).toUpperCase()}`);
}

function decodeToken(text: string): string | undefined {
  try {
    const decoded = decodeURIComponent(text);
    return decoded && encodeToken(decoded) === text ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function parseParam(part: string): ModelParameterValue | undefined {
  const eq = part.indexOf('=');
  if (eq <= 0) return undefined;
  const id = decodeToken(part.slice(0, eq));
  const value = decodeToken(part.slice(eq + 1));
  return id && value ? { id, value } : undefined;
}

function pickerId(sdkId: string, params: readonly ModelParameterValue[]): string {
  const body = sortParams(params)
    .map((param) => `${encodeToken(param.id)}=${encodeToken(param.value)}`)
    .join('+');
  return `${encodeToken(sdkId)}@${body}`;
}

/** Base ids have no `@`. Anything with `@` is a preset or malformed. */
export function parsePickerId(modelId: string): ParsedPickerId {
  const at = modelId.indexOf('@');
  if (at === -1) return { kind: 'base' };
  const sdkId = decodeToken(modelId.slice(0, at));
  const rest = modelId.slice(at + 1);
  if (!sdkId || rest.length === 0) return { kind: 'malformed' };
  const parts = rest.split('+').map(parseParam);
  const params = parts.every((param) => param !== undefined) ? canonicalParams(parts) : undefined;
  return params ? { kind: 'pinned', sdkId, params } : { kind: 'malformed' };
}

function sameParams(left: readonly ModelParameterValue[], right: readonly ModelParameterValue[]): boolean {
  const a = canonicalParams(left);
  const b = canonicalParams(right);
  return a !== undefined && b !== undefined && a.length === b.length && a.every((param, i) => param.id === b[i]?.id && param.value === b[i]?.value);
}

/** One preset per distinct parameter set. Parameter order in the catalog does not change the id. */
export function catalogPresets(model: SDKModel): CatalogPreset[] {
  const entries = (model.variants ?? []).flatMap(({ params }) => {
    const canonical = canonicalParams(params);
    return canonical ? [[pickerId(model.id, canonical), canonical] as const] : [];
  });
  return [...new Map(entries)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, params]) => ({ id, params }));
}

const clean = (text: string | undefined): string | undefined => {
  const cleaned = text?.replace(INVISIBLE, '').trim();
  return cleaned ? cleaned : undefined;
};

function valueLabel(model: SDKModel, param: ModelParameterValue): string | undefined {
  const definition = model.parameters?.find((parameter) => parameter.id === param.id);
  const display = clean(definition?.values.find((value) => value.value === param.value)?.displayName);
  if (display) return display;
  if (param.value === 'true') return clean(definition?.displayName) ?? param.id;
  if (param.value === 'false') return undefined;
  return param.value;
}

const labelRank = (id: string): number => {
  const index = LABEL_ORDER.indexOf(id);
  return index === -1 ? LABEL_ORDER.length : index;
};

function friendlyName(model: SDKModel, params: readonly ModelParameterValue[]): string {
  const labels = [...params]
    .sort((a, b) => labelRank(a.id) - labelRank(b.id) || byParamId(a, b))
    .flatMap((param) => {
      const label = valueLabel(model, param);
      return label ? [label] : [];
    });
  return labels.length > 0 ? `${model.displayName} ${labels.join(' ')}` : model.displayName;
}

/** Names that stay distinct from the base model and from other presets of the same model. */
export function presetNames(model: SDKModel, presets: readonly CatalogPreset[]): string[] {
  const peers = presets.map((preset) => friendlyName(model, preset.params));
  const sorted = peers.toSorted();
  const duplicates = new Set(sorted.filter((name, index) => name === sorted[index - 1]));
  return peers.map((friendly, index) => {
    if (friendly !== model.displayName && !duplicates.has(friendly)) return friendly;
    const phrase = presets[index]?.params.map((param) => `${param.id}=${param.value}`).join(' ');
    return `${friendly} ${phrase ?? ''}`.trim();
  });
}

export function presetMatches(variants: readonly ModelVariant[] | undefined, params: readonly ModelParameterValue[]): ModelVariant[] {
  return (variants ?? []).filter((variant) => sameParams(variant.params, params));
}
