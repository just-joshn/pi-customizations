import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isRetryableAssistantError, type AssistantMessage } from '@earendil-works/pi-ai';
import { ModelRuntime, readStoredCredential } from '@earendil-works/pi-coding-agent';
import { expect } from 'vitest';
import { createGrokBuildProvider } from '../src/index.ts';
import { test } from './network-guard.ts';
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

test('Pi creates auth.json owner-only, reloads an external rewrite, and logout clears it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-xai-oauth-auth-'));
  const authPath = join(dir, 'auth.json');
  const modelsPath = join(dir, 'models.json');
  try {
    await writeFile(modelsPath, JSON.stringify({ providers: { 'grok-build': { modelOverrides: { 'grok-4.7': { contextWindow: 500000, maxTokens: 500000 } } } } }));
    const runtime = await ModelRuntime.create({ authPath, modelsPath, refreshOnCreate: false });
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);

    runtime.registerNativeProvider(createGrokBuildProvider(builtinXai()));
    await writeFile(authPath, authFile('first-token'), { mode: 0o600 });
    expect((await runtime.getAuth('grok-build'))?.auth.apiKey).toBe('first-token');

    await writeFile(authPath, authFile('second-token'), { mode: 0o600 });
    expect((await runtime.getAuth('grok-build'))?.auth.apiKey).toBe('second-token');

    await runtime.logout('grok-build');
    expect(await runtime.getAuth('grok-build')).toBeUndefined();
    expect(readStoredCredential('grok-build', authPath)).toBeUndefined();
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);
    expect(runtime.getModel('grok-build', 'grok-4.7')?.contextWindow).toBe(500000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pi does not retry a 401, so this package does not add a second recovery path', () => {
  expect(isRetryableAssistantError(rejected401())).toBe(false);
});
