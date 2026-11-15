import { describe, expect, test, vi } from 'vitest';
import { CodeAssistError, codeAssistUrl, IneligibleTierError, ProjectRequiredError, readProjectOverride, resolveProject, ValidationRequiredError } from './code-assist.ts';
import { CODE_ASSIST_BASE_URL, USER_AGENT } from './constants.ts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

function fakeCodeAssist(responses: (Response | object)[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers)),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected request');
    return next instanceof Response ? next : Response.json(next);
  });
  return { calls, fetchImpl };
}

const sleep = vi.fn(async () => undefined);

function resolve(fake: ReturnType<typeof fakeCodeAssist>, envProject?: string) {
  return resolveProject({ accessToken: 'tok-123', envProject, signal: new AbortController().signal, fetchImpl: fake.fetchImpl, sleep });
}

describe('readProjectOverride', () => {
  test('prefers GOOGLE_CLOUD_PROJECT over GOOGLE_CLOUD_PROJECT_ID', () => {
    expect(readProjectOverride({ GOOGLE_CLOUD_PROJECT: 'a', GOOGLE_CLOUD_PROJECT_ID: 'b' })).toBe('a');
    expect(readProjectOverride({ GOOGLE_CLOUD_PROJECT_ID: 'b' })).toBe('b');
  });

  test('treats blank values as unset', () => {
    expect(readProjectOverride({ GOOGLE_CLOUD_PROJECT: '  ', GOOGLE_CLOUD_PROJECT_ID: '' })).toBeUndefined();
  });

  test('rejects a numeric project number', () => {
    expect(() => readProjectOverride({ GOOGLE_CLOUD_PROJECT: '12345678' })).toThrow('project ID string, not its number');
  });
});

test('codeAssistUrl appends the method to the base url', () => {
  expect(codeAssistUrl('loadCodeAssist')).toBe(`${CODE_ASSIST_BASE_URL}:loadCodeAssist`);
});

