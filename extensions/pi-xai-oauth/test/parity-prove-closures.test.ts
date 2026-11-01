import { readFileSync } from 'node:fs';

import { expect } from 'vitest';
import { GROK_OAUTH_CLIENT_ID } from '../src/login.ts';
import { GROK_CLIENT_VERSION, grokHeaders } from '../src/request.ts';
import { test } from './network-guard.ts';

type Probe = {
  readonly name: string;
  readonly status: number;
  readonly clientVersionSent?: string;
};

type ResponsesFixture = {
  readonly minimumClientVersion: string;
  readonly piHeaders: Record<string, string>;
  readonly authGateProbes: readonly Probe[];
  readonly conclusions: {
    readonly speculativeHeadersNotRequired: boolean;
    readonly piCurrentSetAccepted: boolean;
    readonly wrongTokenAuthRejects: boolean;
  };
};

type RefreshFixture = {
  readonly requestFieldNames: readonly string[];
  readonly requestFields: {
    readonly grant_type: string;
    readonly client_id: string;
  };
  readonly response: {
    readonly status: number;
    readonly bodyKeys: readonly string[];
    readonly expires_in: number;
  };
};

const responses = JSON.parse(readFileSync(new URL('./fixtures/responses-headers-1.0.70.json', import.meta.url), 'utf8')) as ResponsesFixture;
const refresh = JSON.parse(readFileSync(new URL('./fixtures/refresh-token-1.0.70.json', import.meta.url), 'utf8')) as RefreshFixture;

function probe(name: string): Probe {
  const row = responses.authGateProbes.find((entry) => entry.name === name);
  if (!row) throw new Error(`missing probe ${name}`);
  return row;
}

test('responses live capture accepts the Pi header set without speculative extras', () => {
  expect(probe('pi_full_headers').status).toBe(200);
  expect(probe('bearer_and_version_only').status).toBe(200);
  expect(probe('missing_token_auth').status).toBe(200);
  expect(probe('missing_model_override').status).toBe(200);
  expect(probe('missing_context_window').status).toBe(200);
  expect(responses.conclusions.speculativeHeadersNotRequired).toBe(true);
  expect(responses.conclusions.piCurrentSetAccepted).toBe(true);
});

test('responses reject a missing client version and a wrong token-auth value', () => {
  expect(probe('missing_version').status).toBe(426);
  expect(probe('bearer_only').status).toBe(426);
  expect(probe('wrong_token_auth').status).toBe(401);
  expect(responses.conclusions.wrongTokenAuthRejects).toBe(true);
});

test('responses enforce the 1.0.13 client-version floor while 1.0.70 clears it', () => {
  expect(probe('version_1.0.12').status).toBe(426);
  expect(probe('version_1.0.13').status).toBe(200);
  expect(probe('version_1.0.70').status).toBe(200);
  expect(responses.minimumClientVersion).toBe('1.0.13');
  expect(GROK_CLIENT_VERSION).toBe(responses.piHeaders['x-grok-client-version']);
  expect(GROK_CLIENT_VERSION).toBe('1.0.70');
});

test('grokHeaders still emit the measured Pi identity set', () => {
  const headers = grokHeaders({ id: 'grok-4.7', contextWindow: 256000 }, undefined);
  expect(headers['x-grok-client-version']).toBe(GROK_CLIENT_VERSION);
  expect(headers['X-XAI-Token-Auth']).toBe(responses.piHeaders['X-XAI-Token-Auth']);
  expect(headers['x-grok-model-override']).toBe('grok-4.7');
  expect(headers['x-grok-context-window']).toBe('256000');
  expect(Object.keys(headers)).toStrictEqual(['x-grok-client-version', 'X-XAI-Token-Auth', 'x-grok-model-override', 'x-grok-context-window']);
});

// This test reads the copied capture only. This package does not post a refresh grant.
// provider.test.ts asserts createGrokBuildProvider keeps the xAI client's refresh. That function is refreshXaiToken in @earendil-works/pi-ai.
test('copied refresh fixture records the live public PKCE form', () => {
  expect(refresh.response.status).toBe(200);
  expect(refresh.requestFieldNames).toStrictEqual(['grant_type', 'client_id', 'refresh_token']);
  expect(refresh.requestFields.grant_type).toBe('refresh_token');
  expect(refresh.requestFields.client_id).toBe(GROK_OAUTH_CLIENT_ID);
  expect(refresh.requestFieldNames.includes('client_secret')).toBe(false);
  expect(refresh.response.bodyKeys).toStrictEqual(['access_token', 'expires_in', 'refresh_token', 'scope', 'token_type']);
  expect(refresh.response.expires_in).toBe(21600);
});
