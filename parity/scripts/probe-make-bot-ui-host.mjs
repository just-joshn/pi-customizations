#!/usr/bin/env node
// Probe whether make-bot-ui can run without fabricating webhook host support.
// Usage: node parity/scripts/probe-make-bot-ui-host.mjs
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../', import.meta.url).pathname;
const evidenceRoot = join(root, 'evidence', 'make-bot-ui');
const piPackage = join(root, '..', 'extensions', 'pi-pstack');
const cursorSkill = join(root, 'reference', 'cursor-plugins', 'pstack', 'skills', 'make-bot-ui', 'SKILL.md');
const piSkill = join(piPackage, 'skills', 'make-bot-ui', 'SKILL.md');
const piRoutinesSrc = join(piPackage, 'src', 'routines.ts');
const piRefSettings = '/tmp/pi-ref-agent/settings.json';

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path) {
  if (!(await pathExists(path))) return null;
  return readFile(path, 'utf8');
}

export async function probeMakeBotUiHost() {
  const cursorSkillText = await readText(cursorSkill);
  const piSkillText = await readText(piSkill);
  const routinesSrc = await readText(piRoutinesSrc);
  let piPackages = [];
  let piSettingsOk = false;
  try {
    const settings = JSON.parse(await readFile(piRefSettings, 'utf8'));
    piPackages = Array.isArray(settings.packages) ? settings.packages : [];
    piSettingsOk = true;
  } catch {
    piSettingsOk = false;
  }

  let cursorHelp = '';
  try {
    const { stdout, stderr } = await execFileAsync(join(homedir(), '.local', 'bin', 'cursor-agent'), ['--help'], {
      timeout: 15_000,
    });
    cursorHelp = `${stdout}\n${stderr}`;
  } catch (error) {
    cursorHelp = String(error?.stdout || error?.stderr || error?.message || error);
  }

  const checks = {
    cursorSkillPresent: Boolean(cursorSkillText),
    cursorSkillRequiresUpdateState: Boolean(cursorSkillText && /Call `update_state`/i.test(cursorSkillText)),
    cursorSkillRequiresSecretRequest: Boolean(cursorSkillText && /secret-request/i.test(cursorSkillText)),
    cursorAgentHelpMentionsUpdateState: /update_state/i.test(cursorHelp),
    cursorAgentHelpMentionsWebhookRoutine: /webhook|routine/i.test(cursorHelp),
    // cursor-agent CLI help does not expose Automations update_state / Routines panel.
    // Live create of api2.cursor.sh webhook routines is not available in this PTY harness.
    cursorCliWebhookRoutinesAvailableInHarness: false,
    piSkillPresent: Boolean(piSkillText),
    piSkillRequiresRoutinePrepare: Boolean(piSkillText && /RoutinePrepare/i.test(piSkillText)),
    piRoutinesSourceRegistersPrepare: Boolean(routinesSrc && /name:\s*'RoutinePrepare'/i.test(routinesSrc)),
    piRefAgentSettingsPresent: piSettingsOk,
    piRefAgentLoadsPiPstack: piPackages.some((p) => String(p).includes('pi-pstack')),
    sandboxExecPresent: await pathExists('/usr/bin/sandbox-exec'),
    // Never treat env-planted keys as a valid journey. Absence is correct for this probe.
    senderKeyEnvAbsent: !process.env.WEBHOOK_SENDER_KEY && !process.env.AUTOMATION_SENDER_KEY,
  };

  const missing = [];
  if (!checks.cursorSkillPresent) missing.push('Cursor make-bot-ui SKILL.md missing from reference plugin');
  if (!checks.piSkillPresent) missing.push('Pi make-bot-ui SKILL.md missing from extensions/pi-pstack');
  if (!checks.piRoutinesSourceRegistersPrepare) missing.push('Pi routines.ts does not register RoutinePrepare');
  if (!checks.piRefAgentLoadsPiPstack) missing.push('PI_CODING_AGENT_DIR settings do not load extensions/pi-pstack');
  if (!checks.sandboxExecPresent) missing.push('sandbox-exec missing (Pi routine secret/state path fails closed off macOS)');
  if (!checks.cursorCliWebhookRoutinesAvailableInHarness) {
    missing.push(
      'cursor-agent PTY harness has no update_state / webhook Routines panel / secret-request delivery for Automations',
    );
  }
  if (checks.cursorSkillRequiresUpdateState && !checks.cursorAgentHelpMentionsUpdateState) {
    missing.push('Cursor skill requires update_state but cursor-agent --help does not expose it');
  }

  // Paired journey needs both hosts. Pi package support alone is not enough when Cursor CLI lacks webhook routines.
  const runnable = missing.length === 0;
  return {
    scenario: 'cmd-make-bot-ui-key-server',
    path: 'create-page-and-webhook-key-server-boundary',
    runnable,
    verdict: runnable ? 'runnable' : 'blocker',
    checks,
    missing,
    piPackages,
    skillAcceptanceNote:
      'Make Bot UI expects host webhook routine creation (Cursor update_state + secret-request, or Pi RoutinePrepare/RoutineEnable) and keeps the sender key server-side. Inventing a key, pasting one into chat, or stubbing update_state would fabricate a pass.',
  };
}

if (isMain) {
  const result = await probeMakeBotUiHost();
  await mkdir(evidenceRoot, { recursive: true });
  const out = join(evidenceRoot, 'host-env-probe.json');
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${out}`);
}
