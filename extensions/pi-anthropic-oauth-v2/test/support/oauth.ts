import { CLIENT_ID, REDIRECT_URI } from './constants.ts';

export const tokenResponse = (body: unknown, ok = true) => ({ ok, json: async () => body, text: async () => JSON.stringify(body) });

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const expectedAuthorizeParams = (verifier: string, challenge: string) => ({
  code: 'true',
  client_id: CLIENT_ID,
  response_type: 'code',
  redirect_uri: REDIRECT_URI,
  scope: 'org:create_api_key user:profile user:inference',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: verifier,
});

export const expectedAuthorizationGrant = (verifier: string) => ({
  grant_type: 'authorization_code',
  client_id: CLIENT_ID,
  code: 'the-code',
  state: 'the-state',
  redirect_uri: REDIRECT_URI,
  code_verifier: verifier,
});
