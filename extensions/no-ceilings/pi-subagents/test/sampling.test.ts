import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { createSamplingExtension } from '../src/sampling.ts';
import type { SubagentSampling } from '../src/types.ts';
import { double } from './harness.ts';

type RequestHandler = (event: { readonly type: 'before_provider_request'; readonly payload: unknown }, ctx: ExtensionContext) => Promise<unknown>;

function captureRequestHandler(api: string | undefined, sampling: SubagentSampling | undefined): RequestHandler | undefined {
  let handler: RequestHandler | undefined;
  const factory = createSamplingExtension({ api } as never, sampling);
  factory?.(
    double<ExtensionAPI>({
      on: (name: string, callback: unknown) => {
        if (name === 'before_provider_request') {
          handler = callback as RequestHandler;
        }
      },
    }),
  );
  return handler;
}

describe('sampling injection', () => {
  it('adds temperature and top_p to an OpenAI payload', async () => {
    const handler = captureRequestHandler('openai-completions', { temperature: 0.2, topP: 0.5 });
    expect(handler).toBeDefined();
    const result = (await handler?.({ type: 'before_provider_request', payload: { model: 'm', temperature: 1, messages: [] } }, double<ExtensionContext>({}))) as Record<string, unknown>;
    expect(result).toMatchObject({ model: 'm', temperature: 0.2, top_p: 0.5 });
    expect(result).not.toHaveProperty('top_k');
  });

  it('adds temperature, top_p, and top_k to an Anthropic payload', async () => {
    const handler = captureRequestHandler('anthropic-messages', { temperature: 0.2, topP: 0.5, topK: 8 });
    const result = (await handler?.({ type: 'before_provider_request', payload: { model: 'm', messages: [] } }, double<ExtensionContext>({}))) as Record<string, unknown>;
    expect(result).toMatchObject({ temperature: 0.2, top_p: 0.5, top_k: 8 });
  });

  it('registers nothing when the definition sets no sampling', () => {
    expect(createSamplingExtension({ api: 'openai-completions' } as never, undefined)).toBeUndefined();
  });
});
