import type { AssistantMessage, Context, Model } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { buildCommitMessageRequest, normalizeCommitMessage } from '../../src/git/commit-message.ts';
import { createCommitMessageGenerator } from '../../src/git/commit-model.ts';

const model = (id: string): Model<string> => ({
  provider: 'maintainer-test',
  id,
  name: id,
  api: 'maintainer-scripted',
  baseUrl: 'https://test.invalid',
  reasoning: false,
  input: ['text'],
  contextWindow: 128000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

const reply = (text: string): AssistantMessage => ({
  role: 'assistant',
  api: 'maintainer-scripted',
  provider: 'maintainer-test',
  model: 'scripted',
  content: [{ type: 'text', text }],
  stopReason: 'stop',
  timestamp: Date.now(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

/** A registry that answers per model id, recording every request. */
function scriptedRegistry(answers: Readonly<Record<string, string | Error>>) {
  const calls: { model: string; context: Context }[] = [];
  const models = new Map(Object.keys(answers).map((id) => [id, model(id)]));
  return {
    calls,
    find: (provider: string, id: string) => (provider === 'maintainer-test' ? models.get(id) : undefined),
    complete: async (target: Model<string>, context: Context) => {
      calls.push({ model: target.id, context });
      const answer = answers[target.id];
      if (answer instanceof Error) throw answer;
      return reply(answer ?? '');
    },
  };
}

test('the commit-message model ladder keeps the first non-empty reply and sends both models the same request', { meta: { aider: ['test_repo/TestRepo.test_get_commit_message'] } }, async () => {
  const registry = scriptedRegistry({ weak: '', strong: 'a good commit message' });
  const generate = createCommitMessageGenerator({ registry, main: () => ({ provider: 'maintainer-test', id: 'strong' }), weak: () => ({ provider: 'maintainer-test', id: 'weak' }) });
  const request = buildCommitMessageRequest('dummy diff', 'dummy context');
  expect(await generate(request)).toBe('a good commit message');
  expect(registry.calls.map((call) => call.model)).toEqual(['weak', 'strong']);
  expect(registry.calls[0]?.context.messages).toEqual(registry.calls[1]?.context.messages);
});

test('without a weak model the main model fills both ladder slots', { meta: { aider: ['test_repo/TestRepo.test_get_commit_message'] } }, async () => {
  const registry = scriptedRegistry({ strong: 'only message' });
  const generate = createCommitMessageGenerator({ registry, main: () => ({ provider: 'maintainer-test', id: 'strong' }), weak: () => null });
  expect(await generate(buildCommitMessageRequest('diff', null))).toBe('only message');
  expect(registry.calls.map((call) => call.model)).toEqual(['strong']);
});

test('every model failing yields no message and a provider error does not stop the ladder', async () => {
  const registry = scriptedRegistry({ weak: new Error('weak provider down'), strong: '' });
  const generate = createCommitMessageGenerator({ registry, main: () => ({ provider: 'maintainer-test', id: 'strong' }), weak: () => ({ provider: 'maintainer-test', id: 'weak' }) });
  expect(await generate(buildCommitMessageRequest('diff', null))).toBeNull();
  expect(registry.calls.map((call) => call.model)).toEqual(['weak', 'strong']);
});

test('surrounding quotes are stripped only as a matched pair', { meta: { aider: ['test_repo/TestRepo.test_get_commit_message_strip_quotes', 'test_repo/TestRepo.test_get_commit_message_no_strip_unmatched_quotes'] } }, () => {
  expect(normalizeCommitMessage('"a good commit message"')).toBe('a good commit message');
  expect(normalizeCommitMessage('a good "commit message"')).toBe('a good "commit message"');
});

test('a custom commit prompt replaces the default system prompt', { meta: { aider: ['test_repo/TestRepo.test_get_commit_message_with_custom_prompt'] } }, () => {
  const request = buildCommitMessageRequest('dummy diff', 'dummy context', { commitPrompt: 'Generate a commit message in the style of Shakespeare' });
  expect(request.system).toBe('Generate a commit message in the style of Shakespeare');
  expect(request.user).toContain('# Diffs:\ndummy diff');
});
