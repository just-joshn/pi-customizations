import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { RpcClient } from '@earendil-works/pi-coding-agent';
import { CLAUDE_USER_AGENT } from '../src/identity.ts';
import { oauthCredential } from '../test/support/credentials.ts';
import { type RecordedRequest, sseReply, startMessagesServer } from '../test/support/messages-server.ts';
import { systemTexts } from '../test/support/request-body.ts';
import { textMessage } from '../test/support/sse.ts';
import { ROUTER_MODEL, ROUTER_PROVIDER } from './request-event-probe.ts';

const PROMPTS = ['first', 'second', 'third'];
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const PROMPT_TIMEOUT_MS = 60_000;
const USER_AGENT_OVERRIDE = 'claude-cli/9.9.9';
const SESSION_HEADER = 'x-claude-code-session-id';
const extension = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const probe = fileURLToPath(new URL('./request-event-probe.ts', import.meta.url));
const cliPath = process.env['PI_OAUTH_CLI_PATH'] ?? join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');
const { stdout: cliVersion } = await promisify(execFile)(process.execPath, [cliPath, '--version']);
const BILLING_PATTERN = /^x-anthropic-billing-header: cc_version=2\.1\.311\.[a-f0-9]{3}; cc_entrypoint=sdk-cli;$/;

interface Scenario {
  readonly name: string;
  readonly modelsHeaders?: Record<string, string>;
  readonly expectedUserAgent: string;
}

interface PathReport {
  readonly requests: number;
  readonly withBillingBlock: number;
  readonly eventProviders: readonly string[];
  readonly headerEventProviders: readonly string[];
}

function carriesBillingBlock(request: RecordedRequest): boolean {
  return BILLING_PATTERN.test(systemTexts(request.body)[0] ?? '');
}

async function readLines(path: string): Promise<readonly string[]> {
  return (await readFile(path, 'utf8')).split('\n').filter(Boolean);
}

