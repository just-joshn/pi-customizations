/**
 * Drives the extension's real streamSimple and the real Anthropic SDK against a local
 * Anthropic-shaped server, then checks what went over the wire and what Pi received.
 *
 * Run: npx tsx scripts/verify-wire.ts
 */

import { strict as assert } from 'node:assert';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { type AssistantMessage, normalizeContext } from '@earendil-works/pi-ai';
import extension from '../src/index.ts';

type Captured = { readonly headers: IncomingHttpHeaders; readonly body: Record<string, unknown> };
type ProviderConfig = Parameters<Parameters<typeof extension>[0]['registerProvider']>[1];

const sse = (events: readonly Record<string, unknown>[]): string => events.map((event) => `event: ${event['type']}\ndata: ${JSON.stringify(event)}\n\n`).join('');

const SUCCESS = sse([
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
]);

async function startServer(captured: Captured[]) {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      captured.push({ headers: request.headers, body });
      if (body['model'] === 'claude-reject') {
        response.writeHead(400, { 'content-type': 'application/json', 'request-id': 'req_wire_400' });
        response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_wire_200' });
      response.end(SUCCESS);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function registered(): ProviderConfig {
  const configs: ProviderConfig[] = [];
  extension({ registerProvider: (_id: string, config: ProviderConfig) => configs.push(config) } as never);
  const [config] = configs;
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
  assert.deepEqual(captured.body['thinking'], { type: 'enabled', budget_tokens: 20480, display: 'summarized' });
}

async function main(): Promise<void> {
  const captured: Captured[] = [];
  const { server, baseUrl } = await startServer(captured);
  try {
    const oauth = await send(baseUrl, 'claude-sonnet-5-5', 'sk-ant-oat01-wire');
    checkOAuth(captured[0] as Captured, oauth);
    await send(baseUrl, 'claude-sonnet-4-5', 'sk-ant-api03-wire');
    checkApiKey(captured[1] as Captured);
    const rejected = await send(baseUrl, 'claude-reject', 'sk-ant-api03-wire');
    assert.equal(rejected.stopReason, 'error');
    assert.equal(rejected.errorMessage, 'BadRequestError 400 (request req_wire_400): bad request');
    process.stdout.write(`${JSON.stringify({ requests: captured.length, oauthHeaders: captured[0]?.headers, rejected: rejected.errorMessage }, null, 2)}\n`);
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
