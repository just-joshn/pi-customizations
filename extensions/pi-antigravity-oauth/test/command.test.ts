import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { expect, vi } from 'vitest';
import { createAntigravityCommand, fetchAccountSummary, formatAccountSummary, parseQuotaSummary } from '../src/command.ts';
import { fakeServer, json } from './fake-server.ts';
import { test } from './network-guard.ts';

const API_KEY = JSON.stringify({ token: 'ya29.t', projectId: 'proj-9' });

async function cloudCode() {
  return fakeServer((request, res) => {
    if (request.path === '/userinfo') return json(res, 200, { email: 'dev@example.com' });
    if (request.path === '/v1internal:loadCodeAssist') {
      return json(res, 200, { currentTier: { id: 'free-tier', name: 'Free' }, paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' } });
    }
    return json(res, 200, {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            { bucketId: 'gemini-weekly', displayName: 'Weekly Limit Remaining', window: 'weekly', resetTime: '2026-01-05T00:00:00Z', remainingFraction: 1 },
            { bucketId: 'gemini-5h', displayName: 'Five Hour Limit Remaining', window: '5h', resetTime: '2026-01-01T02:30:00Z', remainingFraction: 0.75 },
          ],
        },
        { displayName: 'Claude and GPT models', buckets: [{ displayName: 'Weekly Limit Remaining' }] },
      ],
    });
  });
}

test('the account summary shows email, project, paid tier, and the quota groups the CLI reads', async () => {
  const server = await cloudCode();
  try {
    const summary = await fetchAccountSummary(API_KEY, { cloudCode: server.url, userInfoUrl: `${server.url}/userinfo` });
    const quotaRequest = server.requests.find((request) => request.path === '/v1internal:retrieveUserQuotaSummary');
    expect(quotaRequest?.body).toBe('{"project":"proj-9"}');
    expect(formatAccountSummary(summary, Date.parse('2026-01-01T00:00:00Z'))).toBe(
      [
        'Account: dev@example.com',
        'Project: proj-9',
        'Tier: Google AI Pro (g1-pro-tier)',
        'Quota:',
        '  Gemini Models:',
        '    Weekly Limit Remaining: 100% left, resets in 96h 0m',
        '    Five Hour Limit Remaining: 75% left, resets in 2h 30m',
        '  Claude and GPT models:',
        '    Weekly Limit Remaining: unknown',
      ].join('\n'),
    );
  } finally {
    server.close();
  }
});

test("without a UI the command writes plain text to stderr using the registry's refreshed credential", async () => {
  const server = await cloudCode();
  const written: string[] = [];
  const printed: string[] = [];
  try {
    let askedFor = '';
    const ctx = {
      hasUI: false,
      modelRegistry: {
        getApiKeyForProvider: async (provider: string) => {
          askedFor = provider;
          return API_KEY;
        },
      },
    } as unknown as ExtensionCommandContext;
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string' && chunk.startsWith('Account:')) {
        written.push(chunk);
      }
      return true;
    }) as typeof process.stderr.write);
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string' && chunk.startsWith('Account:')) {
        printed.push(chunk);
      }
      return true;
    }) as typeof process.stdout.write);
    await createAntigravityCommand({ cloudCode: server.url, userInfoUrl: `${server.url}/userinfo` }).handler('', ctx);
    expect(askedFor).toBe('google-antigravity');
    expect(printed).toEqual([]);
    expect(written.length).toBe(1);
    expect(written[0]).toMatch(/^Account: dev@example.com\nProject: proj-9\nTier: Google AI Pro \(g1-pro-tier\)\nQuota:\n/);
  } finally {
    server.close();
  }
});

test('with a UI and no login the command tells the user to log in', async () => {
  const notes: [string, string | undefined][] = [];
  const ctx = {
    hasUI: true,
    ui: { notify: (message: string, level?: string) => notes.push([message, level]) },
    modelRegistry: { getApiKeyForProvider: async () => undefined },
  } as unknown as ExtensionCommandContext;
  await createAntigravityCommand({ cloudCode: '', userInfoUrl: '' }).handler('', ctx);
  expect(notes).toEqual([['Google Antigravity is not logged in. Run /login and choose Google Antigravity.', 'error']]);
});

