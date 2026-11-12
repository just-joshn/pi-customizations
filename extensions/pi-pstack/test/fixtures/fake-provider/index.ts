// Test-only Pi package: two providers whose reply is the credential they authenticated with, so a test sees exactly what
// reached the process. `pstack-fake-oauth` authenticates from an OAuth credential, `pstack-fake-key` from an api_key one.
// An OAuth refresh records the refresh token it was given in the worker directory and then fails, as a refresh without
// network access or without a refresh token does.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ApiKeyCredential, fauxAssistantMessage, fauxProvider, type OAuthCredential, type ProviderAuth } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const apiKey: ProviderAuth['apiKey'] = {
  name: 'Fake key',
  resolve: async ({ credential }: { credential?: ApiKeyCredential }) => (credential?.key === undefined ? undefined : { auth: { apiKey: credential.key }, source: 'stored credential' }),
};

const oauth: ProviderAuth['oauth'] = {
  name: 'Fake OAuth',
  login: async () => {
    throw new Error('no login in a test');
  },
  refresh: async (credential: OAuthCredential) => {
    const dir = join(process.env['PSTACK_RUN_ROOT'] ?? '/tmp', 'workers', process.env['PSTACK_WORKER_ID'] ?? '');
    writeFileSync(join(dir, 'refresh-attempt.json'), JSON.stringify({ refresh: credential.refresh }));
    throw new Error('fake refresh refused');
  },
  toAuth: async (credential: OAuthCredential) => ({ apiKey: `fake-at:${credential.access}` }),
};

export default function fakeProviders(pi: ExtensionAPI): void {
  for (const id of ['pstack-fake-oauth', 'pstack-fake-key']) {
    const handle = fauxProvider({ provider: id, models: [{ id: 'm' }] });
    const answer = (_context: unknown, options: { apiKey?: string } | undefined) => {
      handle.appendResponses([answer]);
      let stored: unknown = null;
      try {
        stored = JSON.parse(readFileSync(join(process.env['PI_CODING_AGENT_DIR'] ?? '', 'auth.json'), 'utf8'));
      } catch {
        // No auth.json in this worker's agent directory.
      }
      return fauxAssistantMessage(JSON.stringify({ apiKey: options?.apiKey ?? null, stored }));
    };
    handle.setResponses([answer]);
    pi.registerProvider({ ...handle.provider, auth: id === 'pstack-fake-oauth' ? { oauth, apiKey } : { apiKey } } as typeof handle.provider);
  }
}
