import { fetchPlanUsage } from '../../../extensions/pi-x-subscription-oauth/src/usage.ts';
import { storedCredential } from './audit-env.mts';

let raw: { status: number; body: unknown } | undefined;
await fetchPlanUsage(storedCredential('grok-build').access, {
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    raw = { status: response.status, body: await response.clone().json() };
    return response;
  },
});
console.log(JSON.stringify(raw, null, 1));
