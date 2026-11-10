import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AssistantMessage, isRetryableAssistantError } from '@earendil-works/pi-ai';
import { ModelRuntime, readStoredCredential } from '@earendil-works/pi-coding-agent';
import { expect } from 'vitest';
import { createGrokBuildProvider } from '../src/index.ts';
import { test as base } from './network-guard.ts';
import { builtinXai } from './support/builtin-xai.ts';

const FAR_FUTURE = Date.UTC(2100, 0, 1);

function credential(access: string) {
  return { type: 'oauth' as const, access, refresh: `refresh-${access}`, expires: FAR_FUTURE };
}

function authFile(access: string) {
  return JSON.stringify({ 'grok-build': credential(access) });
}

function rejected401(): AssistantMessage {
  return {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'grok-build API error (401): 401 "Invalid or expired credentials"',
    content: [],
    api: 'openai-responses',
    provider: 'grok-build',
    model: 'grok-4.7',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: 0,
  } as AssistantMessage;
}

const test = base.extend<{ paths: { authPath: string; modelsPath: string } }>({
  paths: async ({ networkGuard: _networkGuard }, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-x-subscription-oauth-auth-'));
    try {
      const modelsPath = join(dir, 'models.json');
      await writeFile(modelsPath, JSON.stringify({ providers: { 'grok-build': { modelOverrides: { 'grok-4.7': { contextWindow: 500000, maxTokens: 500000 } } } } }));
      await use({ authPath: join(dir, 'auth.json'), modelsPath });
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  },
});

async function openRuntime({ authPath, modelsPath }: { authPath: string; modelsPath: string }) {
  const runtime = await ModelRuntime.create({ authPath, modelsPath, refreshOnCreate: false });
  runtime.registerNativeProvider(createGrokBuildProvider(builtinXai()));
  return runtime;
}

test('Pi creates auth.json owner-only', async ({ paths }) => {
  await openRuntime(paths);
  expect((await stat(paths.authPath)).mode & 0o777).toBe(0o600);
});

test('Pi reloads an external auth.json rewrite', async ({ paths }) => {
  const runtime = await openRuntime(paths);
  await writeFile(paths.authPath, authFile('first-token'), { mode: 0o600 });
  expect((await runtime.getAuth('grok-build'))?.auth.apiKey).toBe('first-token');
  await writeFile(paths.authPath, authFile('second-token'), { mode: 0o600 });
  expect((await runtime.getAuth('grok-build'))?.auth.apiKey).toBe('second-token');
});

test('logout clears the stored credential, leaving auth.json owner-only', async ({ paths }) => {
  const runtime = await openRuntime(paths);
  await writeFile(paths.authPath, authFile('first-token'), { mode: 0o600 });
  await runtime.logout('grok-build');
  expect(await runtime.getAuth('grok-build')).toBeUndefined();
  expect(readStoredCredential('grok-build', paths.authPath)).toBeUndefined();
  expect((await stat(paths.authPath)).mode & 0o777).toBe(0o600);
});

test('a models.json override survives logout', async ({ paths }) => {
  const runtime = await openRuntime(paths);
  await runtime.logout('grok-build');
  expect(runtime.getModel('grok-build', 'grok-4.7')?.contextWindow).toBe(500000);
});

test('Pi does not retry a 401 assistant error', () => {
  expect(isRetryableAssistantError(rejected401())).toBe(false);
});
