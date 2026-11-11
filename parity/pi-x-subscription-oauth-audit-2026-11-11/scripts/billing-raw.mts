import { PROXY_BASE_URL } from '../../../extensions/pi-x-subscription-oauth/src/catalog.ts';
import { GROK_CLIENT_VERSION } from '../../../extensions/pi-x-subscription-oauth/src/request.ts';
import { storedCredential } from './audit-env.mts';

// Same request usage.ts sends. Prints the raw JSON so /usage output can be checked against it.
const response = await fetch(`${PROXY_BASE_URL}/billing?format=credits`, {
  headers: {
    Authorization: `Bearer ${storedCredential('grok-build').access}`,
    'X-XAI-Token-Auth': 'xai-grok-cli',
    Accept: 'application/json',
    'x-grok-client-version': GROK_CLIENT_VERSION,
  },
  redirect: 'error',
  signal: AbortSignal.timeout(30_000),
});
console.log(JSON.stringify({ status: response.status, body: await response.json() }, null, 1));
