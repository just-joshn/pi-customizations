import { readFileSync } from 'node:fs';
const EXT = '/Users/josh-desktop/src/personal/pi-x-subscription-oauth-audit/extensions/pi-x-subscription-oauth/src';
const { createGrokBuildProvider } = await import(`${EXT}/index.ts`);
const { builtinProviders } = await import('/Users/josh-desktop/src/personal/pi-x-subscription-oauth-audit/extensions/pi-x-subscription-oauth/node_modules/@earendil-works/pi-ai/dist/providers/all.js');
const xai = builtinProviders().find((p: any) => p.id === 'xai');
const provider = createGrokBuildProvider(xai);
const cred = JSON.parse(readFileSync('/tmp/xaudit/piagent/auth.json', 'utf8'))['grok-build'];
await provider.refreshModels({ credential: cred, allowNetwork: true, force: true, publish: async (p: any) => { p.update?.(); return true; }, signal: AbortSignal.timeout(30000) }); const models = provider.getModels();
console.log(JSON.stringify(models.map((m: any) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow, maxTokens: m.maxTokens, thinking: Object.entries(m.thinkingLevelMap ?? {}).filter(([, v]) => v).map(([k]) => k), cost: m.cost })), null, 1));
