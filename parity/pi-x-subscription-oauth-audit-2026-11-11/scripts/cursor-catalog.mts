import { createCursorProvider } from '../../../extensions/pi-x-subscription-oauth/src/cursor/provider.ts';
import { refreshContext, storedCredential } from './audit-env.mts';

const provider = createCursorProvider({ readSession: async () => undefined, readApiKey: async () => undefined });
await provider.refreshModels?.(refreshContext(storedCredential('cursor')));
console.log(
  JSON.stringify(
    provider.getModels().map((model) => model.id),
    null,
    0,
  ),
);
