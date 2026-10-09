#!/usr/bin/env node
// Probe whether setup-benny §8 seven-check thread-safety can run without
// fabricating Slack posts, Automations editor saves, or check passes.
// Usage: node parity/scripts/probe-setup-benny-thread-safety-env.mjs
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../', import.meta.url).pathname;
const evidenceRoot = join(root, 'evidence', 'setup-benny', 'thread-safety');
const packSkill = join(
  root,
  'evidence',
  'setup-benny',
  'fixture-app',
  '.upstream',
  'automations',
  'benny',
  'skills',
  'setup-benny',
  'SKILL.md',
);
const userBennyConfig = join(homedir(), '.config', 'benny', 'configuration.yaml');
const piAutomationsTools = join(root, '..', 'extensions', 'pi-pstack', 'src', 'automations.ts');
const piAutomationsClient = join(root, '..', 'extensions', 'pi-pstack', 'scripts', 'automation-client.mjs');
const piAutomationsTest = join(root, '..', 'extensions', 'pi-pstack', 'test', 'automations.test.ts');

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

function runCapture(cmd, args, timeoutMs = 15000) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: process.env,
    });
    return {
      ok: r.status === 0,
      status: r.status,
      stdout: (r.stdout || '').slice(0, 4000),
      stderr: (r.stderr || '').slice(0, 2000),
      error: r.error ? String(r.error.message || r.error) : null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: '',
      error: String(error?.message || error),
    };
  }
}

