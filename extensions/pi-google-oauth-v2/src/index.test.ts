import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

import type { Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { CODE_ASSIST_BASE_URL, PROVIDER_ID } from './constants.ts';
import extension from './index.ts';

function register(): Provider[] {
  const registered: Provider[] = [];
  const pi = { registerProvider: (provider: Provider) => registered.push(provider) } as unknown as ExtensionAPI;
  extension(pi);
  return registered;
}

test('registers exactly one native provider for the Code Assist api', () => {
  const [provider, ...rest] = register();
  expect(rest).toEqual([]);
  expect(provider).toMatchObject({ id: PROVIDER_ID, baseUrl: CODE_ASSIST_BASE_URL, auth: { oauth: { isSubscription: true } } });
  expect(provider?.getModels()).toHaveLength(2);
});

test('starts no listener, timer, or request while loading', () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const before = process.getActiveResourcesInfo();
  register();
  expect(process.getActiveResourcesInfo()).toEqual(before);
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('production sources import only Pi-supplied modules and node builtins', () => {
  const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
  const files = readdirSync(sourceDirectory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const allowed = new Set(['@earendil-works/pi-ai', '@earendil-works/pi-ai/providers/all', '@earendil-works/pi-coding-agent']);
  const specifiers = files.flatMap((name) => [...readFileSync(new URL(name, import.meta.url), 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? ''));
  const rejected = specifiers.filter((specifier) => !(specifier.startsWith('./') || specifier.startsWith('node:') || builtinModules.includes(specifier) || allowed.has(specifier)));
  expect(files.length).toBeGreaterThan(5);
  expect(rejected).toEqual([]);
});

test('the package exports only its entry point', () => {
  const manifest: { exports: unknown } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports).toEqual({ '.': './src/index.ts' });
});
