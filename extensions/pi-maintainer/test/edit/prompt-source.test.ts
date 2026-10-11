import { expect, test } from 'vitest';
import { createEditPromptSource } from '../../src/edit/prompt-source.ts';

const fence = ['```', '```'] as const;
const variables = {
  fence,
  root: '/tmp/repo',
  model: { provider: 'openai', id: 'gpt-4o' },
  suggestShellCommands: false,
};

test('whole format returns a formatted mainSystem with the expert developer line', async () => {
  const source = createEditPromptSource({
    env: {},
    chatLanguage: () => null,
    now: () => new Date('2026-10-10T12:00:00Z'),
    platform: () => 'Linux-6.1',
    windows: () => false,
  });
  const set = await source.get('whole', variables);
  expect(set.mainSystem).toContain('Act as an expert software developer');
});

test('unknown format throws naming the format', () => {
  const source = createEditPromptSource();
  expect(() => source.get('help', variables)).toThrow(/help/);
});

test('aborted signal throws before formatting', () => {
  const source = createEditPromptSource();
  const controller = new AbortController();
  controller.abort();
  expect(() => source.get('whole', { ...variables, signal: controller.signal })).toThrow();
});
