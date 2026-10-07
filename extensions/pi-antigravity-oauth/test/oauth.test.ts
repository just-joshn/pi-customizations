import { createHash } from 'node:crypto';

import type { AuthEvent, AuthPrompt, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { expect, vi } from 'vitest';
import { parseApiKey } from '../src/cloudcode.ts';
import { createAntigravityOAuth, fetchEmail, GOOGLE_OAUTH, type OAuthEndpoints, parseCredential, projectFromLoadCodeAssist } from '../src/oauth.ts';
import { type FakeServer, fakeServer, json } from './fake-server.ts';
import { test } from './network-guard.ts';

async function google(project: unknown = { cloudaicompanionProject: 'aicode-consumers' }): Promise<FakeServer> {
  return fakeServer((request, res) => {
    if (request.path === '/token') {
      const form = new URLSearchParams(request.body);
      if (form.get('grant_type') === 'refresh_token') return json(res, 200, { access_token: 'ya29.refreshed', expires_in: 3600 });
      return json(res, 200, { access_token: 'ya29.first', refresh_token: '1//refresh', expires_in: 3600 });
    }
    if (request.path === '/userinfo') return json(res, 200, { email: 'dev@example.com' });
    if (request.path === '/cc/v1internal:loadCodeAssist') return json(res, 200, project);
    return json(res, 404, {});
  });
}

function endpoints(server: FakeServer): OAuthEndpoints {
  return { authUrl: `${server.url}/auth`, tokenUrl: `${server.url}/token`, userInfoUrl: `${server.url}/userinfo`, cloudCode: `${server.url}/cc` };
}

function interaction(answer: (authUrl: URL, prompt: AuthPrompt) => Promise<string>): { value: ProviderAuthInteraction; events: AuthEvent[] } {
  const events: AuthEvent[] = [];
  return {
    events,
    value: {
      signal: new AbortController().signal,
      notify: (event) => events.push(event),
      prompt: (prompt) => {
        const authEvent = events.find((event) => event.type === 'auth_url');
        return answer(new URL(authEvent?.type === 'auth_url' ? authEvent.url : ''), prompt);
      },
    },
  };
}

const pasteCode = () => interaction(async () => '  4/0Ab-code  ');

test('login sends the Antigravity CLI authorization URL', async () => {
  const server = await google();
  try {
    const flow = interaction(async () => 'code');
    await createAntigravityOAuth(endpoints(server)).login(flow.value);
    const authUrl = new URL((flow.events[0] as { url: string }).url);
    expect(authUrl.origin + authUrl.pathname).toBe(`${server.url}/auth`);
    expect([...authUrl.searchParams.keys()]).toEqual(['access_type', 'client_id', 'code_challenge', 'code_challenge_method', 'prompt', 'redirect_uri', 'response_type', 'scope', 'state']);
    expect(authUrl.searchParams.get('client_id')).toBe('1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://antigravity.google/oauth-callback');
    expect(authUrl.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs https://www.googleapis.com/auth/aicode openid',
    );
    expect(authUrl.searchParams.get('access_type')).toBe('offline');
    expect(authUrl.searchParams.get('prompt')).toBe('consent');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('state')).toMatch(/^[\w-]{22}$/);
  } finally {
    server.close();
  }
});

test('the production endpoints match the Antigravity CLI', () => {
  expect(GOOGLE_OAUTH).toEqual({
    authUrl: 'https://accounts.google.com/o/oauth2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    cloudCode: 'https://daily-cloudcode-pa.googleapis.com',
  });
});

