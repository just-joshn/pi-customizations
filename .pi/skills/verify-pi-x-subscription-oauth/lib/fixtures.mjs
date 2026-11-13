// Values that track the extension, synthetic credentials, canned upstream bodies, and the
// evidence scrubber. Update the constants with src/login.ts, src/request.ts, src/catalog.ts, and
// src/cursor/catalog.ts; the fixture shapes come from the extension's own test/fixtures.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(SKILL_DIR, '../../..');
export const EXTENSION = join(REPO_ROOT, 'extensions/pi-x-subscription-oauth');
const FIXTURES = join(EXTENSION, 'test/fixtures');
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

export const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const GROK_CLIENT_VERSION = '1.0.70';
export const CURSOR_CLIENT_VERSION = 'cli-2026.11.05-86047df';
export const GROK_IDS = ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5', 'grok-4.7-low-fast', 'grok-4.7-medium-fast', 'grok-4.7-high-fast', 'grok-4.7-xhigh-fast'];
export const AUTHORIZE_FIXTURE = fixture('grok-1.0.70-authorize-url.json');
export const BILLING_FIXTURE = fixture('billing-credits.json');
export const USABLE_MODELS_FIXTURE = fixture('cursor/usable-models.json');

const FAR_FUTURE = 4102444800000;
const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
// A JWT-shaped synthetic token. Cursor's expiry comes from its `exp` claim; nothing verifies the signature.
const fakeJwt = (label, expSeconds) => `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: `verify-${label}`, exp: expSeconds })}.${b64url(`verify-signature-${label}-${randomUUID()}`)}`;

export const grokCredential = (label) => ({ type: 'oauth', access: `verify-grok-${label}-${randomUUID()}`, refresh: `verify-grok-refresh-${randomUUID()}`, expires: FAR_FUTURE });
export function cursorCredential(label) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = fakeJwt(label, exp);
  return { type: 'oauth', access, refresh: access, expires: exp * 1000 };
}
export const cursorApiKey = () => `verify-cursor-api-key-${randomUUID()}`;

// Every synthetic credential shape. Evidence writes mask each match, so drives record raw values.
const SECRET_SHAPES = /verify-grok-[A-Za-z0-9-]{8,}|verify-cursor-api-key-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
export const scrub = (text) => text.replace(SECRET_SHAPES, (secret) => `${secret.slice(0, 10)}…${secret.slice(-6)}`);

// ---------- OpenAI Responses SSE bodies ----------

const USAGE = { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 12 };
const sse = (events) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');

export function responsesText(reply = 'LOCAL_OK') {
  const message = { type: 'message', id: 'msg_verify', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] };
  return sse([
    { type: 'response.created', response: { id: 'resp_verify', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_verify', content_index: 0, delta: reply },
    { type: 'response.output_text.done', output_index: 0, item_id: 'msg_verify', content_index: 0, text: reply },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response: { id: 'resp_verify', status: 'completed', output: [message], usage: USAGE } },
  ]);
}

// A stream whose only output is one function call, so Pi runs the tool and asks again.
export function responsesToolCall(name, args) {
  const item = { type: 'function_call', id: 'fc_verify', call_id: 'call_verify', name, arguments: JSON.stringify(args), status: 'completed' };
  return sse([
    { type: 'response.created', response: { id: 'resp_tool', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '', status: 'in_progress' } },
    { type: 'response.function_call_arguments.done', output_index: 0, item_id: 'fc_verify', arguments: item.arguments },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_tool', status: 'completed', output: [item], usage: USAGE } },
  ]);
}

export const tokenReply = (label) => ({ access_token: `verify-grok-${label}-${randomUUID()}`, refresh_token: `verify-grok-refresh-${randomUUID()}`, expires_in: 21600, token_type: 'Bearer', scope: AUTHORIZE_FIXTURE.stableParameters.scope });
