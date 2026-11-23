import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Agent } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, type Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { double, type TestHarness, useTestHarness } from './harness.ts';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const SAMPLE_TS = 1;

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const model = double<Model<'openai-completions'>>({
  id: 'probe',
  name: 'probe',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'http://127.0.0.1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8000,
  maxTokens: 200,
});

interface InjectionResult {
  readonly message?: { readonly customType: string; readonly content: string; readonly display: boolean; readonly details?: unknown };
}

interface CapturedMessage {
  readonly role: string;
  readonly customType?: string;
  readonly content?: unknown;
}

function collectInjection(results: readonly unknown[]): readonly { readonly message: { readonly customType: string; readonly content: string; readonly display: boolean; readonly details?: unknown } }[] {
  return results.flatMap((result) => {
    const message = double<InjectionResult | undefined>(result)?.message;
    return message ? [{ message }] : [];
  });
}

function toAgentMessages(
  injections: readonly { readonly message: { readonly customType: string; readonly content: string; readonly display: boolean; readonly details?: unknown } }[],
): readonly { role: 'custom'; customType: string; content: string; display: boolean; details?: unknown; timestamp: number }[] {
  return injections.map(({ message }) => ({ role: 'custom' as const, customType: message.customType, content: message.content, display: message.display, details: message.details, timestamp: SAMPLE_TS }));
}

function captureMessages(messages: readonly { readonly role: string; readonly content?: unknown; readonly customType?: string }[]): readonly CapturedMessage[] {
  return messages.map((message) => {
    const captured = { role: message.role, content: message.content };
    return typeof message.customType === 'string' ? { ...captured, customType: message.customType } : captured;
  });
}

function customMessage(messages: readonly CapturedMessage[] | undefined, customType: string): CapturedMessage | undefined {
  return messages?.find((message) => message.customType === customType);
}

function streamText(text: string): () => ReturnType<typeof createAssistantMessageEventStream> {
  return () => {
    const stream = createAssistantMessageEventStream();
    const partial = { role: 'assistant' as const, content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop' as const, timestamp: SAMPLE_TS };
    queueMicrotask(() => {
      stream.push({ type: 'start', partial });
      stream.push({ type: 'text_start', contentIndex: 0, partial });
      stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial });
      stream.push({ type: 'text_end', contentIndex: 0, content: text, partial });
      const message = { ...partial, content: [{ type: 'text' as const, text }] };
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end(message);
    });
    return stream;
  };
}

function writeSkill(h: TestHarness): string {
  const filePath = join(h.cwd, '.pi', 'skills', 'reviewer', 'SKILL.md');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, ['---', 'name: reviewer', 'description: Reviews diffs', 'icon: "\u25c6"', 'color: red', '---', '', 'BODY_MARKER_REVIEW. Review every diff before it ships.', ''].join('\n'), 'utf-8');
  return filePath;
}

async function runTurns(prompts: readonly string[]): Promise<CapturedMessage[][]> {
  const h = useTestHarness();
  writeSkill(h);
  h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md', description: 'Reviews diffs' }]);
  await h.emit('session_start', {});
  await h.runCommand('mode', 'reviewer');

  const requests: CapturedMessage[][] = [];
  const agent = new Agent({
    initialState: { model, systemPrompt: 'system', tools: [], messages: [] },
    transformContext: async (messages) => {
      const filtered = double<{ messages: typeof messages } | undefined>(await h.emit('context', { messages }))?.messages ?? messages;
      requests.push([...captureMessages(filtered)]);
      return filtered;
    },
    streamFn: streamText('reviewed'),
  });

  for (const prompt of prompts) {
    const injections = toAgentMessages(collectInjection(await h.emitAll('before_agent_start', { messageType: 'user', prompt })));
    await agent.prompt([{ role: 'user', content: prompt, timestamp: SAMPLE_TS }, ...injections]);
  }
  return requests;
}

describe('custom mode configuration reaches the agent loop', () => {
  it('attaches the real skill body to the entering run', async () => {
    const requests = await runTurns(['start reviewing']);

    expect(requests).toHaveLength(ONE);
    const entered = customMessage(requests[ZERO], 'pi-modes-custom-mode');
    expect(entered).toEqual(expect.objectContaining({ customType: 'pi-modes-custom-mode', content: expect.stringContaining('<skill name="reviewer"') }));
    expect(entered?.content).toEqual(expect.stringContaining('BODY_MARKER_REVIEW'));
    expect(entered?.content).toEqual(expect.stringContaining('The user has entered Reviewer custom mode.'));
  });

  it('carries the reminder without the skill body on the next run', async () => {
    const requests = await runTurns(['start reviewing', 'a later turn']);

    expect(requests).toHaveLength(TWO);
    const reminder = customMessage(requests[ONE], 'pi-modes-custom-mode-reminder');
    expect(reminder).toEqual(expect.objectContaining({ customType: 'pi-modes-custom-mode-reminder', content: expect.stringContaining('Reminder: you are still in Reviewer mode') }));
    expect(reminder?.content).not.toEqual(expect.stringContaining('BODY_MARKER_REVIEW'));
    expect(reminder?.content).not.toEqual(expect.stringContaining('<skill name="reviewer"'));
  });
});
