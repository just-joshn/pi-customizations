// The Benny event source as a process: /pstack automation start runs it as a watch worker in tmux.
//   node scripts/automation-serve.mjs --project <root> --kind triage|reproduce [--port <port>]
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { startEventSource } from '../../adapters/automation-events.ts';
import { loadBennyConfig } from './configuration.ts';
import { defaultCredentialFile, readCredential, SAME_UID_LIMIT } from './credentials.ts';
import { startSettler } from './settle.ts';
import { nodeGh } from './tracker-github.ts';
import { wireBenny } from './wiring.ts';

const { values } = parseArgs({ options: { project: { type: 'string' }, kind: { type: 'string' }, port: { type: 'string', default: '0' }, 'settle-poll-ms': { type: 'string', default: '5000' } } });
const kind = values.kind;
const port = Number(values.port);
const settlePollMs = Number(values['settle-poll-ms']);
if (values.project === undefined || (kind !== 'triage' && kind !== 'reproduce') || !Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(settlePollMs) || settlePollMs < 100) {
  throw new Error('usage: automation-serve.mjs --project <root> --kind triage|reproduce [--port <port>] [--settle-poll-ms <ms>]');
}
const project = realpathSync(resolve(values.project));
const configFile = resolve(project, '.pi/benny/configuration.yaml');
const config = loadBennyConfig(project, kind, configFile);

// The parent adapter alone posts, through the Slack connector; without it the automation fails closed.
const slackFile = defaultCredentialFile('slack');
const slack = readCredential(slackFile, 'token');
if (!slack.ok) throw new Error(`Slack connector credential ${slackFile} is ${slack.reason}; Benny posts only through it, so it does not start`);

const automation = wireBenny(config, { fetch, slackToken: slack.value, exec: nodeGh });
const source = await startEventSource(automation, { kind: 'webhook', credentialFile: defaultCredentialFile(config.name), port });
// A worker settles in another process, so completion is polled from the run's host state; the event log says which runs are owed.
const settler = startSettler(automation, { intervalMs: settlePollMs });
console.log(JSON.stringify({ url: source.url, automation: config.name, kind, tracker: config.tracker.type, sameUidLimit: SAME_UID_LIMIT }));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    void Promise.all([source.stop(), settler.stop()]).then(() => process.exit(0));
  });
}
