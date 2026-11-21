import { afterEach, describe, expect, test, vi } from 'vitest';
import { CODE_ASSIST_BASE_URL, HTTP_BAD_GATEWAY, HTTP_FORBIDDEN, HTTP_INTERNAL_ERROR, MAX_POLLS, POLL_INTERVAL_MS, ROUTE_LOAD, ROUTE_ONBOARD, ROUTE_OPERATION } from './constants.ts';
import { json, type Routes } from './google.ts';
import { beginLogin, type LoginOptions, type LoginSession, signInByPaste } from './login-driver.ts';

const VALIDATION_URL = 'https://accounts.google.com/validate';
const USER_AGENT = /^antigravity\/cli\/\S+ \(aidev_client; os_type=\w+; arch=\w+; cl=\d+; auth_method=consumer\)$/;
const OPERATION = { name: 'operations/op-1', done: false };
const STANDARD_ONBOARDING = { allowedTiers: [{ id: 'standard-tier', isDefault: true }] };
const onboarded = (id: string) => ({ done: true, response: { cloudaicompanionProject: { id } } });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const signIn = (routes: Routes, env?: LoginOptions['env']) => signInByPaste({ routes, ...(env ? { env } : {}) });
const loadAnswers = (...bodies: object[]): Routes => ({ [ROUTE_LOAD]: (_request, attempt) => json(bodies[attempt] ?? {}) });
const advancePolls = async (count: number): Promise<void> => {
  if (count === 0) return;
  await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  await advancePolls(count - 1);
};
const failureOf = async (login: LoginSession): Promise<Error> => {
  const failure = await login.result.catch((error: unknown) => error);
  if (!(failure instanceof Error)) throw new Error('login succeeded');
  return failure;
};

describe('an account that is already onboarded', () => {
  test('uses the server project and reports the paid tier', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'standard-tier', name: 'Standard' }, paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' }, cloudaicompanionProject: 'proj-server' }));
    await expect(login.result).resolves.toMatchObject({ projectId: 'proj-server' });
    expect(login.events.at(-1)).toMatchObject({ message: 'Google AI plan: Google AI Pro. Code Assist project: proj-server.' });
    expect(login.google.requestsTo(ROUTE_LOAD)).toHaveLength(1);
  });

  test('prefers the server project over the env project', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'standard-tier' }, cloudaicompanionProject: 'proj-server' }), { GOOGLE_CLOUD_PROJECT: 'proj-env' });
    await expect(login.result).resolves.toMatchObject({ projectId: 'proj-server' });
  });

  test('uses the env project when the server returns none, and names the tier id when it has no name', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'standard-tier' } }), { GOOGLE_CLOUD_PROJECT: 'proj-env' });
    await expect(login.result).resolves.toMatchObject({ projectId: 'proj-env' });
    expect(login.events.at(-1)).toMatchObject({ message: 'Google AI plan: standard-tier. Code Assist project: proj-env.' });
  });

  test('falls back to the current tier name when there is no paid tier', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'free-tier', name: 'Antigravity' }, cloudaicompanionProject: 'aicode-consumers' }));
    await login.result;
    expect(login.events.at(-1)).toMatchObject({ message: 'Google AI plan: Antigravity. Code Assist project: aicode-consumers.' });
  });

  test('reads GOOGLE_CLOUD_PROJECT_ID when GOOGLE_CLOUD_PROJECT is unset', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'standard-tier' } }), { GOOGLE_CLOUD_PROJECT_ID: 'proj-id-env' });
    await expect(login.result).resolves.toMatchObject({ projectId: 'proj-id-env' });
  });

  test('prefers GOOGLE_CLOUD_PROJECT over GOOGLE_CLOUD_PROJECT_ID', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'standard-tier' } }), { GOOGLE_CLOUD_PROJECT: 'a', GOOGLE_CLOUD_PROJECT_ID: 'b' });
    await expect(login.result).resolves.toMatchObject({ projectId: 'a' });
  });

  test('treats a blank env project as unset', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'standard-tier' } }), { GOOGLE_CLOUD_PROJECT: '  ', GOOGLE_CLOUD_PROJECT_ID: '' });
    await expect(failureOf(login)).resolves.toHaveProperty('message', expect.stringContaining('GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID'));
  });

  test('passes Google ineligibility reasons through verbatim', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'free-tier' }, ineligibleTiers: [{ reasonMessage: 'Not available in your country' }, { reasonMessage: 'Second reason' }] }));
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Not available in your country, Second reason');
  });

  test('asks for the project env var when nothing names a project', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'standard-tier' } }));
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID environment variable, then running /login again');
  });
});

