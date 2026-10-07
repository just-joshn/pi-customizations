import type { Api, Model, ModelThinkingLevel, RefreshModelsContext, ThinkingLevelMap } from '@earendil-works/pi-ai';
import snapshot from './catalog-snapshot.ts';
import { PROVIDER_ID, postCloudCode } from './cloudcode.ts';
import { parseCredential } from './oauth.ts';

export const API: Api = 'cloud-code-assist';

const CLAUDE_LEVELS = { 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH' } as const;

type Effort = 'low' | 'medium' | 'high' | 'max';

/** One Cloud Code model id and the fixed thinking settings the Antigravity CLI sends with it. */
export interface Variant {
  model: string;
  thinkingBudget?: number;
  thinkingLevel?: (typeof CLAUDE_LEVELS)[keyof typeof CLAUDE_LEVELS];
}

interface CatalogEntry {
  displayName?: string;
  supportsImages?: boolean;
  supportsThinking?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: number;
  maxTokens?: number;
  maxOutputTokens?: number;
}

interface Catalog {
  models?: Record<string, CatalogEntry>;
  agentModelSorts?: { groups?: { modelIds?: string[] }[] }[];
  deprecatedModelIds?: Record<string, { newModelId?: string }>;
}

const UNSUPPORTED: Record<ModelThinkingLevel, null> = { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null };

const EFFORT_SUFFIX = /^(.+)-(low|medium|high|max)$/;
const EFFORT_LABEL = / \((?:Low|Medium|High|Max)\)$/;

function variantOf(id: string, entry: CatalogEntry): Variant {
  if (!entry.supportsThinking) return { model: id };
  const level = CLAUDE_LEVELS[entry.thinkingLevel as keyof typeof CLAUDE_LEVELS];
  return { model: id, thinkingBudget: entry.thinkingBudget ?? 0, ...(level && { thinkingLevel: level }) };
}

/** Reads the Cloud Code variant that Pi's thinking level selected for a model. */
export function parseVariant(value: string | null | undefined): Variant | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as Partial<Variant>;
  return typeof parsed.model === 'string' ? (parsed as Variant) : undefined;
}

// The CLI lists agent models as one id per effort (`claude-sonnet-5-5-low`) and asks for
// `--model claude-sonnet-5-5 --effort low`. Pi models the same split with thinking levels.
export function catalogModels(data: unknown, baseUrl: string): Model<Api>[] {
  const catalog = (data ?? {}) as Catalog;
  const entries = catalog.models ?? {};
  const shownId = new Map(Object.entries(catalog.deprecatedModelIds ?? {}).map(([old, { newModelId }]) => [newModelId, old]));
  const agentIds = [...new Set((catalog.agentModelSorts ?? []).flatMap((sort) => (sort.groups ?? []).flatMap((group) => group.modelIds ?? [])))];
  const models = new Map<string, Model<Api>>();
  for (const id of agentIds) {
    const entry = entries[id];
    if (!entry) continue;
    const [, base = shownId.get(id) ?? id, effort = 'medium'] = EFFORT_SUFFIX.exec(shownId.get(id) ?? id) ?? [];
    const known = models.get(base);
    const model: Model<Api> = known ?? {
      id: base,
      name: `${(entry.displayName ?? base).replace(EFFORT_LABEL, '')} (Antigravity)`,
      api: API,
      provider: PROVIDER_ID,
      baseUrl,
      reasoning: true,
      thinkingLevelMap: { ...UNSUPPORTED },
      input: entry.supportsImages ? ['text', 'image'] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: entry.maxTokens ?? 0,
      maxTokens: entry.maxOutputTokens ?? 0,
    };
    const thinkingLevelMap: ThinkingLevelMap = { ...model.thinkingLevelMap, [effort as Effort]: JSON.stringify(variantOf(id, entry)) };
    models.set(base, {
      ...model,
      thinkingLevelMap,
      contextWindow: Math.max(model.contextWindow, entry.maxTokens ?? 0),
      maxTokens: Math.max(model.maxTokens, entry.maxOutputTokens ?? 0),
    });
  }
  return [...models.values()];
}

export function baselineModels(baseUrl: string): Model<Api>[] {
  return catalogModels(snapshot, baseUrl);
}

export function createFetchModels(endpoint: string) {
  return async (context: RefreshModelsContext): Promise<Model<Api>[]> => {
    if (context.credential?.type !== 'oauth') throw new Error('Google Antigravity is not logged in');
    const credential = parseCredential(context.credential);
    const data = await postCloudCode(endpoint, 'fetchAvailableModels', credential.access, { project: credential.projectId }, context.signal);
    return catalogModels(data, endpoint);
  };
}
