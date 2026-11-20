import { readFileSync } from 'node:fs';

import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { CODE_ASSIST_BASE_URL, PROVIDER_ID, PROVIDER_NAME } from './constants.ts';
import { installGoogle } from './google.ts';
import { loadProviders } from './session.ts';

const MANIFEST = z.object({ exports: z.record(z.string(), z.string()), pi: z.object({ extensions: z.array(z.string()) }) });

afterEach(() => vi.unstubAllGlobals());

test('registers exactly one native provider for Google AI plans with the baseline models', () => {
  const [provider, ...rest] = loadProviders();
  expect(rest).toEqual([]);
  expect(provider).toMatchObject({ id: PROVIDER_ID, name: PROVIDER_NAME, baseUrl: CODE_ASSIST_BASE_URL, auth: { oauth: { isSubscription: true } } });
  expect(provider?.getModels().map((model) => model.id)).toEqual(['gemini-4-argon', 'gemini-3.8-flash']);
  expect(provider?.refreshModels).toBeTypeOf('function');
});

test('starts no listener, timer, or request while loading', () => {
  const google = installGoogle({});
  const before = process.getActiveResourcesInfo();
  loadProviders();
  expect(process.getActiveResourcesInfo()).toEqual(before);
  expect(google.fetchImpl).not.toHaveBeenCalled();
});

test('the package is loaded through a single entry point', () => {
  const manifest = MANIFEST.parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
  expect(manifest.exports).toEqual({ '.': './src/index.ts' });
  expect(manifest.pi.extensions).toEqual(['./src/index.ts']);
});