test('login asks for the pasted authorization code and exchanges it with PKCE', async () => {
  const server = await google();
  try {
    const prompts: AuthPrompt[] = [];
    const flow = interaction(async (_, prompt) => {
      prompts.push(prompt);
      return '  4/0Ab-code  ';
    });
    const before = Date.now();
    const credential = await createAntigravityOAuth(endpoints(server)).login(flow.value);
    expect(prompts.map((prompt) => prompt.type)).toEqual(['manual_code']);
    const authUrl = new URL((flow.events[0] as { url: string }).url);
    const form = new URLSearchParams(server.requests.find((request) => request.path === '/token')?.body);
    expect([...form.keys()]).toEqual(['code', 'code_verifier', 'grant_type', 'redirect_uri', 'client_id', 'client_secret']);
    expect(form.get('code')).toBe('4/0Ab-code');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('redirect_uri')).toBe('https://antigravity.google/oauth-callback');
    expect(
      createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url'),
    ).toBe(authUrl.searchParams.get('code_challenge'));
    expect(credential).toMatchObject({ type: 'oauth', access: 'ya29.first', refresh: '1//refresh', projectId: 'aicode-consumers', email: 'dev@example.com' });
    expect(credential.expires).toBeGreaterThanOrEqual(before + 3590 * 1000);
    expect(credential.expires).toBeLessThanOrEqual(Date.now() + 3590 * 1000);
  } finally {
    server.close();
  }
});

test('login reads the project with the CLI loadCodeAssist body and the email from userinfo', async () => {
  const server = await google({ cloudaicompanionProject: { id: 'companion-42' } });
  try {
    const credential = await createAntigravityOAuth(endpoints(server)).login(pasteCode().value);
    const load = server.requests.find((request) => request.path.endsWith('loadCodeAssist'));
    expect(load?.body).toBe('{"metadata":{"ideType":"ANTIGRAVITY"}}');
    expect(load?.headers.authorization).toBe('Bearer ya29.first');
    expect(server.requests.find((request) => request.path === '/userinfo')?.headers.authorization).toBe('Bearer ya29.first');
    expect(credential['projectId']).toBe('companion-42');
  } finally {
    server.close();
  }
});

test('login fails when Cloud Code names no project', async () => {
  const server = await google({});
  try {
    await expect(createAntigravityOAuth(endpoints(server)).login(pasteCode().value)).rejects.toThrow('Cloud Code named no Antigravity project for this account. Sign in once with the Antigravity CLI, then run /login again.');
  } finally {
    server.close();
  }
});