test('a summary without an email or tier reports unknown', () => {
  expect(formatAccountSummary({ projectId: 'p', quota: [] })).toBe(['Account: unknown', 'Project: p', 'Tier: unknown', 'Quota:', '  no quota returned'].join('\n'));
});

test('a summary whose quota lookup failed reports the failure', () => {
  expect(formatAccountSummary({ projectId: 'p', quota: [], quotaError: 'denied' })).toBe(['Account: unknown', 'Project: p', 'Tier: unknown', 'Quota:', '  unavailable: denied'].join('\n'));
});

test('the account summary reads a tier that carries only an id', async () => {
  const server = await fakeServer((request, res) => {
    if (request.path === '/userinfo') return json(res, 200, { email: 'dev@example.com' });
    if (request.path === '/v1internal:loadCodeAssist') return json(res, 200, { paidTier: { id: 'legacy' } });
    return json(res, 200, { groups: [] });
  });
  try {
    const summary = await fetchAccountSummary(API_KEY, { cloudCode: server.url, userInfoUrl: `${server.url}/userinfo` });
    expect(summary.tier).toBe('legacy');
  } finally {
    server.close();
  }
});

test('the account summary reads a tier that carries only a name', async () => {
  const server = await fakeServer((request, res) => {
    if (request.path === '/userinfo') return json(res, 200, { email: 'dev@example.com' });
    if (request.path === '/v1internal:loadCodeAssist') return json(res, 200, { currentTier: { name: 'Plus' } });
    return json(res, 200, { groups: [] });
  });
  try {
    const summary = await fetchAccountSummary(API_KEY, { cloudCode: server.url, userInfoUrl: `${server.url}/userinfo` });
    expect(summary.tier).toBe('Plus');
  } finally {
    server.close();
  }
});

test('the account summary reports no tier for an empty loadCodeAssist body', async () => {
  const server = await fakeServer((request, res) => {
    if (request.path === '/userinfo') return json(res, 200, { email: 'dev@example.com' });
    if (request.path === '/v1internal:loadCodeAssist') return json(res, 200, null);
    return json(res, 200, { groups: [] });
  });
  try {
    const summary = await fetchAccountSummary(API_KEY, { cloudCode: server.url, userInfoUrl: `${server.url}/userinfo` });
    expect(summary.tier).toBe(undefined);
  } finally {
    server.close();
  }
});

test('a failed quota lookup is reported instead of failing the summary', async () => {
  const server = await fakeServer((request, res) => {
    if (request.path === '/userinfo') return json(res, 200, { email: 'dev@example.com' });
    if (request.path === '/v1internal:loadCodeAssist') return json(res, 200, {});
    return json(res, 500, { error: { message: 'denied' } });
  });
  try {
    const summary = await fetchAccountSummary(API_KEY, { cloudCode: server.url, userInfoUrl: `${server.url}/userinfo` });
    expect(summary.quotaError).toBe('retrieveUserQuotaSummary failed (500): denied');
    expect(summary.quota).toEqual([]);
  } finally {
    server.close();
  }
});

test('with a UI the command reports a credential error', async () => {
  const notes: [string, string | undefined][] = [];
  const ctx = {
    hasUI: true,
    ui: { notify: (message: string, level?: string) => notes.push([message, level]) },
    modelRegistry: { getApiKeyForProvider: async () => 'not json' },
  } as unknown as ExtensionCommandContext;
  await createAntigravityCommand({ cloudCode: '', userInfoUrl: '' }).handler('', ctx);
  expect(notes).toEqual([['Google Antigravity credentials are not readable. Run /login and choose Google Antigravity.', 'error']]);
});

test.for([
  { name: 'a null body', body: null, expected: [] },
  { name: 'a group without names or buckets', body: { groups: [{}] }, expected: [{ displayName: 'Models', buckets: [] }] },
  { name: 'a bucket without fields', body: { groups: [{ buckets: [{}] }] }, expected: [{ displayName: 'Models', buckets: [{ displayName: 'Limit', remainingFraction: undefined, resetTime: undefined }] }] },
])('parseQuotaSummary reads $name', ({ body, expected }) => {
  expect(parseQuotaSummary(body)).toEqual(expected);
});
