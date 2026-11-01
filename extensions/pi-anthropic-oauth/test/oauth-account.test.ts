import { expect, vi } from 'vitest';
import { createOAuthApiKey, fetchOAuthProfile, fetchOAuthRoles, validateOAuthToken } from '../src/oauth-account.ts';
import { test } from './network-guard.ts';

function stub(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const PROFILE = { account: { uuid: 'a', email: 'a@x.test', extra: 1 }, organization: { uuid: 'o' } };

test('the profile is a Bearer GET with the account user agent and a request-id stamp', async () => {
  const fetchMock = stub(new Response(JSON.stringify(PROFILE), { status: 200, headers: { 'request-id': 'req_profile' } }));
  const result = await fetchOAuthProfile('tok');
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(String(url)).toBe('https://api.anthropic.com/api/oauth/profile');
  expect(init?.method).toBe('GET');
  expect(init?.headers).toStrictEqual({ 'User-Agent': 'claude-code/2.1.316', Authorization: 'Bearer tok', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  expect(result).toStrictEqual({ profile: PROFILE, stamped: true });
});

test('a profile without a request id is not stamped', async () => {
  stub(new Response(JSON.stringify(PROFILE), { status: 200 }));
  await expect(fetchOAuthProfile('tok')).resolves.toMatchObject({ stamped: false });
});

test('a profile body that fails the shape check is rejected', async () => {
  stub(new Response(JSON.stringify({ account: { uuid: 'a' } }), { status: 200 }));
  await expect(fetchOAuthProfile('tok')).rejects.toThrow('OAuth profile: response body failed shape validation');
});

test('a profile HTTP failure names the OAuth token path', async () => {
  stub(new Response('no', { status: 401, statusText: 'Unauthorized' }));
  await expect(fetchOAuthProfile('tok')).rejects.toThrow('Failed to fetch oauth profile from OAuth token: 401 Unauthorized');
});

test('validate POSTs with a Bearer token and returns the body', async () => {
  const fetchMock = stub(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  await expect(validateOAuthToken('tok', { apiBaseUrl: 'https://claude.fedstart.com' })).resolves.toStrictEqual({ ok: true });
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(String(url)).toBe('https://claude.fedstart.com/api/oauth/validate');
  expect(init?.method).toBe('POST');
  expect(init?.headers).toStrictEqual({ 'User-Agent': 'claude-code/2.1.316', Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
});

test('validate rejects a failing status with Claude wording', async () => {
  stub(new Response('no', { status: 403, statusText: 'Forbidden' }));
  await expect(validateOAuthToken('tok')).rejects.toThrow('Failed to validate OAuth token: 403 Forbidden');
});

test('roles reads the organization and workspace roles', async () => {
  const fetchMock = stub(new Response(JSON.stringify({ organization_role: 'admin', workspace_role: null, organization_name: 'Org' }), { status: 200 }));
  await expect(fetchOAuthRoles('tok')).resolves.toStrictEqual({ organization_role: 'admin', workspace_role: null, organization_name: 'Org' });
  const call = fetchMock.mock.calls[0];
  expect(String(call?.[0])).toBe('https://api.anthropic.com/api/oauth/claude_cli/roles');
  expect(call?.[1]?.headers).toStrictEqual({ 'User-Agent': 'claude-code/2.1.316', Authorization: 'Bearer tok' });
});

test('roles rejects a non-200 with Claude wording', async () => {
  stub(new Response('x', { status: 500, statusText: 'Server Error' }));
  await expect(fetchOAuthRoles('tok')).rejects.toThrow('Failed to fetch user roles: Server Error');
});

test('create-api-key returns raw_key and null for an empty body', async () => {
  stub(new Response(JSON.stringify({ raw_key: 'sk-ant-api03-x' }), { status: 200 }));
  await expect(createOAuthApiKey('tok')).resolves.toBe('sk-ant-api03-x');
  stub(new Response(JSON.stringify({}), { status: 200 }));
  await expect(createOAuthApiKey('tok')).resolves.toBeNull();
});
