import { type Message, normalizeContext } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTIVE_DEFAULT_MAX_TOKENS, ADAPTIVE_MODEL_ID, ANTHROPIC_URL, BUDGET_CUSTOM_LOW, BUDGET_FALLBACK, CLAUDE_CODE_IDENTITY, CUSTOM_MAX_TOKENS, EPHEMERAL } from './support/constants.ts';
import { EXPECTED_OAUTH_OPTIONS, EXPECTED_OAUTH_PARAMS, OAUTH_API_KEY } from './support/expected-request.ts';
import { context, streamEvents } from './support/fixtures.ts';
import { run } from './support/provider.ts';
import { resetSdk, setSdkEvents } from './support/sdk-state.ts';

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const { createSdkMock } = await import('./support/sdk-mock.ts');
  return createSdkMock(await importOriginal<typeof import('@anthropic-ai/sdk')>());
});

const INTERLEAVED_BETA = 'interleaved-thinking-2025-05-14';
const OAUTH_BETAS = ['claude-code-20250219', 'oauth-2025-04-20', INTERLEAVED_BETA];

beforeEach(() => {
  resetSdk();
  setSdkEvents(streamEvents);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request for OAuth tokens', () => {
  it('keeps emoji and other surrogate pairs and replaces only unpaired surrogates', async () => {
    const messages: Message[] = [{ role: 'user', content: 'ship it \u{1F680} \uD800 then \uDC00 end', timestamp: 1 }];
    const { call } = await run({ apiKey: 'k' }, normalizeContext({ systemPrompt: 'Use \u{1F44D}.', messages }));
    expect(call?.params['messages']).toEqual([{ role: 'user', content: 'ship it \u{1F680} \uFFFD then \uFFFD end' }]);
    expect(call?.params['system']).toEqual([{ type: 'text', text: 'Use \u{1F44D}.', cache_control: EPHEMERAL }]);
  });

  it('sends Claude Code identity, renamed tools, and converted messages for OAuth tokens', async () => {
    const { call } = await run({ apiKey: OAUTH_API_KEY, reasoning: 'high' });
    expect(call?.options).toEqual(EXPECTED_OAUTH_OPTIONS);
    expect(call?.params).toEqual(EXPECTED_OAUTH_PARAMS);
  });
});

describe('request for API keys', () => {
  it('sends an API key without Claude Code identity and honors maxTokens and custom budgets', async () => {
    const { call } = await run({ apiKey: 'sk-ant-api-x', maxTokens: CUSTOM_MAX_TOKENS, reasoning: 'low', thinkingBudgets: { low: BUDGET_CUSTOM_LOW } });
    expect(call?.options).toEqual({ baseURL: ANTHROPIC_URL, apiKey: 'sk-ant-api-x' });
    expect(call?.params['betas']).toEqual([INTERLEAVED_BETA]);
    expect(call?.params['max_tokens']).toBe(CUSTOM_MAX_TOKENS);
    expect(call?.params['system']).toEqual([{ type: 'text', text: 'Be brief.', cache_control: EPHEMERAL }]);
    expect(call?.params['thinking']).toEqual({ type: 'enabled', budget_tokens: BUDGET_CUSTOM_LOW, display: 'summarized' });
    expect(call?.params['tools']).toMatchObject([{ name: 'read' }, { name: 'my_tool' }]);
  });

  it('omits system, tools, and thinking when absent and falls back to the default budget', async () => {
    const plain = await run({ apiKey: 'sk-ant-api-x' }, normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }));
    expect(Object.keys(plain.call?.params ?? {}).toSorted()).toEqual(['max_tokens', 'messages', 'model', 'stream']);
    const xhigh = await run({ apiKey: 'sk-ant-oat-x', reasoning: 'xhigh' }, normalizeContext({ messages: [] }));
    expect(xhigh.call?.params['system']).toEqual([{ type: 'text', text: CLAUDE_CODE_IDENTITY, cache_control: EPHEMERAL }]);
    expect(xhigh.call?.params['thinking']).toEqual({ type: 'enabled', budget_tokens: BUDGET_FALLBACK, display: 'summarized' });
    expect(xhigh.call?.params['betas']).toEqual(OAUTH_BETAS);
  });
});

describe('request thinking effort', () => {
  it.each([
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'max'],
    ['minimal', 'low'],
  ])('uses adaptive thinking with effort for %s on adaptive models', async (reasoning, effort) => {
    const { call } = await run({ apiKey: 'sk-ant-api-x', reasoning }, context(), ADAPTIVE_MODEL_ID);
    expect(call?.params['thinking']).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(call?.params['output_config']).toEqual({ effort });
    expect(call?.params['betas']).toBeUndefined();
    expect(call?.params['max_tokens']).toBe(ADAPTIVE_DEFAULT_MAX_TOKENS);
  });
});
