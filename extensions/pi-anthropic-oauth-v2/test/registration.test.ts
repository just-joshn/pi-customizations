import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { describe, expect, it } from 'vitest';
import extension from '../src/index.ts';
import {
  ADAPTIVE_MODEL_ID,
  ANTHROPIC_URL,
  CONTEXT_WINDOW,
  COST_CACHE_READ_PER_MILLION,
  COST_CACHE_WRITE_PER_MILLION,
  COST_INPUT_PER_MILLION,
  COST_OUTPUT_PER_MILLION,
  DEFAULT_MODEL_ID,
  MODEL_MAX_TOKENS,
  PROVIDER_ID,
} from './support/constants.ts';
import { register } from './support/provider.ts';

const EXPECTED_DEFAULT_MODEL = {
  id: DEFAULT_MODEL_ID,
  name: 'Claude Sonnet 4.5 (latest) (Custom)',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: COST_INPUT_PER_MILLION, output: COST_OUTPUT_PER_MILLION, cacheRead: COST_CACHE_READ_PER_MILLION, cacheWrite: COST_CACHE_WRITE_PER_MILLION },
  contextWindow: CONTEXT_WINDOW,
  maxTokens: MODEL_MAX_TOKENS,
};

describe('provider registration', () => {
  it('registers custom-anthropic with the current Anthropic catalog and OAuth', () => {
    const { name, config } = register();
    const catalog = builtinProviders()
      .find((provider) => provider.id === 'anthropic')
      ?.getModels()
      .filter((entry) => entry.api === 'anthropic-messages');
    expect(name).toBe(PROVIDER_ID);
    expect(config.baseUrl).toBe(ANTHROPIC_URL);
    expect(config.apiKey).toBe('$CUSTOM_ANTHROPIC_API_KEY');
    expect(config.api).toBe('custom-anthropic-api');
    expect(config.models.map((entry) => entry['id'])).toEqual(catalog?.map((entry) => entry.id));
    expect(config.models.find((entry) => entry['id'] === DEFAULT_MODEL_ID)).toEqual(EXPECTED_DEFAULT_MODEL);
    expect(config.models.find((entry) => entry['id'] === ADAPTIVE_MODEL_ID)).toMatchObject({
      compat: { forceAdaptiveThinking: true },
      thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
    });
    expect(config.oauth.name).toBe('Custom Anthropic (Claude Pro/Max)');
    expect(config.oauth.getApiKey({ access: 'tok' })).toBe('tok');
  });
});

describe('registration errors', () => {
  it('wraps a registration failure', () => {
    const pi = {
      registerProvider: () => {
        throw new Error('duplicate');
      },
    };
    expect(() => extension(pi)).toThrow('Could not register the custom-anthropic provider.');
  });
});
