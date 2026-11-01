import { expect } from 'vitest';
import { ask } from './support/context.ts';
import { OAUTH_ACCESS_TOKEN, REFRESHED_ACCESS_TOKEN, REFRESHED_REFRESH_TOKEN } from './support/credentials.ts';
import { test } from './support/fixtures.ts';
import { errorReply, type RecordedRequest, sseReply } from './support/messages-server.ts';
import { collect } from './support/run-stream.ts';
import { textMessage } from './support/sse.ts';

function authorization(request: RecordedRequest): string | undefined {
  const value = request.headers.authorization;
  return Array.isArray(value) ? value[0] : value;
}

function rejectStaleBearerThenSucceed(staleAccess: string) {
  return (res: Parameters<ReturnType<typeof errorReply>>[0], request: RecordedRequest) => {
    if (authorization(request) === `Bearer ${staleAccess}`) {
      errorReply(401, 'invalid bearer token')(res, request);
      return;
    }
    sseReply(textMessage('ok'))(res, request);
  };
}

test('a 401 refreshes once then retries the request', async ({ models, model, server, credentials, tokenEndpoint }) => {
  server.respond(rejectStaleBearerThenSucceed(OAUTH_ACCESS_TOKEN));
  const { message } = await collect(models.streamSimple(model, ask('hi'), { maxRetries: 0 }));
  expect(message.stopReason).toBe('stop');
  expect(server.requests).toHaveLength(2);
  expect(authorization(server.requests[0]!)).toBe(`Bearer ${OAUTH_ACCESS_TOKEN}`);
  expect(authorization(server.requests[1]!)).toBe(`Bearer ${REFRESHED_ACCESS_TOKEN}`);
  expect(tokenEndpoint.requests).toHaveLength(1);
  await expect(credentials.read(model.provider)).resolves.toMatchObject({
    type: 'oauth',
    access: REFRESHED_ACCESS_TOKEN,
    refresh: REFRESHED_REFRESH_TOKEN,
  });
});

test('concurrent 401s share one refresh and each retry once', async ({ models, model, server, credentials, tokenEndpoint }) => {
  server.respond(rejectStaleBearerThenSucceed(OAUTH_ACCESS_TOKEN));
  const results = await Promise.all([collect(models.streamSimple(model, ask('one'), { maxRetries: 0 })), collect(models.streamSimple(model, ask('two'), { maxRetries: 0 }))]);
  expect(results.map(({ message }) => message.stopReason)).toStrictEqual(['stop', 'stop']);
  expect(tokenEndpoint.requests).toHaveLength(1);
  expect(server.requests).toHaveLength(4);
  expect(server.requests.filter((request) => authorization(request) === `Bearer ${OAUTH_ACCESS_TOKEN}`)).toHaveLength(2);
  expect(server.requests.filter((request) => authorization(request) === `Bearer ${REFRESHED_ACCESS_TOKEN}`)).toHaveLength(2);
  await expect(credentials.read(model.provider)).resolves.toMatchObject({ access: REFRESHED_ACCESS_TOKEN });
});

test('a second 401 after refresh is not retried again', async ({ models, model, server, tokenEndpoint }) => {
  server.respond(errorReply(401, 'still rejected'));
  const { message } = await collect(models.streamSimple(model, ask('hi'), { maxRetries: 0 }));
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toMatch(/^401\b/);
  expect(tokenEndpoint.requests).toHaveLength(1);
  expect(server.requests).toHaveLength(2);
});
