import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type Api, createAssistantMessageEventStream, type Provider } from '@earendil-works/pi-ai';
import { type ExtensionAPI, getAgentDir, type ProviderConfig } from '@earendil-works/pi-coding-agent';
import journeyProvider from './journey-provider.ts';

export default function heldJourneyProvider(pi: ExtensionAPI): void {
  journeyProvider({
    ...pi,
    registerProvider(name: string | Provider<Api>, config?: ProviderConfig) {
      if (typeof name !== 'string') {
        pi.registerProvider(name);
        return;
      }
      if (!config) throw new Error('The scripted provider configuration is missing.');
      const original = config.streamSimple;
      if (!original) throw new Error('The scripted provider must have a local stream implementation.');
      pi.registerProvider(name, {
        ...config,
        streamSimple(model, context, options) {
          const stream = createAssistantMessageEventStream();
          void (async () => {
            const message = await original(model, context, options).result();
            while (!existsSync(join(getAgentDir(), 'release-scripted-reply')) && !options?.signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 25));
            if (options?.signal?.aborted) {
              const aborted = { ...message, stopReason: 'aborted' as const, errorMessage: 'Scripted fixture aborted.' };
              stream.push({ type: 'error', reason: 'aborted', error: aborted });
              stream.end(aborted);
              return;
            }
            stream.push({ type: 'done', reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop', message });
            stream.end(message);
          })();
          return stream;
        },
      });
    },
  });
}