test('login surfaces a failed project lookup', async () => {
  const server = await fakeServer((request, res) => {
    if (request.path === '/token') return json(res, 200, { access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    return json(res, 500, { error: { message: 'boom' } });
  });
  try {
    await expect(createAntigravityOAuth(endpoints(server)).login(pasteCode().value)).rejects.toThrow('loadCodeAssist failed (500): boom');
  } finally {
    server.close();
  }
});

test('an empty pasted code is rejected before any request', async () => {
  const server = await google();
  try {
    await expect(createAntigravityOAuth(endpoints(server)).login(interaction(async () => '   ').value)).rejects.toThrow('Missing authorization code');
    expect(server.requests).toHaveLength(0);
  } finally {
    server.close();
  }
});

test('login fails when Google returns no refresh token', async () => {
  const server = await fakeServer((_, res) => json(res, 200, { access_token: 'ya29.first', expires_in: 3600 }));
  try {
    await expect(createAntigravityOAuth(endpoints(server)).login(pasteCode().value)).rejects.toThrow('Google returned no refresh token. Try /login again.');
  } finally {
    server.close();
  }
});

test('refresh keeps the refresh token and project when Google omits a new refresh token', async () => {
  const server = await google();
  try {
    const stored: OAuthCredential = { type: 'oauth', access: 'ya29.old', refresh: '1//refresh', expires: 0, projectId: 'companion-42', email: 'dev@example.com' };
    const refreshed = await createAntigravityOAuth(endpoints(server)).refresh(stored, new AbortController().signal);
    const form = new URLSearchParams(server.requests[0]?.body);
    expect([...form.entries()]).toEqual([
      ['grant_type', 'refresh_token'],
      ['refresh_token', '1//refresh'],
      ['client_id', '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'],
      // biome-ignore lint/security/noSecrets: public installed-app credential, not a confidential secret
      ['client_secret', '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'],
    ]);
    expect(refreshed).toMatchObject({ access: 'ya29.refreshed', refresh: '1//refresh', projectId: 'companion-42', email: 'dev@example.com' });
  } finally {
    server.close();
  }
});

test('a refreshed token expires ten seconds before Google says, like golang.org/x/oauth2', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const server = await google();
  try {
    const stored: OAuthCredential = { type: 'oauth', access: 'a', refresh: 'r', expires: 0, projectId: 'p' };
    const refreshed = await createAntigravityOAuth(endpoints(server)).refresh(stored, new AbortController().signal);
    expect(refreshed.expires).toBe(Date.parse('2026-01-01T00:59:50Z'));
  } finally {
    server.close();
  }
});

test("a failed refresh surfaces Google's error", async () => {
  const server = await fakeServer((_, res) => json(res, 400, { error: 'invalid_grant' }));
  try {
    const stored: OAuthCredential = { type: 'oauth', access: 'a', refresh: 'r', expires: 0, projectId: 'p' };
    await expect(createAntigravityOAuth(endpoints(server)).refresh(stored, new AbortController().signal)).rejects.toThrow('Google token request failed (400): {"error":"invalid_grant"}');
  } finally {
    server.close();
  }
});

test('a token response without an access token is rejected', async () => {
  const server = await fakeServer((_, res) => json(res, 200, { expires_in: 3600 }));
  try {
    const stored: OAuthCredential = { type: 'oauth', access: 'a', refresh: 'r', expires: 0, projectId: 'p' };
    await expect(createAntigravityOAuth(endpoints(server)).refresh(stored, new AbortController().signal)).rejects.toThrow('Google token response lacks an access token');
  } finally {
    server.close();
  }
});

test('refresh refuses a credential without a project', async () => {
  const stored: OAuthCredential = { type: 'oauth', access: 'a', refresh: 'r', expires: 0 };
  await expect(createAntigravityOAuth().refresh(stored, new AbortController().signal)).rejects.toThrow('Google Antigravity credentials lack a project. Run /login and choose Google Antigravity.');
});

test('toAuth encodes the token and project that the stream parses back', async () => {
  const auth = await createAntigravityOAuth().toAuth({ type: 'oauth', access: 'ya29.x', refresh: 'r', expires: 0, projectId: 'p1' });
  expect(auth.apiKey).toBe('{"token":"ya29.x","projectId":"p1"}');
  expect(parseApiKey(auth.apiKey)).toEqual({ token: 'ya29.x', projectId: 'p1' });
});

test('a credential without a project id asks for a new login', () => {
  expect(() => parseCredential({ type: 'oauth', access: 'a', refresh: 'r', expires: 0 })).toThrow('Google Antigravity credentials lack a project. Run /login and choose Google Antigravity.');
});

test('an unparseable api key asks for a new login', () => {
  expect(() => parseApiKey('not json')).toThrow('Google Antigravity credentials are not readable. Run /login and choose Google Antigravity.');
});

test('an api key without a token or project asks for a new login', () => {
  expect(() => parseApiKey('{"token":"t"}')).toThrow('Google Antigravity credentials lack a token or project. Run /login and choose Google Antigravity.');
});

test.for([{ status: 500 }, { status: 200 }])('fetchEmail returns nothing for an empty HTTP $status userinfo body', async ({ status }) => {
  const server = await fakeServer((_, res) => json(res, status, {}));
  try {
    expect(await fetchEmail(`${server.url}/userinfo`, 't')).toBeUndefined();
    expect(server.requests).toMatchObject([{ method: 'GET', path: '/userinfo', headers: { authorization: 'Bearer t' }, body: '' }]);
  } finally {
    server.close();
  }
});

test('fetchEmail returns nothing when the request itself fails', async () => {
  expect(await fetchEmail('http://127.0.0.1:1/userinfo', 't')).toBe(undefined);
});

test.for([
  { name: 'a string project', body: { cloudaicompanionProject: 'p1' }, expected: 'p1' },
  { name: 'a nested project id', body: { cloudaicompanionProject: { id: 'p2' } }, expected: 'p2' },
  { name: 'an empty project object', body: { cloudaicompanionProject: {} }, expected: undefined },
  { name: 'a null body', body: null, expected: undefined },
])('project discovery reads $name', ({ body, expected }) => {
  expect(projectFromLoadCodeAssist(body)).toBe(expected);
});
