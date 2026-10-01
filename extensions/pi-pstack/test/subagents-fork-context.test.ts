import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { forkDirective, forkEntryType, insideFork, readForkState, repairForkMessages, seedForkTranscript } from '../src/subagents/fork-context.ts';

type Messages = Parameters<typeof repairForkMessages>[0];
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = (text: string) => ({ role: 'user' as const, content: text, timestamp: 1 });
const assistant = (...calls: string[]) => ({
  role: 'assistant' as const,
  api: 'openai-completions' as const,
  provider: 'p',
  model: 'm',
  content: calls.length ? calls.map((id) => ({ type: 'toolCall' as const, id, name: 'Agent', arguments: {} })) : [{ type: 'text' as const, text: 'ok' }],
  stopReason: calls.length ? ('toolUse' as const) : ('stop' as const),
  timestamp: 2,
  usage,
});
const result = (id: string) => ({ role: 'toolResult' as const, toolCallId: id, toolName: 'Agent', content: [{ type: 'text' as const, text: 'r' }], isError: false, timestamp: 3 });
const ids = (messages: Messages) => messages.map((message) => (message.role === 'toolResult' ? `result:${message.toolCallId}` : message.role));

test('[B36] an assistant message whose tool call has no result is removed', () => {
  const messages = [user('go'), assistant('done-call'), result('done-call'), assistant('in-flight')] as Messages;
  expect(ids(repairForkMessages(messages))).toEqual(['user', 'assistant', 'result:done-call']);
});

test('[B36] results of siblings from a removed assistant message are removed with it', () => {
  const messages = [user('go'), assistant('a', 'b'), result('a')] as Messages;
  expect(ids(repairForkMessages(messages))).toEqual(['user']);
});

test('[B36] a complete conversation is unchanged', () => {
  const messages = [user('go'), assistant('a'), result('a'), assistant()] as Messages;
  expect(repairForkMessages(messages)).toEqual(messages);
});

test('[B35] the directive carries the fork boilerplate and the prompt verbatim', () => {
  const text = forkDirective('summarize the repo');
  expect(text.startsWith('<fork-boilerplate>\nYou are a worker fork.')).toBe(true);
  expect(text.endsWith('</fork-boilerplate>\nYour directive: summarize the repo')).toBe(true);
  expect(insideFork([user(text)] as Messages)).toBe(true);
  expect(insideFork([user('plain')] as Messages)).toBe(false);
});

test('[B94] the fork state round-trips through the transcript and is absent without a seed', () => {
  const manager = SessionManager.inMemory('/tmp');
  expect(readForkState(manager.getEntries())).toBeUndefined();
  seedForkTranscript(manager, [user('hi')] as Messages, { prompt: 'PARENT PROMPT', tools: ['read'], parentSessionId: 'parent-1' });
  expect(readForkState(manager.getEntries())).toEqual({ prompt: 'PARENT PROMPT', tools: ['read'], parentSessionId: 'parent-1' });
  expect(manager.getEntries().some((entry) => entry.type === 'custom' && entry.customType === forkEntryType)).toBe(true);
  expect(manager.buildSessionContext().messages).toHaveLength(1);
});

test('[B94] a malformed fork entry is treated as missing', () => {
  const manager = SessionManager.inMemory('/tmp');
  manager.appendCustomEntry(forkEntryType, { prompt: '', tools: [], parentSessionId: 'x' });
  expect(readForkState(manager.getEntries())).toBeUndefined();
});
