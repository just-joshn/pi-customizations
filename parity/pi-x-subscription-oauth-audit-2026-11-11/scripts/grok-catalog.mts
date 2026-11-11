import { builtinProviders } from '../../../extensions/pi-x-subscription-oauth/node_modules/@earendil-works/pi-ai/dist/providers/all.js';
import { createGrokBuildProvider } from '../../../extensions/pi-x-subscription-oauth/src/index.ts';
import { refreshContext, storedCredential } from './audit-env.mts';

const xai = builtinProviders().find((provider) => provider.id === 'xai');
if (!xai) throw new Error('Pi has no built-in xai provider.');
const provider = createGrokBuildProvider(xai);
await provider.refreshModels?.(refreshContext(storedCredential('grok-build')));
const rows = provider.getModels().map((model) => ({
  id: model.id,
  name: model.name,
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
  thinking: Object.entries(model.thinkingLevelMap ?? {})
    .filter(([, level]) => level)
    .map(([name]) => name),
  cost: model.cost,
}));
console.log(JSON.stringify(rows, null, 1));
