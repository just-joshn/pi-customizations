/**
 * Drives the extension's real streamSimple and the real Anthropic SDK against a local
 * Anthropic-shaped server, then checks what went over the wire and what Pi received.
 *
 * Run: npx tsx scripts/verify-wire.ts
 */

import { strict as assert } from 'node:assert';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { text } from 'node:stream/consumers';

import { type AssistantMessage, normalizeContext } from '@earendil-works/pi-ai';
import { z } from 'zod';
import extension from '../src/index.ts';

type Captured = { readonly headers: IncomingHttpHeaders; readonly body: Record<string, unknown> };
type ProviderConfig = Parameters<Parameters<typeof extension>[0]['registerProvider']>[1];
type WireServer = { readonly server: Server; readonly baseUrl: string; readonly captured: () => readonly Captured[] };

const STATUS_OK = 200;
const STATUS_BAD_REQUEST = 400;
const STATUS_SERVER_ERROR = 500;
const INPUT_TOKENS = 5;
const OUTPUT_TOKENS_FINAL = 2;
const THINKING_BUDGET_HIGH = 20480;
const JSON_INDENT = 2;
const LOOPBACK_HOST = '127.0.0.1';
const EPHEMERAL_PORT = 0;
const REJECTED_MODEL = 'claude-reject';

const bodySchema = z.record(z.string(), z.unknown());

const sse = (events: readonly Record<string, unknown>[]): string => events.map((event) => `event: ${event['type']}\ndata: ${JSON.stringify(event)}\n\n`).join('');

const SUCCESS = sse([
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage: { input_tokens: INPUT_TOKENS, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: OUTPUT_TOKENS_FINAL } },
  { type: 'message_stop' },
]);

async function readCaptured(request: IncomingMessage): Promise<Captured> {
  const raw = await text(request);
  return { headers: request.headers, body: bodySchema.parse(JSON.parse(raw)) };
}

function reply(response: ServerResponse, body: Record<string, unknown>): void {
  if (body['model'] === REJECTED_MODEL) {
    response.writeHead(STATUS_BAD_REQUEST, { 'content-type': 'application/json', 'request-id': 'req_wire_400' });
    response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } }));
    return;
  }
  response.writeHead(STATUS_OK, { 'content-type': 'text/event-stream', 'request-id': 'req_wire_200' });
  response.end(SUCCESS);
}

async function startServer(): Promise<WireServer> {
  let log: readonly Captured[] = [];
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const entry = await readCaptured(request);
    log = [...log, entry];
    reply(response, entry.body);
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      console.error('Wire server failed to answer a request:', error);
      response.writeHead(STATUS_SERVER_ERROR).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(EPHEMERAL_PORT, LOOPBACK_HOST, resolve));
  return { server, baseUrl: `http://${LOOPBACK_HOST}:${(server.address() as AddressInfo).port}`, captured: () => log };
}

function registered(): ProviderConfig {
  let config = undefined as ProviderConfig | undefined;
  extension({
    registerProvider: (_id: string, next: ProviderConfig) => {
      config = next;
    },
  } as never);
  assert.ok(config?.streamSimple && config.models, 'extension registered no provider');
  return config;
}

async function send(baseUrl: string, modelId: string, apiKey: string): Promise<AssistantMessage> {
  const config = registered();
  const entry = config.models?.find((model) => model.id === modelId) ?? { ...config.models?.[0], id: modelId };
  const model = { ...entry, api: config.api, provider: 'custom-anthropic', baseUrl } as never;
  const context = normalizeContext({ systemPrompt: 'Be brief.', messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }] });
  const stream = config.streamSimple?.(model, context, { apiKey, reasoning: 'high' });
  assert.ok(stream);
  return stream.result();
}

function checkOAuth(captured: Captured, message: AssistantMessage): void {
  assert.equal(captured.headers['authorization'], 'Bearer sk-ant-oat01-wire');
  assert.equal(captured.headers['x-api-key'], undefined);
  assert.equal(captured.headers['anthropic-version'], '2026-10-21');
  assert.equal(captured.headers['anthropic-beta'], 'claude-code-20250219,oauth-2025-04-20');
  assert.match(String(captured.headers['user-agent']), /^claude-cli\//);
  assert.equal(captured.headers['x-app'], 'cli');
  assert.equal(captured.body['betas'], undefined, 'betas must travel as a header, not in the body');
  assert.deepEqual(captured.body['thinking'], { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(captured.body['output_config'], { effort: 'high' });
  assert.equal(captured.body['stream'], true);
  assert.equal(message.stopReason, 'stop');
  assert.deepEqual(message.content, [{ type: 'text', text: 'pong' }]);
}

function checkApiKey(captured: Captured): void {
  assert.equal(captured.headers['authorization'], 'Bearer sk-ant-api03-wire');
  assert.equal(captured.headers['anthropic-beta'], 'interleaved-thinking-2025-05-14');
  assert.equal(captured.headers['x-app'], undefined);
  assert.deepEqual(captured.body['thinking'], { type: 'enabled', budget_tokens: THINKING_BUDGET_HIGH, display: 'summarized' });
}

async function main(): Promise<void> {
  const { server, baseUrl, captured } = await startServer();
  try {
    const oauth = await send(baseUrl, 'claude-sonnet-5-5', 'sk-ant-oat01-wire');
    checkOAuth(captured()[0] as Captured, oauth);
    await send(baseUrl, 'claude-sonnet-4-5', 'sk-ant-api03-wire');
    checkApiKey(captured()[1] as Captured);
    const rejected = await send(baseUrl, REJECTED_MODEL, 'sk-ant-api03-wire');
    assert.equal(rejected.stopReason, 'error');
    assert.equal(rejected.errorMessage, 'BadRequestError 400 (request req_wire_400): bad request');
    process.stdout.write(`${JSON.stringify({ requests: captured().length, oauthHeaders: captured()[0]?.headers, rejected: rejected.errorMessage }, null, JSON_INDENT)}\n`);
  } finally {
    server.close();
  }
}

try {
  await main();
} catch (error) {
  console.error('Wire verification failed:', error);
  throw new Error('Wire verification failed; see the assertion above.', { cause: error });
}
