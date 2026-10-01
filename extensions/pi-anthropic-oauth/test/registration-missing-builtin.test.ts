import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { expect, test, vi } from 'vitest';
import extension from '../src/index.ts';
import { loadExtension } from './support/load-extension.ts';

vi.mock(import('@earendil-works/pi-ai/providers/all'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, builtinProviders: vi.fn(actual.builtinProviders) };
});

const MISSING = "Pi's built-in anthropic provider with Claude Pro/Max OAuth is not available.";

test('loading fails when Pi has no anthropic provider', async () => {
  vi.mocked(builtinProviders).mockReturnValueOnce([]);
  await expect(loadExtension(extension)).rejects.toThrow(MISSING);
});

test('loading fails when the anthropic provider has no OAuth', async () => {
  const anthropic = builtinProviders().find((provider) => provider.id === 'anthropic');
  if (!anthropic) throw new Error('Pi has no anthropic provider to strip');
  vi.mocked(builtinProviders).mockReturnValueOnce([{ ...anthropic, auth: { apiKey: anthropic.auth.apiKey } }]);
  await expect(loadExtension(extension)).rejects.toThrow(MISSING);
});
