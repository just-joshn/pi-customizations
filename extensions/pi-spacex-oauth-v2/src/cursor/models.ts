import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { CURSOR_API } from './auth.ts';

export const CURSOR_CLIENT_VERSION = 'cli-2026.11.13-eacade1';
export const cursorHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  'x-cursor-client-type': 'cli',
  'x-cursor-client-version': CURSOR_CLIENT_VERSION,
  'x-ghost-mode': 'true',
});

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];
const EFFORT_WORDS = /\s+(None|Minimal|Low|Medium|High|Extra High|Max)(?=\s+Thinking|\s+Fast|\s+\(|$)/;

export interface CursorModelDetails {
  modelId: string;
  displayName?: string;
}

interface Variant {
  id: string;
  effort?: Effort;
  displayName: string;
}

/** Splits a flat Cursor id like `claude-opus-5-5-high-fast` into its pi model id and effort. */
export function parseVariant(id: string): { piId: string; effort?: Effort } {
  const fast = id.endsWith('-fast');
  const stem = fast ? id.slice(0, -5) : id;
  const effort = EFFORTS.find((e) => stem.endsWith(`-${e}`));
  const base = effort ? stem.slice(0, -(effort.length + 1)) : stem;
  return { piId: fast ? `${base}-fast` : base, ...(effort ? { effort } : {}) };
}

const cleanName = (name: string) => name.replace(/[​-‍]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Collapses Cursor's per-effort ids into one pi model per base id (and one per `-fast` base).
 * The pi thinking level picks the variant through thinkingLevelMap, whose values are real Cursor ids.
 */
export function collapseModels(models: CursorModelDetails[], windows: ReadonlyMap<string, number> = new Map()): ProviderModelConfig[] {
  const groups = new Map<string, Variant[]>();
  for (const m of models) {
    if (m.modelId === 'default') continue;
    const { piId, effort } = parseVariant(m.modelId);
    groups.set(piId, [...(groups.get(piId) ?? []), { id: m.modelId, ...(effort ? { effort } : {}), displayName: cleanName(m.displayName ?? m.modelId) }]);
  }
  const out: ProviderModelConfig[] = [{ id: 'auto', name: 'Auto', reasoning: false, input: ['text'], cost: zeroCost, contextWindow: windows.get('default') ?? fallbackWindow('auto'), maxTokens: 64_000 }];
  for (const [piId, variants] of groups) {
    const plain = variants.find((v) => !v.effort);
    const byEffort = new Map(variants.filter((v) => v.effort).map((v) => [v.effort as Effort, v.id]));
    const named = plain ?? variants.find((v) => v.effort === 'high') ?? variants[0];
    const name = (named?.displayName ?? piId).replace(EFFORT_WORDS, '');
    out.push({
      id: piId,
      name,
      reasoning: byEffort.size > 0,
      ...(byEffort.size > 0
        ? {
            thinkingLevelMap: {
              off: plain?.id ?? byEffort.get('none') ?? null,
              minimal: byEffort.get('minimal') ?? null,
              low: byEffort.get('low') ?? null,
              medium: byEffort.get('medium') ?? null,
              high: byEffort.get('high') ?? null,
              xhigh: byEffort.get('xhigh') ?? null,
              max: byEffort.get('max') ?? null,
            },
          }
        : {}),
      input: ['text'],
      cost: zeroCost,
      contextWindow: variants.map((v) => windows.get(v.id)).find((w) => w !== undefined) ?? fallbackWindow(piId),
      maxTokens: 64_000,
    });
  }
  return out;
}

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * For models AvailableModels does not describe. Grok and Auto run at 256k and Composer at 200k, per token_details.max_tokens
 * in Cursor's conversation state; anything else gets the smaller window rather than a guess from its name.
 */
const fallbackWindow = (piId: string) => (piId === 'auto' || piId.includes('grok') ? 256_000 : 200_000);

/** Non-max-mode windows from AvailableModels tooltips ("256k context window"), the only place Cursor states them. */
async function fetchContextWindows(token: string, signal?: AbortSignal): Promise<Map<string, number>> {
  const res = await fetch(`${CURSOR_API}/aiserver.v1.AiService/AvailableModels`, {
    method: 'POST',
    headers: { ...cursorHeaders(token), 'content-type': 'application/json', 'connect-protocol-version': '1' },
    body: '{}',
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) return new Map();
  const body = (await res.json()) as { models?: { name: string; tooltipData?: { markdownContent?: string } }[] };
  const windows = new Map<string, number>();
  for (const m of body.models ?? []) {
    const match = /(\d+(?:\.\d+)?)([kM]) context window/.exec(m.tooltipData?.markdownContent ?? '');
    if (match) windows.set(m.name, Number(match[1]) * (match[2] === 'M' ? 1_000_000 : 1_000));
  }
  return windows;
}

/** The Cursor id to request for a pi model at a pi thinking level. */
export function resolveCursorModelId(piId: string, map: Partial<Record<string, string | null>> | undefined, level: string | undefined): string {
  if (piId === 'auto') return 'default';
  if (!map) return piId;
  const pick = (l: string) => map[l] ?? undefined;
  return pick(level ?? 'off') ?? pick('medium') ?? pick('high') ?? pick('low') ?? Object.values(map).find((v): v is string => !!v) ?? piId;
}

export async function fetchCursorModels(token: string, signal?: AbortSignal): Promise<ProviderModelConfig[]> {
  const windows = fetchContextWindows(token, signal).catch(() => new Map<string, number>());
  const res = await fetch(`${CURSOR_API}/agent.v1.AgentService/GetUsableModels`, {
    method: 'POST',
    headers: { ...cursorHeaders(token), 'content-type': 'application/json', 'connect-protocol-version': '1' },
    body: '{}',
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`Cursor model list failed: HTTP ${res.status}`);
  const body = (await res.json()) as { models?: CursorModelDetails[] };
  return collapseModels(body.models ?? [], await windows);
}