describe('what Code Assist receives', () => {
  test('sends the bearer token, JSON body, and client metadata with the env project', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'standard-tier' }, cloudaicompanionProject: 'p' }), { GOOGLE_CLOUD_PROJECT: 'proj-env' });
    await login.result;
    expect(login.google.requestsTo(ROUTE_LOAD)[0]).toMatchObject({
      url: `${CODE_ASSIST_BASE_URL}:loadCodeAssist`,
      method: 'POST',
      headers: { authorization: 'Bearer access-new', 'content-type': 'application/json' },
      json: { cloudaicompanionProject: 'proj-env', metadata: { ideType: 'ANTIGRAVITY', duetProject: 'proj-env' } },
    });
  });

  test('sends only the Antigravity ideType when no project is overridden', async () => {
    const login = await signIn(loadAnswers({ currentTier: { id: 'free-tier' }, cloudaicompanionProject: 'aicode-consumers' }));
    await login.result;
    expect(login.google.requestsTo(ROUTE_LOAD)[0]?.json).toEqual({ metadata: { ideType: 'ANTIGRAVITY' } });
  });

  test('identifies as Antigravity on every Code Assist request', async () => {
    const routes: Routes = { ...loadAnswers(STANDARD_ONBOARDING), [ROUTE_ONBOARD]: () => json(OPERATION), [ROUTE_OPERATION]: () => json(onboarded('p')) };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const login = await signIn(routes);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await login.result;
    const codeAssist = login.google.requests.filter((request) => request.url.startsWith(CODE_ASSIST_BASE_URL));
    expect(codeAssist.map((request) => request.method)).toEqual(['POST', 'POST', 'GET']);
    for (const request of codeAssist) expect(request.headers['user-agent']).toMatch(USER_AGENT);
  });
});

describe('accounts Google refuses', () => {
  test('surfaces the UNSUPPORTED_CLIENT reason verbatim and never onboards', async () => {
    const reasonMessage = 'This client is no longer supported. Please migrate to the Antigravity suite.';
    const login = await signIn(loadAnswers({ allowedTiers: [{ id: 'free-tier', isDefault: true }], ineligibleTiers: [{ reasonCode: 'UNSUPPORTED_CLIENT', reasonMessage }] }));
    await expect(failureOf(login)).resolves.toHaveProperty('message', reasonMessage);
    expect(login.google.requests.filter((request) => request.url.includes(ROUTE_ONBOARD))).toEqual([]);
  });

  test('uses a default message when Google gives no UNSUPPORTED_CLIENT reason', async () => {
    const login = await signIn(loadAnswers({ ineligibleTiers: [{ reasonCode: 'UNSUPPORTED_CLIENT' }] }));
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Google rejected this client (UNSUPPORTED_CLIENT).');
  });

  test('shows the validation text and link and never onboards', async () => {
    const login = await signIn(loadAnswers({ ineligibleTiers: [{ reasonCode: 'VALIDATION_REQUIRED', reasonMessage: 'Verify your account.', validationUrl: VALIDATION_URL }] }));
    await expect(failureOf(login)).resolves.toHaveProperty('message', `Verify your account. Validate at: ${VALIDATION_URL}`);
    expect(login.google.requests.filter((request) => request.url.includes(ROUTE_ONBOARD))).toEqual([]);
  });

  test('uses a default validation message when Google gives none', async () => {
    const login = await signIn(loadAnswers({ ineligibleTiers: [{ reasonCode: 'VALIDATION_REQUIRED', validationUrl: VALIDATION_URL }] }));
    await expect(failureOf(login)).resolves.toHaveProperty('message', `Account validation required. Validate at: ${VALIDATION_URL}`);
  });

  test('rejects a numeric project number before any browser step', async () => {
    const { session, result } = beginLogin(async () => 'pasted-code', { routes: loadAnswers(), env: { GOOGLE_CLOUD_PROJECT: '12345678' } });
    await expect(result).rejects.toThrow('GOOGLE_CLOUD_PROJECT must be the project ID string, not its number');
    expect(session.events).toEqual([]);
  });
});

