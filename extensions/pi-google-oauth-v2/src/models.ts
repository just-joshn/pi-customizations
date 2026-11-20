import type { Model, ModelThinkingLevel, RefreshModelsContext, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { parseStoredCredential } from './auth.ts';
import { fetchAvailableModels } from './code-assist.ts';
import { API_ID, CODE_ASSIST_BASE_URL, PROVIDER_ID } from './constants.ts';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];
const isEffort = (value: string | undefined): value is Effort => EFFORTS.some((effort) => effort === value);
const EFFORT_SUFFIX = new RegExp(`-(${EFFORTS.join('|')})$`);
const EFFORT_LABEL = / \((Low|Medium|High|XHigh|Max)\)$/;
// Pi offers a level unless its map entry is null, and Google has no wire id for these.
const LEVELS_WITHOUT_WIRE_ID: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];

const CATALOG_MODEL = z.object({
  displayName: z.string().optional(),
  supportsImages: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  maxTokens: z.number().optional(),
  maxOutputTokens: z.number().optional(),
});

const CATALOG = z.object({
  models: z.record(z.string(), CATALOG_MODEL).optional(),
  agentModelSorts: z.array(z.object({ groups: z.array(z.object({ modelIds: z.array(z.string()).optional() })).optional() })).optional(),
});

type CatalogModel = z.infer<typeof CATALOG_MODEL>;

/** The slice of Code Assist's `fetchAvailableModels` response that the extension reads. */
export type Catalog = z.infer<typeof CATALOG>;

interface Variant {
  wireId: string;
  effort: Effort;
  info: CatalogModel;
}

type CodeAssistModel = Model<typeof API_ID>;

function splitWireId(wireId: string): { base: string; effort: Effort } {
  const match = EFFORT_SUFFIX.exec(wireId);
  const effort = match?.[1];
  if (!match || !isEffort(effort)) return { base: wireId, effort: 'medium' };
  return { base: wireId.slice(0, match.index), effort };
}

function thinkingLevelMap(variants: Variant[], reasoning: boolean): ThinkingLevelMap {
  if (!reasoning) return { off: (variants.find((variant) => variant.effort === 'medium') ?? variants[0])?.wireId ?? null };
  const unmapped = Object.fromEntries(LEVELS_WITHOUT_WIRE_ID.map((level) => [level, null]));
  const mapped = Object.fromEntries(variants.map((variant) => [variant.effort, variant.wireId]));
  const map: ThinkingLevelMap = { ...unmapped, ...mapped };
  return map;
}

/** One Pi model per base family. Its thinking levels map to Google's per-effort wire ids. */
function catalogModels(catalog: Catalog): CodeAssistModel[] {
  const shown = new Set((catalog.agentModelSorts ?? []).flatMap((sort) => (sort.groups ?? []).flatMap((group) => group.modelIds ?? [])));
  const entries = [...shown].flatMap((wireId): { base: string; variant: Variant }[] => {
    const info = catalog.models?.[wireId];
    if (!info || wireId.endsWith('-disabled')) return [];
    const { base, effort } = splitWireId(wireId);
    return [{ base, variant: { wireId, effort, info } }];
  });
  const families = [...new Set(entries.map((entry) => entry.base))].map((id) => ({ id, variants: entries.filter((entry) => entry.base === id).map((entry) => entry.variant) }));

  return families.map(({ id, variants }) => {
    const reasoning = variants.some((variant) => variant.info.supportsThinking);
    const first = variants[0]?.info;
    return {
      id,
      name: (first?.displayName ?? id).replace(EFFORT_LABEL, ''),
      api: API_ID,
      provider: PROVIDER_ID,
      baseUrl: CODE_ASSIST_BASE_URL,
      reasoning,
      input: variants.some((variant) => variant.info.supportsImages) ? ['text', 'image'] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: Math.max(...variants.map((variant) => variant.info.maxTokens ?? 0)),
      maxTokens: Math.max(...variants.map((variant) => variant.info.maxOutputTokens ?? 0)),
      thinkingLevelMap: thinkingLevelMap(variants, reasoning),
    };
  });
}

const BASELINE_CONTEXT_WINDOW = 1_048_576;
const BASELINE_MAX_OUTPUT_TOKENS = 65_536;
const BASELINE_FAMILIES = [
  ['gemini-4-argon', 'Gemini 4 Argon'],
  ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
] as const;
const BASELINE_EFFORTS = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
] as const;
const baselineWireIds = BASELINE_FAMILIES.flatMap(([id]) => BASELINE_EFFORTS.map(([effort]) => `${id}-${effort}`));

export const BASELINE_MODELS: CodeAssistModel[] = catalogModels({
  models: Object.fromEntries(
    BASELINE_FAMILIES.flatMap(([id, name]) =>
      BASELINE_EFFORTS.map(([effort, label]) => [`${id}-${effort}`, { displayName: `${name} (${label})`, supportsImages: true, supportsThinking: true, maxTokens: BASELINE_CONTEXT_WINDOW, maxOutputTokens: BASELINE_MAX_OUTPUT_TOKENS }]),
    ),
  ),
  agentModelSorts: [{ groups: [{ modelIds: baselineWireIds }] }],
});

export function createFetchModels(fetchImpl: typeof fetch = globalThis.fetch): (context: RefreshModelsContext) => Promise<CodeAssistModel[]> {
  return async (context) => {
    if (!context.allowNetwork || context.credential?.type !== 'oauth') return BASELINE_MODELS;
    const { access, projectId } = parseStoredCredential(context.credential);
    const catalog = CATALOG.parse(await fetchAvailableModels({ accessToken: access, project: projectId, signal: context.signal, fetchImpl }));
    const models = catalogModels(catalog);
    if (models.length === 0) throw new Error('Google returned no models for this account');
    return models;
  };
}
