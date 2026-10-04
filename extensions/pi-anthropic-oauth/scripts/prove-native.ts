import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { RpcClient } from '@earendil-works/pi-coding-agent';
import { OAUTH_ACCESS_TOKEN } from '../test/support/credentials.ts';
import { sseReply, startMessagesServer } from '../test/support/messages-server.ts';
import { isRecord, systemTexts } from '../test/support/request-body.ts';
import { textMessage, toolUseMessage } from '../test/support/sse.ts';

const cliPath = process.env['PI_OAUTH_CLI_PATH'] ?? join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');
const { stdout: version } = await promisify(execFile)(process.execPath, [cliPath, '--version']);
const reference: unknown = JSON.parse(await readFile(new URL('../test/fixtures/claude-code-2.1.288.json', import.meta.url), 'utf8'));
if (!isRecord(reference) || typeof reference['prompt'] !== 'string' || typeof reference['billing'] !== 'string' || !isRecord(reference['headers']) || typeof reference['headers']['user-agent'] !== 'string')
  throw new Error('The captured Claude reference is invalid.');
const root = await mkdtemp(join(tmpdir(), 'pi-oauth-native-'));
const server = await startMessagesServer(sseReply(textMessage('LOCAL_OK')));
const agentDir = join(root, 'agent');
const cwd = join(root, 'cwd');
const probe = fileURLToPath(new URL('./request-event-probe.ts', import.meta.url));
const extension = fileURLToPath(new URL('..', import.meta.url));
const timeout = 60_000;
const args = ['--offline', '--no-session', '-ne', '-ns', '-np', '-nc', '-e', extension, '-e', probe, '--provider', 'claude-subscription', '--model', 'claude-sonnet-4-6', '--thinking', 'off'];
const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', CLAUDE_CODE_OAUTH_TOKEN: OAUTH_ACCESS_TOKEN, REQUEST_EVENT_LOG: join(root, 'events.log') };

try {
  await Promise.all([mkdir(agentDir), mkdir(cwd), writeFile(env.REQUEST_EVENT_LOG, '')]);
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'claude-subscription': { baseUrl: server.baseUrl } } }));
  await writeFile(join(cwd, 'probe.txt'), 'LOCAL_FILE\n');

  const printRun = promisify(execFile)(process.execPath, [cliPath, ...args, '-p', reference['prompt']], { cwd, env, timeout });
  printRun.child.stdin?.end();
  const print = await printRun;
  assert.equal(print.stdout.trim(), 'LOCAL_OK');
  const jsonRun = promisify(execFile)(process.execPath, [cliPath, ...args, '--mode', 'json', '-p', reference['prompt']], { cwd, env, timeout });
  jsonRun.child.stdin?.end();
  const json = await jsonRun;
  const records: unknown[] = json.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(records.some((record) => isRecord(record) && record['type'] === 'agent_settled'));
  const jsonMessage = records.find((record) => isRecord(record) && record['type'] === 'message_end' && isRecord(record['message']) && record['message']['role'] === 'assistant');
  assert.ok(isRecord(jsonMessage) && isRecord(jsonMessage['message']) && Array.isArray(jsonMessage['message']['content']));
  assert.ok(jsonMessage['message']['content'].some((block: unknown) => isRecord(block) && block['type'] === 'text' && block['text'] === 'LOCAL_OK'));

  const client = new RpcClient({ cliPath, cwd, env, args });
  await client.start();
  try {
    assert.ok((await client.getAvailableModels()).some((model) => model.provider === 'claude-subscription' && model.id === reference['model']));
    await client.promptAndWait(reference['prompt'], undefined, timeout);
    assert.equal(await client.getLastAssistantText(), 'LOCAL_OK');
    const usage = (await client.getSessionStats()).tokens;
    assert.deepEqual(usage, { input: 10, output: 7, cacheRead: 4, cacheWrite: 2, total: 23 });
    assert.equal(server.requests.length, 3);
    assert.equal(server.requests[2]?.headers['x-claude-code-session-id'], (await client.getState()).sessionId);
    for (const request of server.requests) {
      assert.equal(systemTexts(request.body)[0], reference['billing']);
      assert.equal(request.headers['user-agent'], reference['headers']['user-agent']);
      assert.equal(request.headers['x-app'], 'cli');
      assert.equal(request.headers['x-api-key'], undefined);
    }

    const [first] = await client.getForkMessages();
    assert.ok(first);
    assert.equal((await client.fork(first.entryId)).cancelled, false);
    await client.promptAndWait('changed first message', undefined, timeout);
    assert.equal(systemTexts(server.requests.at(-1)?.body)[0], 'x-anthropic-billing-header: cc_version=2.1.288.89e; cc_entrypoint=sdk-cli;');

    assert.equal(await client.prompt('/verify_oauth_reload'), 'handled');
    await client.promptAndWait('after reload', undefined, timeout);
    assert.equal(await client.getLastAssistantText(), 'LOCAL_OK');
    assert.equal((await client.newSession()).cancelled, false);
    await client.promptAndWait(reference['prompt'], undefined, timeout);
    assert.equal(systemTexts(server.requests.at(-1)?.body)[0], reference['billing']);

    server.respond((res) => {
      sseReply(toolUseMessage('toolu_read_probe', 'Read', ['{"path":"probe.txt"}']))(res);
      server.respond(sseReply(textMessage('LOCAL_OK')));
    });
    await client.promptAndWait('Read probe.txt.', undefined, timeout);
    const read = (await client.getMessages()).find((message) => message.role === 'toolResult' && message.toolName === 'read');
    assert.ok(read && read.role === 'toolResult' && !read.isError);
    assert.ok(read.content.some((block) => block.type === 'text' && block.text.includes('LOCAL_FILE')));

    server.respond((res) => {
      sseReply(toolUseMessage('toolu_bash_probe', 'Bash', [JSON.stringify({ command: 'node -e \'process.stdout.write("x".repeat(40000))\'' })]))(res);
      server.respond(sseReply(textMessage('LOCAL_OK')));
    });
    await client.promptAndWait('Run the bounded local output probe.', undefined, timeout);
    const bash = (await client.getMessages()).find((message) => message.role === 'toolResult' && message.toolName === 'bash');
    assert.ok(bash && bash.role === 'toolResult' && !bash.isError);
    assert.equal(
      bash.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
      'x'.repeat(40000),
    );

    const reachedGateway = new Promise<void>((resolve) => {
      server.respond((res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders();
        resolve();
      });
    });
    const completion = client.collectEvents(timeout);
    await client.prompt('abort this local request');
    await reachedGateway;
    await client.abort();
    const events = await completion;
    assert.ok(events.some((event) => event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'aborted'));
    assert.equal((await client.getState()).isStreaming, false);
    assert.deepEqual(JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8')), {});
    process.stdout.write(
      `${JSON.stringify({ cliVersion: version.trim(), print: 'LOCAL_OK', json: 'agent_settled', rpc: 'LOCAL_OK', captureIdentity: 'equal', usage, ambientTokenStored: false, fork: 'fresh fingerprint', reload: 'handled', newSession: 'fresh fingerprint', readTool: 'LOCAL_FILE', bashTool: '40000 native characters', abort: 'aborted' }, null, 2)}\n`,
    );
  } finally {
    await client.stop();
  }
} finally {
  await server.close();
  await rm(root, { recursive: true, force: true });
}