describe('onboarding a new account', () => {
  test('onboards into the default allowed tier and reads the project from the operation', async () => {
    const allowedTiers = [
      { id: 'free-tier', name: 'Free' },
      { id: 'standard-tier', name: 'Standard', isDefault: true },
    ];
    const routes: Routes = { ...loadAnswers({ allowedTiers }), [ROUTE_ONBOARD]: () => json(onboarded('proj-new')) };
    const login = await signIn(routes, { GOOGLE_CLOUD_PROJECT: 'proj-env' });
    await expect(login.result).resolves.toMatchObject({ projectId: 'proj-new' });
    expect(login.google.requestsTo(ROUTE_ONBOARD)[0]?.json).toMatchObject({ tierId: 'standard-tier', cloudaicompanionProject: 'proj-env' });
    expect(login.events.at(-1)).toMatchObject({ message: 'Google AI plan: Standard. Code Assist project: proj-new.' });
  });

  test('omits the project for the free tier', async () => {
    const routes: Routes = { ...loadAnswers({ allowedTiers: [{ id: 'free-tier', name: 'Free', isDefault: true }] }), [ROUTE_ONBOARD]: () => json(onboarded('managed')) };
    const login = await signIn(routes, { GOOGLE_CLOUD_PROJECT: 'proj-env' });
    await login.result;
    expect(login.google.requestsTo(ROUTE_ONBOARD)[0]?.json).toEqual({ tierId: 'free-tier', metadata: { ideType: 'ANTIGRAVITY' } });
  });

  test('falls back to legacy-tier when no allowed tier is the default', async () => {
    const routes: Routes = { ...loadAnswers({ allowedTiers: [{ id: 'standard-tier' }] }), [ROUTE_ONBOARD]: () => json(onboarded('p')) };
    const login = await signIn(routes);
    await login.result;
    expect(login.google.requestsTo(ROUTE_ONBOARD)[0]?.json).toMatchObject({ tierId: 'legacy-tier' });
    expect(login.events.at(-1)).toMatchObject({ message: 'Google AI plan: legacy-tier. Code Assist project: p.' });
  });

  test('onboards into the standard tier when the default tier has no id', async () => {
    const routes: Routes = { ...loadAnswers({ allowedTiers: [{ isDefault: true }] }), [ROUTE_ONBOARD]: () => json(onboarded('p')) };
    const login = await signIn(routes);
    await login.result;
    expect(login.google.requestsTo(ROUTE_ONBOARD)[0]?.json).toMatchObject({ tierId: 'standard-tier' });
  });

  test('falls back to the env project when onboarding returns none', async () => {
    const routes: Routes = { ...loadAnswers(STANDARD_ONBOARDING), [ROUTE_ONBOARD]: () => json({ done: true, response: {} }) };
    const login = await signIn(routes, { GOOGLE_CLOUD_PROJECT: 'proj-env' });
    await expect(login.result).resolves.toMatchObject({ projectId: 'proj-env' });
  });

  test('shows the message of a failed onboarding operation', async () => {
    const routes: Routes = { ...loadAnswers(STANDARD_ONBOARDING), [ROUTE_ONBOARD]: () => json({ done: true, error: { message: 'Quota exhausted' } }) };
    const login = await signIn(routes);
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Quota exhausted');
  });

  test('uses a default message for a failed onboarding operation without one', async () => {
    const routes: Routes = { ...loadAnswers(STANDARD_ONBOARDING), [ROUTE_ONBOARD]: () => json({ done: true, error: {} }) };
    const login = await signIn(routes);
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Google Code Assist onboarding failed');
  });
});

