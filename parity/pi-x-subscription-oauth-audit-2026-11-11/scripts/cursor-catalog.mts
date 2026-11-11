import { readFileSync } from 'node:fs';
const EXT = '/Users/josh-desktop/src/personal/pi-x-subscription-oauth-audit/extensions/pi-x-subscription-oauth/src/cursor';
const { createCursorProvider } = await import(`${EXT}/provider.ts`);
const cred = JSON.parse(readFileSync('/tmp/xaudit/piagent/auth.json', 'utf8')).cursor;
const p = createCursorProvider({ readSession: async () => undefined, readApiKey: async () => undefined });
await p.refreshModels({ credential: cred, allowNetwork: true, force: true, publish: async (p: any) => { p.update?.(); return true; }, signal: AbortSignal.timeout(30000) });
console.log(JSON.stringify(p.getModels().map((m: any) => [m.id, m.name, m.contextWindow, m.reasoning, m.input])));
