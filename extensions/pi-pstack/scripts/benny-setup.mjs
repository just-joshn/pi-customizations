#!/usr/bin/env node
// Installs the Benny pack into a project without touching local edits, reports connector state and the same-uid
// credential limit, proves the dispatcher on a harmless event with a fake spawn, and runs the thread-safety checks of
// vendor setup-benny SKILL.md section 8 against the project's own configuration with every external edge in memory.
// With --check-connectors it also checks section 4 with read-only calls to Slack and `gh`, and posts nothing.
//
//   node scripts/benny-setup.mjs --project <dir> [--name <automation>] [--credentials <file>]
//       [--check-connectors] [--slack-credentials <file>] [--slack-api-url <url>]
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { mergeBennySettings } from '../src/automation/settings.ts';
import { loadBennyConfig } from '../src/automation/configuration.ts';
import { controlSkillProblem, featureMapProblem } from '../src/automation/control-adapter.ts';
import { createAutomation } from '../adapters/automation-events.ts';
import { credentialsDir, defaultCredentialFile, readCredential, SAME_UID_LIMIT } from '../src/automation/credentials.ts';
import { checkConnectors, threadSafetyCheck } from '../src/automation/setup-check.ts';
import { nodeGh } from '../src/automation/tracker-github.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pack = join(packageRoot, 'generated', 'automations', 'benny');

const LOCAL_CONFIG = [
  ['templates/configuration.example.yaml', 'configuration.yaml'],
  ['skills/reproduce-and-fix-issues/references/feature-map.example.md', 'feature-map.md'],
  ['skills/triage-issue-reports/references/routing.example.md', 'routing.md'],
];

function files(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => statSync(join(dir, file)).isFile())
    .sort();
}

/** Copies `source` to `target` only when `target` is absent. An existing file is never replaced. */
function place(source, target) {
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    return 'added';
  }
  return readFileSync(source).equals(readFileSync(target)) ? 'unchanged' : 'conflict';
}

async function harmlessTestEvent() {
  const project = mkdtempSync(join(tmpdir(), 'benny-setup-'));
  const spawns = [];
  const thread = [];
  try {
    const automation = createAutomation(
      { name: 'setup-check', kind: 'triage', projectRoot: project, sourceChannelId: 'CSETUPCHECK' },
      {
        spawnWorker: async (runId, assignmentPath) => {
          spawns.push({ runId, assignmentPath });
        },
        destination: {
          readThread: async () => [{ ts: '1700000000.000100' }, ...thread],
          post: async (action) => {
            thread.push({ ts: `${thread.length + 1}.000000`, marker: action.id });
            return { ts: `${thread.length}.000000` };
          },
        },
        prerequisites: { tracker: async () => true },
        inputCommit: () => '0'.repeat(40),
      },
    );
    const event = { source_channel_id: 'CSETUPCHECK', ts: '1700000000.000100', text: 'benny setup check: harmless test report' };
    const first = await automation.handle(event);
    const again = await automation.handle(event);
    if (first.status !== 'dispatched' || again.status !== 'duplicate') return { ok: false, reason: `unexpected outcomes ${first.status}, ${again.status}` };
    await automation.complete(first.runId, 'Setup check only.\n[benny:other]');
    const written = readFileSync(spawns[0].assignmentPath, 'utf8') + readFileSync(join(dirname(spawns[0].assignmentPath), 'brief.md'), 'utf8');
    if (written.includes(credentialsDir())) return { ok: false, reason: 'assignment or brief names the credentials directory' };
    const ok = spawns.length === 1 && thread.length === 1;
    return ok ? { ok, spawns: spawns.length, replies: thread.length } : { ok, reason: `spawns ${spawns.length}, replies ${thread.length}` };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

/** What still stops each automation from acting on the project's own configuration. Informational: setup succeeds either way. */
function readiness(root) {
  const result = {};
  for (const kind of ['triage', 'reproduce']) {
    try {
      const config = loadBennyConfig(root, kind);
      result[kind] = { config: 'ok', tracker: config.tracker.type, featureMap: featureMapProblem(root, config.control.featureMapPath) ?? 'ok', controlSkill: controlSkillProblem(config.control.skillName, { projectRoot: root }) ?? 'ok' };
    } catch (error) {
      result[kind] = { config: error.message };
    }
  }
  return result;
}

const { values } = parseArgs({ options: { project: { type: 'string' }, name: { type: 'string', default: 'benny-triage' }, credentials: { type: 'string' }, 'check-connectors': { type: 'boolean' }, 'slack-credentials': { type: 'string' }, 'slack-api-url': { type: 'string' } } });
if (values.project === undefined) {
  console.error('usage: benny-setup.mjs --project <dir> [--name <automation>] [--credentials <file>] [--check-connectors] [--slack-credentials <file>] [--slack-api-url <url>]');
  process.exit(2);
}
const project = resolve(values.project);
const packTarget = join(project, '.pi', 'automations', 'benny');
const configTarget = join(project, '.pi', 'benny');

const report = { pack: { added: [], unchanged: [], conflicts: [] }, localConfig: { added: [], unchanged: [], conflicts: [] } };
const bucket = { added: 'added', unchanged: 'unchanged', conflict: 'conflicts' };
for (const file of files(pack)) report.pack[bucket[place(join(pack, file), join(packTarget, file))]].push(file);
for (const [source, target] of LOCAL_CONFIG) report.localConfig[bucket[place(join(pack, source), join(configTarget, target))]].push(relative(project, join(configTarget, target)));

const credentialFile = values.credentials ?? defaultCredentialFile(values.name);
mkdirSync(dirname(credentialFile), { recursive: true });
try {
  writeFileSync(credentialFile, JSON.stringify({ key: randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
report.settings = mergeBennySettings(join(project, '.pi', 'settings.json'));
const credential = readCredential(credentialFile, 'key');
report.connector = { webhookSecret: credential.ok ? 'present, 0600' : credential.reason };
report.sameUidLimit = SAME_UID_LIMIT;
report.testEvent = await harmlessTestEvent();
report.readiness = readiness(project);

// The checks need a filled configuration. One that still has the template's placeholders, or that does not load, is reported and does not fail setup.
let config;
try {
  config = loadBennyConfig(project, 'triage');
} catch (error) {
  report.threadSafety = { skipped: `the configuration does not load yet: ${error.message}` };
}
const filled = config !== undefined && /^[A-Z0-9]{2,32}$/.test(config.sourceChannelId);
if (config !== undefined) report.threadSafety = filled ? await threadSafetyCheck(config) : { skipped: 'the configuration still has placeholder values' };
if (values['check-connectors']) {
  if (!filled) report.connectors = { skipped: 'the configuration is not filled in yet' };
  else {
    const slackFile = values['slack-credentials'] ?? defaultCredentialFile('slack');
    const slack = readCredential(slackFile, 'token');
    report.connectors = await checkConnectors(config, { fetch, slack: slack.ok ? { ok: true, token: slack.value } : { ok: false, reason: slack.reason }, ...(values['slack-api-url'] === undefined ? {} : { baseUrl: values['slack-api-url'] }), exec: nodeGh });
  }
}

console.log(JSON.stringify(report, null, 2));
const failed = report.threadSafety?.ok === false || (Array.isArray(report.connectors) && report.connectors.some((check) => !check.ok));
process.exit(report.testEvent.ok && !failed ? 0 : 1);
