import { expect } from 'vitest';
import { CCH_PLACEHOLDER, cchDigest } from '../src/attestation.ts';
import { ask, assistantTurn, user } from './support/context.ts';
import { test } from './support/fixtures.ts';
import type { Reply } from './support/messages-server.ts';
import { rawSystemTexts } from './support/request-body.ts';
import { collect } from './support/run-stream.ts';
import { frames, textMessage } from './support/sse.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function replyWithRequestId(requestId: string): Reply {
  return (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': requestId });
    res.end(frames(textMessage('ok')));
  };
}

function field(billing: string, name: string): string | undefined {
  return new RegExp(`${name}=([^;]+);`).exec(billing)?.[1];
}

test('the wire billing block carries the body attestation Claude Code computes', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { sessionId: 's-attest' }));
  const [request] = server.requests;
  const billing = rawSystemTexts(request?.body)[0] ?? '';
  const digest = field(billing, 'cch') ?? '';
  expect(digest).toMatch(/^[0-9a-f]{5}$/);
  const unattested = JSON.stringify(request?.body).replace(`cch=${digest}`, CCH_PLACEHOLDER);
  expect(cchDigest(Buffer.from(unattested))).toBe(digest);
});

test('the billing block names the prompt, the turn origin and the turn position', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { sessionId: 's-fields' }));
  const billing = rawSystemTexts(server.requests[0]?.body)[0] ?? '';
  expect(billing).toMatch(/^x-anthropic-billing-header: cc_version=2\.1\.316\.[0-9a-f]{3}; cc_entrypoint=sdk-cli; cch=[0-9a-f]{5}; cc_prompt_id=[0-9a-f-]{36}; cc_turn_origin=sdk; cc_prompt_index=0; cc_turn_index=1;$/);
});

test('the prompt id header equals the billing prompt id and the request class is main', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { sessionId: 's-headers' }));
  const request = server.requests[0];
  const promptId = field(rawSystemTexts(request?.body)[0] ?? '', 'cc_prompt_id');
  expect(promptId).toMatch(UUID);
  expect(request?.headers['x-claude-code-prompt-id']).toBe(promptId);
  expect(request?.headers['x-claude-code-request-class']).toBe('main');
});

test('every request gets its own client request id', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('one'), { sessionId: 's-client-id' }));
  await collect(models.streamSimple(model, ask('two'), { sessionId: 's-client-id' }));
  const ids = server.requests.map((request) => request.headers['x-client-request-id']);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(ids.every((id) => typeof id === 'string' && UUID.test(id))).toBe(true);
});

test('a prompt id is stable inside a turn and changes with the next user turn', async ({ models, model, server }) => {
  const first = ask('first');
  await collect(models.streamSimple(model, first, { sessionId: 's-turns' }));
  await collect(models.streamSimple(model, { messages: [...first.messages, assistantTurn({}), user('again')] }, { sessionId: 's-turns' }));
  const [one, two] = server.requests.map((request) => rawSystemTexts(request.body)[0] ?? '');
  expect(field(one ?? '', 'cc_turn_index')).toBe('1');
  expect(field(two ?? '', 'cc_turn_index')).toBe('2');
  expect(field(one ?? '', 'cc_prompt_id')).not.toBe(field(two ?? '', 'cc_prompt_id'));
});

test('the next billing block names the previous response request id', async ({ models, model, server }) => {
  server.respond(replyWithRequestId('req_011CprobeFIRST'));
  await collect(models.streamSimple(model, ask('one'), { sessionId: 's-prev' }));
  await collect(models.streamSimple(model, ask('two'), { sessionId: 's-prev' }));
  const [one, two] = server.requests.map((request) => rawSystemTexts(request.body)[0] ?? '');
  expect(field(one ?? '', 'cc_prev_req')).toBeUndefined();
  expect(field(two ?? '', 'cc_prev_req')).toBe('req_011CprobeFIRST');
});

test('a malformed response request id is not carried forward', async ({ models, model, server }) => {
  server.respond(replyWithRequestId('not a request id'));
  await collect(models.streamSimple(model, ask('one'), { sessionId: 's-bad-prev' }));
  await collect(models.streamSimple(model, ask('two'), { sessionId: 's-bad-prev' }));
  expect(field(rawSystemTexts(server.requests[1]?.body)[0] ?? '', 'cc_prev_req')).toBeUndefined();
});
