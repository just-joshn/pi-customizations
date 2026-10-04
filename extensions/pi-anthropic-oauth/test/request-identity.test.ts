import { expect } from 'vitest';
import { ask, readTool } from './support/context.ts';
import { OAUTH_ACCESS_TOKEN } from './support/credentials.ts';
import { test } from './support/fixtures.ts';
import { sseReply } from './support/messages-server.ts';
import { BILLING_TEXT, PROVIDER_PREAMBLE, soleRequest, systemBlocks, systemTexts, toolNames } from './support/request-body.ts';
import { collect } from './support/run-stream.ts';
import { toolUseMessage } from './support/sse.ts';

const prompt = ask('hi', { systemPrompt: 'You are helpful.' });

test('the system lists the billing block, the preamble, then the prompt', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt));
  expect(systemTexts(soleRequest(server).body)).toStrictEqual([BILLING_TEXT, PROVIDER_PREAMBLE, 'You are helpful.']);
});

test('the billing block reaches the wire byte for byte', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt));
  expect(systemBlocks(soleRequest(server).body)[0]).toStrictEqual({
    type: 'text',
    text: 'x-anthropic-billing-header: cc_version=2.1.288.9ae; cc_entrypoint=sdk-cli;',
  });
});

test('the non-simple stream carries the billing block', async ({ models, model, server }) => {
  await collect(models.stream(model, prompt));
  expect(systemTexts(soleRequest(server).body)).toStrictEqual([BILLING_TEXT, PROVIDER_PREAMBLE, 'You are helpful.']);
});

test.for([
  { header: 'user-agent', value: 'claude-cli/2.1.288 (external, sdk-cli)' },
  { header: 'x-app', value: 'cli' },
  { header: 'anthropic-version', value: '2023-06-01' },
  { header: 'anthropic-beta', value: 'claude-code-20250219,oauth-2025-04-20' },
  { header: 'authorization', value: `Bearer ${OAUTH_ACCESS_TOKEN}` },
])('the $header header is $value', async ({ header, value }, { models, model, server }) => {
  await collect(models.streamSimple(model, prompt));
  expect(soleRequest(server).headers).toHaveProperty(header, value);
});

test('caller headers override the user agent Pi sends', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt, { headers: { 'user-agent': 'claude-cli/9.9.9' } }));
  expect(soleRequest(server).headers).toHaveProperty('user-agent', 'claude-cli/9.9.9');
});

test('the request uses Pi session identity for the Claude session header', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt, { sessionId: 'pi-session-probe' }));
  expect(soleRequest(server).headers['x-claude-code-session-id']).toBe('pi-session-probe');
});

test('explicit session headers override Pi session identity', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt, { sessionId: 'pi-session-probe', headers: { 'X-Claude-Code-Session-Id': 'caller-session' } }));
  expect(soleRequest(server).headers['x-claude-code-session-id']).toBe('caller-session');
});

test('no x-api-key header is sent', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt));
  expect(soleRequest(server).headers).not.toHaveProperty('x-api-key');
});

test('tool names are declared in Provider CLI casing', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('read a', { tools: [readTool] })));
  expect(toolNames(soleRequest(server).body)).toStrictEqual(['Read']);
});

test('a tool call maps back to the Pi tool name', async ({ models, model, server }) => {
  server.respond(sseReply(toolUseMessage('toolu_1', 'Read', ['{"path":', '"a.txt"}'])));
  const { message } = await collect(models.streamSimple(model, ask('read a', { tools: [readTool] })));
  expect(message.content).toStrictEqual([{ type: 'toolCall', id: 'toolu_1', name: 'read', arguments: { path: 'a.txt' } }]);
});

test('a tool call stops the turn for tool use', async ({ models, model, server }) => {
  server.respond(sseReply(toolUseMessage('toolu_1', 'Read', ['{"path":"a.txt"}'])));
  const { message } = await collect(models.streamSimple(model, ask('read a', { tools: [readTool] })));
  expect(message.stopReason).toBe('toolUse');
});