describe('resolveProject for an onboarded account', () => {
  test('returns the server project and the paid tier', async () => {
    const fake = fakeCodeAssist([{ currentTier: { id: 'standard-tier', name: 'Standard' }, paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' }, cloudaicompanionProject: 'proj-server' }]);
    await expect(resolve(fake)).resolves.toEqual({ projectId: 'proj-server', tierId: 'g1-pro-tier', tierName: 'Google AI Pro' });
    expect(fake.calls).toHaveLength(1);
  });

  test('prefers the server project over the env project', async () => {
    const fake = fakeCodeAssist([{ currentTier: { id: 'standard-tier' }, cloudaicompanionProject: 'proj-server' }]);
    await expect(resolve(fake, 'proj-env')).resolves.toMatchObject({ projectId: 'proj-server' });
  });

  test('uses the env project when the server returns none', async () => {
    const fake = fakeCodeAssist([{ currentTier: { id: 'standard-tier' } }]);
    await expect(resolve(fake, 'proj-env')).resolves.toMatchObject({ projectId: 'proj-env' });
  });

  test('throws Google reason messages verbatim when the account is ineligible', async () => {
    const fake = fakeCodeAssist([{ currentTier: { id: 'free-tier' }, ineligibleTiers: [{ reasonMessage: 'Not available in your country' }, { reasonMessage: 'Second reason' }] }]);
    const failure = await resolve(fake).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IneligibleTierError);
    expect(failure).toHaveProperty('message', 'Not available in your country, Second reason');
  });

  test('throws ProjectRequiredError when nothing names a project', async () => {
    const fake = fakeCodeAssist([{ currentTier: { id: 'standard-tier' } }]);
    await expect(resolve(fake)).rejects.toBeInstanceOf(ProjectRequiredError);
  });

  test('sends the bearer token, JSON body, and client metadata', async () => {
    const fake = fakeCodeAssist([{ currentTier: { id: 'standard-tier' }, cloudaicompanionProject: 'p' }]);
    await resolve(fake, 'proj-env');
    expect(fake.calls[0]).toMatchObject({
      url: `${CODE_ASSIST_BASE_URL}:loadCodeAssist`,
      method: 'POST',
      headers: { authorization: 'Bearer tok-123', 'content-type': 'application/json' },
      body: { cloudaicompanionProject: 'proj-env', metadata: { ideType: 'ANTIGRAVITY', duetProject: 'proj-env' } },
    });
  });

  test('sends only the Antigravity ideType when no project is overridden', async () => {
    const fake = fakeCodeAssist([{ currentTier: { id: 'free-tier', name: 'Antigravity' }, paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' }, cloudaicompanionProject: 'aicode-consumers' }]);
    await expect(resolve(fake)).resolves.toEqual({ projectId: 'aicode-consumers', tierId: 'g1-pro-tier', tierName: 'Google AI Pro' });
    expect(fake.calls[0]?.body).toEqual({ metadata: { ideType: 'ANTIGRAVITY' } });
  });

  test('falls back to the current tier name when there is no paid tier', async () => {
    const fake = fakeCodeAssist([{ currentTier: { id: 'free-tier', name: 'Antigravity' }, cloudaicompanionProject: 'aicode-consumers' }]);
    await expect(resolve(fake)).resolves.toMatchObject({ tierName: 'Antigravity' });
  });
});

describe('resolveProject client identity', () => {
  test('sends the Antigravity User-Agent on every Code Assist request', async () => {
    const fake = fakeCodeAssist([{ allowedTiers: [{ id: 'standard-tier', isDefault: true }] }, { name: 'operations/op-1', done: false }, { done: true, response: { cloudaicompanionProject: { id: 'p' } } }]);
    await resolve(fake);
    expect(fake.calls.map((call) => call.method)).toEqual(['POST', 'POST', 'GET']);
    for (const call of fake.calls) expect(call.headers['user-agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^antigravity\/cli\/\S+ \(aidev_client; os_type=(darwin|linux|windows|\w+); arch=\w+; cl=\d+; auth_method=consumer\)$/);
  });
});

describe('resolveProject unsupported client', () => {
  test('surfaces Google reasonMessage verbatim and never onboards', async () => {
    const reasonMessage = 'This client is no longer supported. Please migrate to the Antigravity suite.';
    const fake = fakeCodeAssist([{ allowedTiers: [{ id: 'free-tier', isDefault: true }], ineligibleTiers: [{ reasonCode: 'UNSUPPORTED_CLIENT', reasonMessage }] }]);
    const failure = await resolve(fake).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IneligibleTierError);
    expect(failure).toHaveProperty('message', reasonMessage);
    expect(fake.calls).toHaveLength(1);
  });
});

describe('resolveProject validation', () => {
  test('throws ValidationRequiredError with Google text and link, and never onboards', async () => {
    const fake = fakeCodeAssist([{ ineligibleTiers: [{ reasonCode: 'VALIDATION_REQUIRED', reasonMessage: 'Verify your account.', validationUrl: 'https://accounts.google.com/validate' }] }]);
    const failure = await resolve(fake).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ValidationRequiredError);
    expect(failure).toHaveProperty('message', 'Verify your account. Validate at: https://accounts.google.com/validate');
    expect(fake.calls).toHaveLength(1);
  });
});

describe('resolveProject onboarding', () => {
  test('onboards into the default allowed tier and reads the project from the operation', async () => {
    const fake = fakeCodeAssist([
      {
        allowedTiers: [
          { id: 'free-tier', name: 'Free' },
          { id: 'standard-tier', name: 'Standard', isDefault: true },
        ],
      },
      { done: true, response: { cloudaicompanionProject: { id: 'proj-new' } } },
    ]);
    await expect(resolve(fake, 'proj-env')).resolves.toEqual({ projectId: 'proj-new', tierId: 'standard-tier', tierName: 'Standard' });
    expect(fake.calls[1]).toMatchObject({ url: `${CODE_ASSIST_BASE_URL}:onboardUser`, body: { tierId: 'standard-tier', cloudaicompanionProject: 'proj-env' } });
  });

  test('omits the project for the free tier', async () => {
    const fake = fakeCodeAssist([{ allowedTiers: [{ id: 'free-tier', name: 'Free', isDefault: true }] }, { done: true, response: { cloudaicompanionProject: { id: 'managed' } } }]);
    await resolve(fake, 'proj-env');
    expect(fake.calls[1]?.body).toEqual({ tierId: 'free-tier', metadata: { ideType: 'ANTIGRAVITY' } });
  });

  test('falls back to legacy-tier when no allowed tier is the default', async () => {
    const fake = fakeCodeAssist([{ allowedTiers: [{ id: 'standard-tier' }] }, { done: true, response: { cloudaicompanionProject: { id: 'p' } } }]);
    await expect(resolve(fake)).resolves.toMatchObject({ tierId: 'legacy-tier' });
    expect(fake.calls[1]?.body).toMatchObject({ tierId: 'legacy-tier' });
  });

  test('polls the operation every five seconds until it is done', async () => {
    sleep.mockClear();
    const fake = fakeCodeAssist([
      { allowedTiers: [{ id: 'standard-tier', isDefault: true }] },
      { name: 'operations/op-1', done: false },
      { name: 'operations/op-1', done: false },
      { done: true, response: { cloudaicompanionProject: { id: 'proj-lro' } } },
    ]);
    await expect(resolve(fake)).resolves.toMatchObject({ projectId: 'proj-lro' });
    expect(fake.calls.slice(2).map((call) => [call.method, call.url])).toEqual([
      ['GET', `${CODE_ASSIST_BASE_URL}/operations/op-1`],
      ['GET', `${CODE_ASSIST_BASE_URL}/operations/op-1`],
    ]);
    expect(sleep.mock.calls).toEqual([[5000], [5000]]);
  });

  test('gives up after 60 polls', async () => {
    sleep.mockClear();
    const pending = { name: 'operations/op-1', done: false };
    const fake = fakeCodeAssist([{ allowedTiers: [{ id: 'standard-tier', isDefault: true }] }, pending, ...Array.from({ length: 60 }, () => pending)]);
    await expect(resolve(fake)).rejects.toThrow('did not finish in time');
    expect(sleep).toHaveBeenCalledTimes(60);
  });

  test('throws the message of a failed operation', async () => {
    const fake = fakeCodeAssist([{ allowedTiers: [{ id: 'standard-tier', isDefault: true }] }, { done: true, error: { message: 'Quota exhausted' } }]);
    await expect(resolve(fake)).rejects.toThrow('Quota exhausted');
  });

  test('falls back to the env project when onboarding returns none', async () => {
    const fake = fakeCodeAssist([{ allowedTiers: [{ id: 'standard-tier', isDefault: true }] }, { done: true, response: {} }]);
    await expect(resolve(fake, 'proj-env')).resolves.toMatchObject({ projectId: 'proj-env' });
  });
});

describe('resolveProject failures', () => {
  test('throws Google error.message for a non-2xx response without retrying', async () => {
    const fake = fakeCodeAssist([Response.json({ error: { message: 'Permission denied on project' } }, { status: 403 })]);
    const failure = await resolve(fake).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CodeAssistError);
    expect(failure).toHaveProperty('message', 'Permission denied on project');
    expect(fake.fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('names the status when the error body has no message', async () => {
    const fake = fakeCodeAssist([new Response('<html>oops</html>', { status: 502 })]);
    await expect(resolve(fake)).rejects.toThrow('HTTP 502');
  });

  test('does not put the access token in an error message', async () => {
    const fake = fakeCodeAssist([new Response('boom', { status: 500 })]);
    const failure = await resolve(fake).catch((error: unknown) => error);
    expect(String(failure)).not.toContain('tok-123');
  });
});
