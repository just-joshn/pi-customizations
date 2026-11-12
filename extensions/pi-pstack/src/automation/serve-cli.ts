// The Benny event source as a process: /pstack automation start runs it as a watch worker in tmux.
//   node scripts/automation-serve.mjs --project <root> --kind triage|reproduce [--port <port>]
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { parse } from 'yaml';
import { createAutomation, startEventSource } from '../../adapters/automation-events.ts';
import { loadBennyConfig } from './configuration.ts';
import { defaultCredentialFile, readCredential, SAME_UID_LIMIT } from './credentials.ts';
import { slackDestination } from './slack.ts';

const { values } = parseArgs({ options: { project: { type: 'string' }, kind: { type: 'string' }, port: { type: 'string', default: '0' } } });
const kind = values.kind;
const port = Number(values.port);
if (values.project === undefined || (kind !== 'triage' && kind !== 'reproduce') || !Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('usage: automation-serve.mjs --project <root> --kind triage|reproduce [--port <port>]');
}
const project = realpathSync(resolve(values.project));
const configFile = resolve(project, '.pi/benny/configuration.yaml');
const config = loadBennyConfig(project, kind, configFile);

// The parent adapter alone posts, through the Slack connector; without it the automation fails closed.
const slackFile = defaultCredentialFile('slack');
const slack = readCredential(slackFile, 'token');
if (!slack.ok) throw new Error(`Slack connector credential ${slackFile} is ${slack.reason}; Benny posts only through it, so it does not start`);

const featureMap = (parse(readFileSync(configFile, 'utf8')) as { control: { feature_map_path: string } }).control.feature_map_path;
const featureMapFile = resolve(project, featureMap);
const automation = createAutomation(config, {
  destination: slackDestination({ fetch, token: slack.value }),
  // No tracker or control adapter ships with this package, so cases needing one are logged blocked, never guessed.
  prerequisites: { featureMap: async () => !relative(project, featureMapFile).startsWith('..') && existsSync(featureMapFile) },
});
const source = await startEventSource(automation, { kind: 'webhook', credentialFile: defaultCredentialFile(config.name), port });
console.log(JSON.stringify({ url: source.url, automation: config.name, kind, unprobedPrerequisites: ['tracker', 'controlAdapter'], sameUidLimit: SAME_UID_LIMIT }));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    void source.stop().then(() => process.exit(0));
  });
}
