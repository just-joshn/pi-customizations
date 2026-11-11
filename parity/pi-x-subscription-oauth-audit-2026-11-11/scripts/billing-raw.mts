import { fetchPlanUsage } from '../../../extensions/pi-x-subscription-oauth/src/usage.ts';
import { storedCredential } from './audit-env.mts';

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

let raw: { status: number; body: unknown } | undefined;
await fetchPlanUsage(storedCredential('grok-build').access, {
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    raw = { status: response.status, body: parsed(await response.clone().text()) };
    return response;
  },
}).catch(() => {});
if (!raw) throw new Error('fetchPlanUsage sent no request.');
console.log(JSON.stringify(raw, null, 1));
