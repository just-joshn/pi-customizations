// Small helpers that keep the fakes honest without casts.

import type { Api, Model } from '@earendil-works/pi-ai';
import { vi } from 'vitest';

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 64_000;

/** A promise that rejects with `reason` as given, including values that are not Error objects. */
export const rejection = (reason: unknown): Promise<never> => vi.fn<() => Promise<never>>().mockRejectedValue(reason)();

/**
 * A fake that stands in for a Pi host type. It checks the fake defines every member the extension
 * uses, so a typo in a fake fails the test at load instead of surfacing as an undefined call.
 */
export function asHostType<T extends object>(fake: object, label: string, members: readonly (keyof T & string)[]): T {
  const isHostType = (value: object): value is T => members.every((member) => member in value);
  if (!isHostType(fake)) throw new Error(`the fake ${label} is missing one of: ${members.join(', ')}`);
  return fake;
}

/** A complete chat model entry, as Pi hands a provider. */
export const makeModel = (id: string, provider: string, api: Api): Model<Api> => ({
  id,
  name: id,
  api,
  provider,
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  maxTokens: DEFAULT_MAX_TOKENS,
});