async function runScenario(scenario: Scenario): Promise<object> {
  const root = await mkdtemp(join(tmpdir(), 'pi-oauth-paths-'));
  const server = await startMessagesServer(sseReply(textMessage('ok')));
  const eventLog = join(root, 'events.log');
  const headerLog = join(root, 'headers.log');
  try {
    const agentDir = join(root, 'agent');
    const cwd = join(root, 'cwd');
    await Promise.all([mkdir(agentDir), mkdir(cwd), writeFile(eventLog, ''), writeFile(headerLog, '')]);
    await Promise.all([
      writeFile(join(agentDir, 'auth.json'), JSON.stringify({ 'claude-subscription': oauthCredential({ expires: Date.now() + YEAR_MS }) }), { mode: 0o600 }),
      writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'claude-subscription': { baseUrl: server.baseUrl, ...(scenario.modelsHeaders === undefined ? {} : { headers: scenario.modelsHeaders }) } } })),
      writeFile(join(agentDir, 'settings.json'), JSON.stringify({ compaction: { keepRecentTokens: 1 } })),
    ]);

    const client = new RpcClient({
      cliPath,
      cwd,
      env: { PI_CODING_AGENT_DIR: agentDir, PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', REQUEST_EVENT_LOG: eventLog, REQUEST_HEADER_LOG: headerLog },
      args: ['--offline', '--no-session', '-ne', '-ns', '-np', '-nc', '-e', extension, '-e', probe],
      model: 'claude-subscription/claude-sonnet-4-6',
    });
    await client.start();
    try {
      for (const message of PROMPTS) await client.promptAndWait(message, undefined, PROMPT_TIMEOUT_MS);
      const agentLoopRequests = server.requests.length;
      const agentLoopProviders = await readLines(eventLog);
      const agentLoopHeaderProviders = await readLines(headerLog);

      await client.compact();
      const compactionRequests = server.requests.slice(agentLoopRequests);
      const compactionProviders = (await readLines(eventLog)).slice(agentLoopProviders.length);
      const compactionHeaderProviders = (await readLines(headerLog)).slice(agentLoopHeaderProviders.length);

      await client.setModel(ROUTER_PROVIDER, ROUTER_MODEL);
      await client.promptAndWait('routed', undefined, PROMPT_TIMEOUT_MS);
      const routedRequests = server.requests.slice(agentLoopRequests + compactionRequests.length);
      const routedProviders = (await readLines(eventLog)).slice(agentLoopProviders.length + compactionProviders.length);
      const routedHeaderProviders = (await readLines(headerLog)).slice(agentLoopHeaderProviders.length + compactionHeaderProviders.length);

      const path = (requests: readonly RecordedRequest[], eventProviders: readonly string[], headerEventProviders: readonly string[]): PathReport => ({
        requests: requests.length,
        withBillingBlock: requests.filter(carriesBillingBlock).length,
        eventProviders,
        headerEventProviders,
      });
      const sessionIds = server.requests.map((request) => request.headers[SESSION_HEADER] ?? null);
      const report = {
        scenario: scenario.name,
        cliVersion: cliVersion.trim(),
        agentLoop: path(server.requests.slice(0, agentLoopRequests), agentLoopProviders, agentLoopHeaderProviders),
        compaction: path(compactionRequests, compactionProviders, compactionHeaderProviders),
        virtualRoute: path(routedRequests, routedProviders, routedHeaderProviders),
        userAgents: [...new Set(server.requests.map((request) => request.headers['user-agent']))],
        sessionHeaders: sessionIds,
      };

      if (systemTexts(server.requests[0]?.body)[0] !== 'x-anthropic-billing-header: cc_version=2.1.312.74c; cc_entrypoint=sdk-cli;') throw new Error('The first prompt did not get its captured fingerprint.');
      if (agentLoopRequests !== PROMPTS.length || agentLoopProviders.length !== PROMPTS.length) throw new Error('Each agent-loop prompt should send one request and fire one before_provider_request event.');
      if (compactionRequests.length === 0) throw new Error('Compaction sent no request to the gateway.');
      if (routedRequests.length !== 1) throw new Error('The routed prompt should send one request to the gateway.');
      if (server.requests.some((request) => !carriesBillingBlock(request))) throw new Error('A request reached the gateway without the billing block.');
      if (compactionProviders.length !== 0) throw new Error('Pi now fires before_provider_request for compaction requests. The extension event can carry the billing block, so move it there and delete the provider-level hook.');
      if (routedProviders.length !== 1) throw new Error('A virtual route should fire exactly one before_provider_request event.');
      if (routedProviders[0] !== ROUTER_PROVIDER) throw new Error('A before_provider_request event now names the routed provider. If every event does, the extension event can scope the billing block to claude-subscription.');
      if (report.userAgents.length !== 1 || report.userAgents[0] !== scenario.expectedUserAgent)
        throw new Error(
          `${scenario.name}: every request should carry the user agent ${scenario.expectedUserAgent}, received ${JSON.stringify(report.userAgents)}. Pi 1.4.0 does not apply a provider's static headers to requests, so the stream wrapper owns this default.`,
        );
      const sessionId = sessionIds[0];
      if (sessionId === null) throw new Error('The first request reached the gateway without the Claude session header.');
      if (sessionIds.some((value) => value === null)) throw new Error('A request reached the gateway without the Claude session header.');
      if (sessionIds.slice(0, PROMPTS.length).some((value) => value !== sessionId) || sessionIds.at(-1) !== sessionId) throw new Error('Session requests should share the Pi session id in x-claude-code-session-id.');
      if (agentLoopHeaderProviders.length !== PROMPTS.length || agentLoopHeaderProviders.some((provider) => provider !== 'claude-subscription'))
        throw new Error('Each agent-loop prompt should fire one before_provider_headers event naming claude-subscription.');
      if (compactionHeaderProviders.length !== compactionRequests.length) throw new Error('Each compaction request should fire one before_provider_headers event.');
      if (routedHeaderProviders.length !== 1 || routedHeaderProviders[0] !== ROUTER_PROVIDER)
        throw new Error('The header event should name the selected virtual provider. If it names the physical provider, a header handler can scope Claude identity to claude-subscription and the stream wrapper no longer has to own it.');
      return report;
    } finally {
      await client.stop();
    }
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}

const reports = [
  await runScenario({ name: 'models.json override', modelsHeaders: { 'user-agent': USER_AGENT_OVERRIDE }, expectedUserAgent: USER_AGENT_OVERRIDE }),
  await runScenario({ name: 'extension default', expectedUserAgent: CLAUDE_USER_AGENT }),
];
process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