describe('onboarding that returns an operation Google cannot report on', () => {
  test.for([undefined, { GOOGLE_CLOUD_PROJECT: 'proj-env' }])('names the unfinished operation instead of blaming the project, with env %j', async (env) => {
    const routes: Routes = { ...loadAnswers(STANDARD_ONBOARDING), [ROUTE_ONBOARD]: () => json({ done: false }) };
    const login = await signIn(routes, env);
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Google Code Assist onboarding returned an incomplete operation; run /login again');
    expect(login.google.requestsTo(ROUTE_OPERATION)).toEqual([]);
  });
});

describe('waiting for onboarding to finish', () => {
  const polling = (answers: object[]): Routes => ({
    ...loadAnswers(STANDARD_ONBOARDING),
    [ROUTE_ONBOARD]: () => json(OPERATION),
    [ROUTE_OPERATION]: (_request, attempt) => json(answers[attempt] ?? OPERATION),
  });

  test('polls the operation every five seconds until it is done', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const login = await signIn(polling([OPERATION, onboarded('proj-lro')]));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(login.google.requestsTo(ROUTE_OPERATION)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await expect(login.result).resolves.toMatchObject({ projectId: 'proj-lro' });
    expect(login.google.requestsTo(ROUTE_OPERATION).map((request) => [request.method, request.url])).toEqual([
      ['GET', `${CODE_ASSIST_BASE_URL}/operations/op-1`],
      ['GET', `${CODE_ASSIST_BASE_URL}/operations/op-1`],
    ]);
  });

  test('gives up after 60 polls', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const login = await signIn(polling([]));
    await advancePolls(MAX_POLLS);
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Google Code Assist onboarding did not finish in time; run /login again');
    expect(login.google.requestsTo(ROUTE_OPERATION)).toHaveLength(MAX_POLLS);
  });

  test('cancelling the login while waiting stops the wait at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const login = await signIn(polling([]));
    await vi.waitFor(() => expect(login.google.requestsTo(ROUTE_ONBOARD)).toHaveLength(1));
    login.controller.abort();
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Request was aborted');
    expect(login.google.requestsTo(ROUTE_OPERATION)).toEqual([]);
  });
});

describe('Code Assist errors', () => {
  test('shows Google error.message for a non-2xx response without retrying', async () => {
    const login = await signIn({ [ROUTE_LOAD]: () => json({ error: { message: 'Permission denied on project' } }, HTTP_FORBIDDEN) });
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Permission denied on project');
    expect(login.google.requestsTo(ROUTE_LOAD)).toHaveLength(1);
  });

  test('names the status when the error body has no message', async () => {
    const login = await signIn({ [ROUTE_LOAD]: () => new Response('<html>oops</html>', { status: HTTP_BAD_GATEWAY }) });
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Google Code Assist request failed (HTTP 502)');
  });

  test('reports a 2xx answer that is not JSON', async () => {
    const login = await signIn({ [ROUTE_LOAD]: () => new Response('not json') });
    await expect(failureOf(login)).resolves.toHaveProperty('message', 'Google Code Assist returned a response that is not JSON');
  });

  test('does not put the access token in an error message', async () => {
    const login = await signIn({ [ROUTE_LOAD]: () => new Response('boom', { status: HTTP_INTERNAL_ERROR }) });
    const failure = await failureOf(login);
    expect(failure.message).not.toContain('access-new');
  });
});
