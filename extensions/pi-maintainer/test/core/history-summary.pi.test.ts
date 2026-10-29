import type { AssistantMessage, Context, Model } from '@earendil-works/pi-ai';
import { type ExtensionAPI, estimateTokens } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { installMaintainer } from '../../src/core/install.ts';
import { defaultPromptPolicy } from '../../src/core/prompts.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { historyOverBudget, historyTokens, maxChatHistoryTokens, SUMMARIZE_PROMPT, SUMMARY_PREFIX, summarizeHistory, summaryConversationText } from '../../src/edit/history-summary.ts';
import { gitFeature } from '../../src/git/feature.ts';
import { commitFile, initRepo } from '../git/support.ts';
import { testPrompts, textOf } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle, scriptedModel } from '../support/pi-session.ts';

const weakModel = { ...scriptedModel, id: 'scripted-weak', name: 'Scripted weak' };

const extension = (pi: ExtensionAPI): void => {
  installMaintainer(pi, [editFeature, gitFeature], {
    promptSource: testPrompts,
    promptPolicy: defaultPromptPolicy,
    home: () => '/nonexistent-maintainer-home',
    processEnvironment: () => ({}),
  });
};

const summaryModel = (id: string): Model<string> => ({
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

const summaryReply = (text: string): AssistantMessage => ({
  role: 'assistant',
  api: 'maintainer-scripted',
  provider: 'maintainer-test',
  model: 'main',
  content: [{ type: 'text', text }],
  stopReason: 'stop',
  timestamp: Date.now(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

/** A registry that answers per model id, recording the order and the system prompt it received. */
function scriptedRegistry(answers: Readonly<Record<string, string>>) {
  const calls: { model: string; context: Context }[] = [];
  return {
    calls,
    find: (provider: string, id: string) => (provider === 'maintainer-test' ? summaryModel(id) : undefined),
    complete: async (target: Model<string>, context: Context) => {
      calls.push({ model: target.id, context });
      return summaryReply(answers[target.id] ?? '');
    },
  };
}

test('the default history budget is one sixteenth of the input limit clamped to 1024-8192', { meta: { aider: ['test_history/TestChatSummary.test_initialization'] } }, () => {
  expect(maxChatHistoryTokens(null, 4096)).toBe(1024);
  expect(maxChatHistoryTokens(null, 65536)).toBe(4096);
  expect(maxChatHistoryTokens(null, 1000000)).toBe(8192);
  expect(maxChatHistoryTokens(23, 1000000)).toBe(23);
});

test('summarization starts only above the soft limit', { meta: { aider: ['test_history/TestChatSummary.test_too_big'] } }, () => {
  expect(historyOverBudget(1024, 1024)).toBe(false);
  expect(historyOverBudget(1025, 1024)).toBe(true);
});

test('history tokens are the sum of the per-message estimates', { meta: { aider: ['test_history/TestChatSummary.test_tokenize'] } }, () => {
  const short = { role: 'user' as const, content: 'Hello world', timestamp: 0 };
  const long = { role: 'user' as const, content: 'word '.repeat(500), timestamp: 0 };
  expect(historyTokens([short, long])).toBe(estimateTokens(short) + estimateTokens(long));
  expect(historyTokens([long])).toBeGreaterThan(historyTokens([short]));
});

test('the summary ladder falls back to the main model and prefixes its reply', { meta: { aider: ['test_history/TestChatSummary.test_fallback_to_second_model'] } }, async () => {
  const registry = scriptedRegistry({ weak: '', main: 'This is a summary' });
  const result = await summarizeHistory({ registry, main: () => ({ provider: 'maintainer-test', id: 'main' }), weak: () => ({ provider: 'maintainer-test', id: 'weak' }) }, '# USER\nHello world\n');
  expect(result?.text).toBe(`${SUMMARY_PREFIX}This is a summary`);
  expect(registry.calls.map((call) => call.model)).toEqual(['weak', 'main']);
  expect(registry.calls[0]?.context.messages[0]?.content).toBe(SUMMARIZE_PROMPT);
});

test('summary input keeps user and assistant turns under Aider role headings', { meta: { aider: ['test_history/TestChatSummary.test_summarize_all'] } }, () => {
  const text = summaryConversationText([
    { role: 'user', content: 'first question' },
    { role: 'toolResult', content: 'ignored output' },
    {
      role: 'assistant',
      content: [{ type: 'image' }, { type: 'text', text: 'first answer' }],
    },
  ]);
  expect(text).toBe('# USER\nfirst question\n# ASSISTANT\nfirst answer\n');
});

test('history past the soft budget is summarized with Aider summary prompt and the weak model', { meta: { aider: ['test_history/TestChatSummary.test_summarize_all'] } }, async () => {
  const f = await piSessionFixture({
    extension,
    models: [weakModel],
    config: 'edit-format: whole\nfile: [hello.txt]\nyes-always: true\ngitignore: false\nmax-chat-history-tokens: 1\nweak-model: scripted-weak\n',
  });
  await initRepo(f.cwd);
  await commitFile(f.cwd, 'hello.txt', 'before\n', 'seed');
  f.replies.push({ text: 'hello.txt\n```\nafter\n```\n' }, { text: 'feat: edit hello' }, { text: 'I asked you about hello.txt.' });
  const session = await f.open();
  await promptAndSettle(session, 'change hello.txt');

  await vi.waitFor(
    () => {
      expect(session.sessionManager.getBranch().some((entry) => entry.type === 'compaction')).toBe(true);
    },
    { timeout: 10000 },
  );
  const compaction = session.sessionManager.getBranch().find((entry) => entry.type === 'compaction');
  expect(compaction?.type === 'compaction' ? compaction.summary : '').toContain(`${SUMMARY_PREFIX}I asked you about hello.txt.`);
  const summaryRequest = f.requests.find((request) => request.messages.some((message) => message.role === 'system' && textOf(message).includes('summarize this partial conversation')));
  expect(
    summaryRequest?.messages
      .filter((message) => message.role === 'user')
      .map(textOf)
      .join('\n'),
  ).toContain('# USER');
  expect(f.routedModels).toEqual(['scripted', 'scripted-weak', 'scripted-weak']);
  expect(f.errors).toEqual([]);
});
