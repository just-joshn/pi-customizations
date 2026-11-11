import type { createCursorProvider } from '../../../extensions/pi-x-subscription-oauth/src/cursor/provider.ts';
import extension from '../../../extensions/pi-x-subscription-oauth/src/index.ts';
import { refreshContext, storedCredential } from './audit-env.mts';

type PiApi = Parameters<typeof extension>[0];
type RegisteredProvider = ReturnType<typeof createCursorProvider>;

const providers: RegisteredProvider[] = [];
extension({
  registerProvider: (provider: RegisteredProvider | string) => {
    if (typeof provider !== 'string') providers.push(provider);
  },
  registerVirtualModel: () => {},
  registerCommand: () => {},
} satisfies PiApi);
const provider = providers.find((candidate) => candidate.id === 'grok-build');
if (!provider?.refreshModels) throw new Error('The extension registered no refreshable grok-build provider.');
await provider.refreshModels(refreshContext(storedCredential('grok-build')));
const rows = provider.getModels().map((model) => ({
  id: model.id,
  contextWindow: model.contextWindow,
  thinking: Object.entries(model.thinkingLevelMap ?? {})
    .filter(([, level]) => level)
    .map(([name]) => name),
}));
console.log(JSON.stringify(rows, null, 1));