async function detectPiThreadSafetyLocalTools() {
  const [toolsSrc, clientSrc, testSrc] = await Promise.all([
    pathExists(piAutomationsTools) ? readFile(piAutomationsTools, 'utf8') : null,
    pathExists(piAutomationsClient) ? readFile(piAutomationsClient, 'utf8') : null,
    pathExists(piAutomationsTest) ? readFile(piAutomationsTest, 'utf8') : null,
  ]);
  if (!toolsSrc || !clientSrc || !testSrc) {
    return { available: false, reasons: ['missing automations.ts, automation-client.mjs, or automations.test.ts'] };
  }
  const reasons = [];
  if (!/name: 'AutomationRecordThreadSafety'/.test(toolsSrc)) reasons.push('missing AutomationRecordThreadSafety');
  if (!/name: 'AutomationEnable'/.test(toolsSrc) || !/enableAutomation\(/.test(toolsSrc)) {
    reasons.push('AutomationEnable must call enableAutomation after receipt+confirm');
  }
  if (!/name: 'AutomationDisable'/.test(toolsSrc) || !/export async function disableAutomation/.test(clientSrc)) {
    reasons.push('missing AutomationDisable / disableAutomation');
  }
  if (!/export async function recordThreadSafety/.test(clientSrc)) reasons.push('missing recordThreadSafety');
  if (!/kind: 'enabled'/.test(testSrc)) reasons.push('missing Enable-with-receipt test coverage');
  return { available: reasons.length === 0, reasons };
}

export async function probeSetupBennyThreadSafetyEnv() {
  const cursorHelp = runCapture('cursor-agent', ['--help']);
  const cursorHelpText = `${cursorHelp.stdout}\n${cursorHelp.stderr}`;
  const cursorMentionsAutomateUi =
    /\bautomations?\s+editor\b/i.test(cursorHelpText) ||
    /\bupdate_state\b/i.test(cursorHelpText) ||
    /\bRoutinePrepare\b/i.test(cursorHelpText);

  const slackWhich = runCapture('which', ['slack']);
  const slackDoctor = slackWhich.ok
    ? runCapture('slack', ['doctor'])
    : { ok: false, status: null, stdout: '', stderr: 'slack CLI not on PATH', error: null };
  const slackDoctorText = `${slackDoctor.stdout}\n${slackDoctor.stderr}`;
  const slackCliDoctorValid = /Token status:\s*Valid/i.test(slackDoctorText);

  const slackAuthTest = slackWhich.ok
    ? runCapture('slack', ['api', 'auth.test'])
    : { ok: false, status: null, stdout: '', stderr: 'slack CLI not on PATH', error: null };
  let slackApiAuthed = false;
  try {
    const start = slackAuthTest.stdout.indexOf('{');
    if (start >= 0) {
      const parsed = JSON.parse(slackAuthTest.stdout.slice(start));
      slackApiAuthed = parsed.ok === true;
    }
  } catch {
    slackApiAuthed = false;
  }

  const piLocal = await detectPiThreadSafetyLocalTools();

  const checks = {
    setupBennySkillPresent: await pathExists(packSkill),
    userBennyConfigPresent: await pathExists(userBennyConfig),
    bennySlackBotTokenEnv: envPresent('BENNY_SLACK_BOT_TOKEN'),
    slackBotTokenEnv: envPresent('SLACK_BOT_TOKEN'),
    slackCliOnPath: slackWhich.ok,
    slackCliDoctorTokenValid: slackCliDoctorValid,
    slackApiAuthTestOk: slackApiAuthed,
    // Cursor Automations editor / automate handoff is not a cursor-agent CLI surface.
    automationsEditorAvailableInPtyHarness: false,
    cursorAgentHelpMentionsAutomationsEditor: cursorMentionsAutomateUi,
    // Local Pi tools for receipt + enable/disable (no Slack ingress).
    piThreadSafetyLocalToolsPresent: piLocal.available,
    // Slack MCP needs interactive IDE auth; unavailable in this agent environment.
    slackMcpInteractiveAuthAvailableInThisAgent: false,
    configuredSlackActionsResolvableInHarness: false,
    // Standing prefs: customer messages need explicit account-owner action.
    liveSlackSevenCheckPostAllowedWithoutOwnerGate: false,
    designatedTestChannelConfigured: false,
  };

  const attemptedSteps = [
    {
      step: 'Read setup-benny §8 and scenario setup-benny-thread-safety.json',
      result: checks.setupBennySkillPresent
        ? 'skill present; seven checks require live triage/repro on test channel after editor save'
        : 'setup-benny SKILL.md missing from fixture pack',
    },
    {
      step: 'Check ~/.config/benny/configuration.yaml',
      result: checks.userBennyConfigPresent ? 'present' : 'absent',
    },
    {
      step: 'Check BENNY_SLACK_BOT_TOKEN / SLACK_BOT_TOKEN env',
      result:
        checks.bennySlackBotTokenEnv || checks.slackBotTokenEnv
          ? 'at least one token env set'
          : 'neither token env set',
    },
    {
      step: 'Inspect cursor-agent --help for Automations editor / update_state / RoutinePrepare',
      result: checks.cursorAgentHelpMentionsAutomationsEditor
        ? 'mentioned'
        : 'not mentioned; Automations editor unavailable in PTY harness',
    },
    {
      step: 'Call plugin-slack-slack mcp_auth',
      result:
        'failed: Interactive MCP authentication is only available in the Cursor desktop IDE',
    },
    {
      step: 'Run slack doctor',
      result: checks.slackCliDoctorTokenValid
        ? 'CLI workspace credentials report Token status Valid (app-dev auth), not Benny bot wiring'
        : 'slack doctor did not report Valid token status',
    },
    {
      step: 'Run slack api auth.test (read-only)',
      result: checks.slackApiAuthTestOk
        ? 'ok'
        : 'not_authed (CLI doctor credentials do not authorize slack api without bot/user token env or app project)',
    },
    {
      step: 'Detect Pi AutomationRecordThreadSafety / Enable / Disable',
      result: checks.piThreadSafetyLocalToolsPresent
        ? 'present (local status only; no Slack ingress)'
        : `absent (${piLocal.reasons.join('; ') || 'unknown'})`,
    },
    {
      step: 'Refuse live seven-check posts / enabling normal Benny traffic',
      result:
        'blocked by missing Cursor Automations editor path in PTY, missing Benny config/actions, Slack MCP IDE auth, and standing owner-gate on live Slack posts',
    },
  ];

  const missing = [];
  if (!checks.setupBennySkillPresent) missing.push('setup-benny/SKILL.md missing from fixture pack');
  if (!checks.userBennyConfigPresent) missing.push('no ~/.config/benny/configuration.yaml');
  if (!checks.bennySlackBotTokenEnv && !checks.slackBotTokenEnv) {
    missing.push('no BENNY_SLACK_BOT_TOKEN or SLACK_BOT_TOKEN in environment');
  }
  if (!checks.automationsEditorAvailableInPtyHarness) {
    missing.push('Automations editor / editor-save handoff unavailable in cursor-agent PTY harness');
  }
  if (!checks.piThreadSafetyLocalToolsPresent) {
    missing.push(
      piLocal.reasons.length
        ? `Pi local thread-safety tools incomplete (${piLocal.reasons.join('; ')})`
        : 'Pi local thread-safety tools incomplete',
    );
  }
  if (!checks.slackMcpInteractiveAuthAvailableInThisAgent) {
    missing.push('Slack MCP interactive auth unavailable in this agent environment (authenticate in Cursor desktop IDE after unlock)');
  }
  if (!checks.slackApiAuthTestOk) {
    missing.push('slack api auth.test not_authed; no harness-usable Slack API session for a test channel');
  }
  if (!checks.configuredSlackActionsResolvableInHarness) {
    missing.push(
      'configured Slack read/post actions are placeholders, not harness-resolvable Cursor/Reference tools',
    );
  }
  if (!checks.designatedTestChannelConfigured) {
    missing.push('no operator-designated Benny test channel / harmless-report fixture wired for seven checks');
  }
  if (!checks.liveSlackSevenCheckPostAllowedWithoutOwnerGate) {
    missing.push(
      'standing prefs forbid customer messages without explicit account-owner action (seven-check posts and enablement)',
    );
  }

  const runnable = missing.length === 0;
  return {
    scenario: 'setup-benny-thread-safety',
    path: 'seven-check-after-editor-save',
    requirementIds: ['PSTACK-SETUP-BENNY-THREAD-SAFETY-001'],
    runnable,
    verdict: runnable ? 'runnable' : 'blocker',
    checks,
    missing,
    attemptedSteps,
    skillAcceptanceNote:
      'setup-benny §8 requires a real test channel or harmless report after Automations editor save, then all seven live checks before enabling normal Benny traffic. Pi local receipt/Enable/Disable tools do not substitute for live Slack seven-checks. Fabricating check passes, stubbing Slack posts, or claiming an editor save in Cursor PTY would violate standing prefs and the capture brief.',
    piThreadSafetyLocalToolsDetection: piLocal,
  };
}

if (isMain) {
  const result = await probeSetupBennyThreadSafetyEnv();
  await mkdir(evidenceRoot, { recursive: true });
  const outPath = join(evidenceRoot, 'env-probe.json');
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result, wrote: outPath }, null, 2));
  process.exit(result.runnable ? 0 : 2);
}
