import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, type Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { double, useTestHarness } from './harness.ts';

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
  readonly content?: unknown;
  readonly customType?: string;
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

function probeTool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: 'object', properties: {} },
    executionMode: 'sequential',
    execute: async () => ({ content: [{ type: 'text', text: name }], details: {} }),
  };
}

/**
 * Drives Pi's real agent loop. A steer queued during the first assistant turn is injected on the
 * next request, so that request carries both the tool result and the steered user message. A
 * followUp waits until the agent would stop, so the steer assertion fails when it is swapped in.
 */
describe('steered run guidance', () => {
  it('keeps the mode guidance on the request after a steered user message', async () => {
    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('ask');

    const injections = toAgentMessages(collectInjection(await h.emitAll('before_agent_start', { messageType: 'user', prompt: 'inspect only' })));
    expect(injections).toHaveLength(ONE);
    expect(injections[0]?.customType).toBe('pi-modes-context');

    const requests: CapturedMessage[][] = [];
    let calls = 0;
    const agent = new Agent({
      initialState: { model, systemPrompt: 'system', tools: [probeTool('probe')], messages: [] },
      toolExecution: 'sequential',
      transformContext: async (messages) => {
        const filtered = double<{ messages: typeof messages } | undefined>(await h.emit('context', { messages }))?.messages ?? messages;
        requests.push([...captureMessages(filtered)]);
        return filtered;
      },
      streamFn: () => {
        calls += 1;
        const stream = createAssistantMessageEventStream();
        const partial = { role: 'assistant' as const, content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop' as const, timestamp: SAMPLE_TS };
        queueMicrotask(() => {
          stream.push({ type: 'start', partial });
          if (calls === ONE) {
            agent.steer({ role: 'user', content: 'now edit the file', timestamp: SAMPLE_TS });
            const message = { ...partial, stopReason: 'toolUse' as const, content: [{ type: 'toolCall' as const, id: 'probe-1', name: 'probe', arguments: {} }] };
            stream.push({ type: 'done', reason: 'toolUse', message });
            stream.end(message);
            return;
          }
          stream.push({ type: 'text_start', contentIndex: 0, partial });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: 'ok', partial });
          stream.push({ type: 'text_end', contentIndex: 0, content: 'ok', partial });
          const message = { ...partial, content: [{ type: 'text' as const, text: 'ok' }] };
          stream.push({ type: 'done', reason: 'stop', message });
          stream.end(message);
        });
        return stream;
      },
    });

    await agent.prompt([{ role: 'user', content: 'inspect only', timestamp: SAMPLE_TS }, ...injections]);

    expect(requests).toHaveLength(TWO);
    expect(requests[ZERO]).toEqual(expect.arrayContaining([expect.objectContaining({ customType: 'pi-modes-context', content: expect.stringContaining('[ASK MODE ACTIVE]') })]));
    expect(requests[ONE]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'now edit the file' }), expect.objectContaining({ customType: 'pi-modes-context', content: expect.stringContaining('[ASK MODE ACTIVE]') })]),
    );
  });
});
