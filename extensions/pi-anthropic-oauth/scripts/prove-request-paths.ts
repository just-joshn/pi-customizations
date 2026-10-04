import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { RpcClient } from '@earendil-works/pi-coding-agent';
import { oauthCredential } from '../test/support/credentials.ts';
import { type RecordedRequest, sseReply, startMessagesServer } from '../test/support/messages-server.ts';
import { systemTexts } from '../test/support/request-body.ts';
import { textMessage } from '../test/support/sse.ts';
import { ROUTER_MODEL, ROUTER_PROVIDER } from './request-event-probe.ts';

const PROMPTS = ['first', 'second', 'third'];
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const PROMPT_TIMEOUT_MS = 60_000;
const USER_AGENT = 'claude-cli/9.9.9';
const extension = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const probe = fileURLToPath(new URL('./request-event-probe.ts', import.meta.url));
const cliPath = process.env['PI_OAUTH_CLI_PATH'] ?? join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');
const { stdout: cliVersion } = await promisify(execFile)(process.execPath, [cliPath, '--version']);
const BILLING_PATTERN = /^x-anthropic-billing-header: cc_version=2\.1\.288\.[a-f0-9]{3}; cc_entrypoint=sdk-cli;$/;

const root = await mkdtemp(join(tmpdir(), 'pi-oauth-paths-'));
const server = await startMessagesServer(sseReply(textMessage('ok')));
const eventLog = join(root, 'events.log');

async function eventProviders(): Promise<readonly string[]> {
  return (await readFile(eventLog, 'utf8')).split('\n').filter(Boolean);
}

function carriesBillingBlock(request: RecordedRequest): boolean {
  return BILLING_PATTERN.test(systemTexts(request.body)[0] ?? '');
}

try {
  const agentDir = join(root, 'agent');
  const cwd = join(root, 'cwd');
  await Promise.all([mkdir(agentDir), mkdir(cwd), writeFile(eventLog, '')]);
  await Promise.all([
    writeFile(join(agentDir, 'auth.json'), JSON.stringify({ 'claude-subscription': oauthCredential({ expires: Date.now() + YEAR_MS }) }), { mode: 0o600 }),
    writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'claude-subscription': { baseUrl: server.baseUrl, headers: { 'user-agent': USER_AGENT } } } })),
    writeFile(join(agentDir, 'settings.json'), JSON.stringify({ compaction: { keepRecentTokens: 1 } })),
  ]);

  const client = new RpcClient({
    cliPath,
    cwd,
    env: { PI_CODING_AGENT_DIR: agentDir, PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', REQUEST_EVENT_LOG: eventLog },
    args: ['--offline', '--no-session', '-ne', '-ns', '-np', '-nc', '-e', extension, '-e', probe],
    model: 'claude-subscription/claude-sonnet-4-6',
  });
  await client.start();
  try {
    for (const message of PROMPTS) await client.promptAndWait(message, undefined, PROMPT_TIMEOUT_MS);
    const agentLoopRequests = server.requests.length;
    const agentLoopProviders = await eventProviders();

    await client.compact();
    const compactionRequests = server.requests.slice(agentLoopRequests);
    const compactionProviders = (await eventProviders()).slice(agentLoopProviders.length);

    await client.setModel(ROUTER_PROVIDER, ROUTER_MODEL);
    await client.promptAndWait('routed', undefined, PROMPT_TIMEOUT_MS);
    const routedRequests = server.requests.slice(agentLoopRequests + compactionRequests.length);
    const routedProviders = (await eventProviders()).slice(agentLoopProviders.length + compactionProviders.length);

    const report = {
      cliVersion: cliVersion.trim(),
      agentLoop: { requests: agentLoopRequests, withBillingBlock: server.requests.slice(0, agentLoopRequests).filter(carriesBillingBlock).length, eventProviders: agentLoopProviders },
      compaction: { requests: compactionRequests.length, withBillingBlock: compactionRequests.filter(carriesBillingBlock).length, eventProviders: compactionProviders },
      virtualRoute: { requests: routedRequests.length, withBillingBlock: routedRequests.filter(carriesBillingBlock).length, eventProviders: routedProviders },
      userAgents: [...new Set(server.requests.map((request) => request.headers['user-agent']))],
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    if (systemTexts(server.requests[0]?.body)[0] !== 'x-anthropic-billing-header: cc_version=2.1.288.d44; cc_entrypoint=sdk-cli;') throw new Error('The first prompt did not get its captured fingerprint.');
    if (agentLoopRequests !== PROMPTS.length || agentLoopProviders.length !== PROMPTS.length) throw new Error('Each agent-loop prompt should send one request and fire one before_provider_request event.');
    if (compactionRequests.length === 0) throw new Error('Compaction sent no request to the gateway.');
    if (routedRequests.length !== 1) throw new Error('The routed prompt should send one request to the gateway.');
    if (server.requests.some((request) => !carriesBillingBlock(request))) throw new Error('A request reached the gateway without the billing block.');
    if (compactionProviders.length !== 0) throw new Error('Pi now fires before_provider_request for compaction requests. The extension event can carry the billing block, so move it there and delete the provider-level hook.');
    if (routedProviders.length !== 1) throw new Error('A virtual route should fire exactly one before_provider_request event.');
    if (routedProviders[0] !== ROUTER_PROVIDER) throw new Error('A before_provider_request event now names the routed provider. If every event does, the extension event can scope the billing block to claude-subscription.');
    if (report.userAgents.length !== 1 || report.userAgents[0] !== USER_AGENT) throw new Error('The models.json user-agent header did not reach every request, so the README override no longer works.');
  } finally {
    await client.stop();
  }
} finally {
  await server.close();
  await rm(root, { recursive: true, force: true });
}
