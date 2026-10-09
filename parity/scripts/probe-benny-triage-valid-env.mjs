#!/usr/bin/env node
// Probe whether the valid-config Benny triage journey can run without
// fabricating Slack credentials or live channel posts.
// Usage: node parity/scripts/probe-benny-triage-valid-env.mjs
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../', import.meta.url).pathname;
const evidenceRoot = join(root, 'evidence', 'benny-triage');
const skillPath = join(
  evidenceRoot,
  'fixture-app',
  '.upstream',
  'automations',
  'benny',
  'skills',
  'triage-issue-reports',
  'SKILL.md',
);
const exampleConfigPath = join(
  evidenceRoot,
  'fixture-app',
  '.upstream',
  'automations',
  'benny',
  'templates',
  'configuration.example.yaml',
);
const userBennyConfig = join(homedir(), '.config', 'benny', 'configuration.yaml');
const grantFlagDefault = join(homedir(), '.config', 'benny', 'test-thread-grant.json');

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function envPresent(name) {
  const v = process.env[name];
  return Boolean(v && String(v).trim());
}

async function configLooksFilled(path) {
  if (!(await pathExists(path))) return { present: false, filled: false, piNativeActions: false };
  const text = await readFile(path, 'utf8');
  const filled =
    !text.includes('SOURCE_CHANNEL_ID') &&
    !text.includes('TRIAGE_IDENTITY_USER_ID') &&
    /source_channel_id:\s*"C[A-Z0-9]+"/i.test(text);
  const piNativeActions =
    text.includes('slack.thread.read') && text.includes('slack.thread.reply');
  return { present: true, filled, piNativeActions };
}

async function grantPresent() {
  const path = process.env.BENNY_TEST_THREAD_GRANT_PATH || grantFlagDefault;
  if (!(await pathExists(path))) return { present: false, path };
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    const ok =
      data &&
      typeof data === 'object' &&
      data.scope === 'benny-test-channel-thread-posts-only' &&
      typeof data.source_channel_id === 'string' &&
      data.source_channel_id.startsWith('C');
    return { present: Boolean(ok), path };
  } catch {
    return { present: false, path };
  }
}

export async function probeBennyTriageValidEnv() {
  const cfg = await configLooksFilled(userBennyConfig);
  const grant = await grantPresent();
  const tokenOk = envPresent('BENNY_SLACK_BOT_TOKEN') || envPresent('SLACK_BOT_TOKEN');
  // Pi-native action names in operator config are necessary but not sufficient;
  // harness still needs a live Slack session (MCP tools or bot API) to invoke them.
  const actionsNamed = cfg.piNativeActions;
  const checks = {
    skillPresent: await pathExists(skillPath),
    exampleConfigPresent: await pathExists(exampleConfigPath),
    userBennyConfigPresent: cfg.present,
    userBennyConfigFilled: cfg.filled,
    bennySlackBotTokenEnv: envPresent('BENNY_SLACK_BOT_TOKEN'),
    slackBotTokenEnv: envPresent('SLACK_BOT_TOKEN'),
    configuredSlackActionsNamedPiNative: actionsNamed,
    // Still false until a capture harness proves invoke (MCP/API) works.
    configuredSlackActionsResolvableInHarness: false,
    slackMcpInteractiveAuthAvailableInThisAgent: false,
    liveSlackPostOwnerGrantPresent: grant.present,
    liveSlackPostAllowedWithoutOwnerGate: false,
    grantPath: grant.path,
  };

  const missing = [];
  if (!checks.skillPresent) missing.push('triage-issue-reports/SKILL.md missing from fixture pack');
  if (!checks.exampleConfigPresent) missing.push('configuration.example.yaml missing');
  if (!checks.userBennyConfigPresent) missing.push('no ~/.config/benny/configuration.yaml');
  else if (!checks.userBennyConfigFilled) {
    missing.push('~/.config/benny/configuration.yaml still has placeholders (run wizard-benny-valid-grants.sh)');
  }
  if (!tokenOk) {
    missing.push('no BENNY_SLACK_BOT_TOKEN or SLACK_BOT_TOKEN in environment (source ~/.config/benny/load-env.sh)');
  }
  if (!actionsNamed) {
    missing.push(
      'Slack actions not set to Pi-native slack.thread.read / slack.thread.reply (run wizard)',
    );
  }
  if (!checks.configuredSlackActionsResolvableInHarness) {
    missing.push(
      'harness cannot yet invoke Slack read/post (need live Slack MCP tools in Agent chat on this repo, or bot API wiring in capture)',
    );
  }
  if (!checks.liveSlackPostOwnerGrantPresent) {
    missing.push(
      'no test-thread owner grant at ~/.config/benny/test-thread-grant.json (run wizard stage)',
    );
  }

  const runnable = missing.length === 0;
  return {
    scenario: 'cmd-benny-triage-thread-only',
    path: 'valid-config-thread-only-verdict',
    runnable,
    verdict: runnable ? 'runnable' : 'blocker',
    checks,
    missing,
    skillAcceptanceNote:
      'triage-issue-reports requires freezing real Slack source coordinates, reading the source thread, and posting exactly one thread reply via configured Slack actions. File-backed stubs are not part of the skill contract. Filling configuration.example.yaml placeholders without operator Slack actions and credentials would fabricate a pass.',
    priorNegativePair: 'parity/evidence/benny-triage/pair-benny-triage-fail-closed-1.json',
  };
}

if (isMain) {
  const result = await probeBennyTriageValidEnv();
  await mkdir(evidenceRoot, { recursive: true });
  const outPath = join(evidenceRoot, 'valid-env-probe.json');
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result, wrote: outPath }, null, 2));
  process.exit(result.runnable ? 0 : 2);
}
