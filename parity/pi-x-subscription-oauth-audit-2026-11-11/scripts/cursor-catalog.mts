import { createCursorProvider } from '../../../extensions/pi-x-subscription-oauth/src/cursor/provider.ts';
import { refreshContext, storedCredential } from './audit-env.mts';

const provider = createCursorProvider({ readSession: async () => undefined, readApiKey: async () => undefined });
await provider.refreshModels?.(refreshContext(storedCredential('cursor')));
const rows = provider.getModels().map((model) => ({ id: model.id, name: model.name, contextWindow: model.contextWindow, reasoning: model.reasoning, input: model.input }));
console.log(JSON.stringify(rows, null, 1));
