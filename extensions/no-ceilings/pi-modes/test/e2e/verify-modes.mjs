#!/usr/bin/env node
/**
 * End-to-end check against the real `pi` binary.
 *
 * Runs the extension from source in a throwaway workspace, skill directory, and session directory,
 * then asserts what the model was actually sent: the execution-mode guidance, the shell guard, the
 * entered custom-mode skill block, the sticky reminder, the exit notice, and the one-message skill
 * attachment. A probe extension records every provider payload so the checks read the request
 * instead of trusting the model's answer.
 *
 * Usage:
 *   node test/e2e/verify-modes.mjs
 *   PI_MODES_E2E_MODEL=provider/model node test/e2e/verify-modes.mjs
 *
 * Needs a logged-in Pi model. Exits 77 when `pi` is missing or the model cannot answer, so a
 * machine without credentials skips it without looking like a failure.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_CODE = 77;
const ZERO = 0;
const TIMEOUT_MS = 420_000;
const SKILL_MARKER = 'BODYMARKER-9F3C';
const REMINDER_TEXT = 'Reminder: you are still in Reviewer mode.';
const EXIT_TEXT = 'The user has exited Reviewer custom mode.';
const ENTERED_TEXT = 'The user has entered Reviewer custom mode.';
const ENTERED_BLOCK = '<skill name="reviewer"';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(scriptDir, '../../src/index.ts');
const model = process.env.PI_MODES_E2E_MODEL ?? 'deepseek-flash';

const root = mkdtempSync(join(tmpdir(), 'pi-modes-e2e-'));
const workspace = join(root, 'workspace');
const skillDir = join(workspace, '.pi', 'skills', 'reviewer');
const probeDir = join(root, 'probe');
const payloadPath = join(root, 'payloads.jsonl');

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function note(message) {
  console.log(`ok ${message}`);
}

mkdirSync(skillDir, { recursive: true });
mkdirSync(probeDir, { recursive: true });
writeFileSync(join(skillDir, 'SKILL.md'), ['---', 'name: reviewer', 'description: Reviews diffs before they ship', 'icon: "⚡"', 'color: magenta', '---', '', `${SKILL_MARKER}. Review every diff before it ships.`, ''].join('\n'));
writeFileSync(
  join(probeDir, 'index.ts'),
  [
    "import { appendFileSync } from 'node:fs';",
    "import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';",
    '',
    'export default function probePayloads(pi: ExtensionAPI): void {',
    "  pi.on('before_provider_request', async (event) => {",
    `    appendFileSync(${JSON.stringify(payloadPath)}, \`\${JSON.stringify(event.payload)}\\n\`);`,
    '  });',
    '}',
    '',
  ].join('\n'),
);

function runModes(name, { args = [], prompts }) {
  const runDir = join(root, 'runs', name);
  mkdirSync(runDir, { recursive: true });
  rmSync(payloadPath, { force: true });
  const result = spawnSync('pi', ['-p', '--session-dir', runDir, '-ne', '-e', extensionPath, '-e', join(probeDir, 'index.ts'), '-np', '-nc', '--no-themes', '--approve', '--model', model, ...args, '--', ...prompts], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  if (result.error) {
    console.error(`SKIP pi could not start: ${result.error.message}`);
    process.exit(SKIP_CODE);
  }
  const combined = `${result.stdout}${result.stderr}`;
  if (result.status !== ZERO) {
    console.error(combined);
    if (/credential|not_ready|auth|api key/i.test(combined)) {
      console.error('SKIP model is not authenticated');
      process.exit(SKIP_CODE);
    }
    fail(`${name} exited ${result.status}`);
  }
  const payloads = existsSync(payloadPath)
    ? readFileSync(payloadPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > ZERO)
    : [];
  if (payloads.length === ZERO) {
    console.error(combined);
    if (/credential|not_ready|auth|api key/i.test(combined)) {
      console.error('SKIP model is not authenticated');
      process.exit(SKIP_CODE);
    }
    fail(`${name} sent no provider request`);
  }
  const texts = payloads.map(payloadText);
  const sessionEntries = readdirSync(runDir)
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) =>
      readFileSync(join(runDir, file), 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > ZERO)
        .map((line) => JSON.parse(line)),
    );
  return { stdout: result.stdout, first: texts[ZERO], last: texts.at(-1), sessionEntries };
}

function readSkillFile() {
  return readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
}

/** Every text block the provider was sent, so assertions read prose instead of escaped JSON. */
function payloadText(line) {
  const payload = JSON.parse(line);
  const parts = [];
  for (const message of payload.messages ?? []) {
    if (typeof message.content === 'string') {
      parts.push(message.content);
      continue;
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (typeof block?.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.join('\n');
}

console.log(`evidence root: ${root}`);

const plan = runModes('plan-flag', { args: ['--plan'], prompts: ['Reply with the active execution mode name.'] });
if (!plan.first.includes('[PLAN MODE ACTIVE]')) {
  fail('the plan-mode guidance never reached the provider request');
}
note('--plan puts the plan-mode guidance in the provider request');

const ask = runModes('ask-mode', {
  args: ['--mode=ask', '--exclude-tools', 'switch_mode'],
  prompts: ['Call the bash tool with exactly this command and nothing else: echo hi > out-ask.txt'],
});
if (!ask.first.includes('[ASK MODE ACTIVE]')) {
  fail('the ask-mode guidance never reached the provider request');
}
if (existsSync(join(workspace, 'out-ask.txt'))) {
  fail('ask mode wrote the file the read-only mode must not allow');
}
note('--mode=ask sends the read-only guidance and no mutating write happened');

const agent = runModes('agent-mode', { prompts: ['Use the bash tool once to run exactly: echo hi > out-agent.txt — then reply DONE.'] });
if (!existsSync(join(workspace, 'out-agent.txt'))) {
  fail('agent mode did not write the file, so the ask-mode comparison proves nothing');
}
note('agent mode runs the same command, so the ask-mode block is the mode and not the command');

const entered = runModes('custom-entered', { args: ['--mode=reviewer'], prompts: ['Reply with the token that appears in your mode skill.'] });
if (!entered.first.includes(ENTERED_TEXT)) {
  fail('the entered custom-mode instruction never reached the provider request');
}
if (!entered.first.includes(ENTERED_BLOCK) || !entered.first.includes(SKILL_MARKER)) {
  fail('the entered turn did not carry the skill block');
}
note('--mode=reviewer attaches the whole skill block on the entered turn');
if (entered.stdout.includes(SKILL_MARKER)) {
  note('the model answered with the skill marker');
} else {
  console.log(`note the model did not echo the marker; provider request evidence stands. stdout: ${entered.stdout.trim().slice(ZERO, 200)}`);
}

const sticky = runModes('custom-sticky', { args: ['--mode=reviewer'], prompts: ['Start reviewing.', 'Which custom mode is active? Reply with its label only.'] });
if (!sticky.first.includes(ENTERED_BLOCK)) {
  fail('the first turn of the sticky run did not carry the skill block');
}
if (!sticky.last.includes(REMINDER_TEXT)) {
  fail('the second turn did not carry the sticky reminder');
}
if (sticky.last.includes(ENTERED_BLOCK)) {
  fail('the second turn repeated the whole skill block instead of the reminder');
}
if (!/Reviewer/i.test(sticky.stdout)) {
  fail(`the model did not report the active custom mode: ${sticky.stdout.trim()}`);
}
note('later turns carry the sticky reminder, not a second copy of the skill block');
if (!sticky.sessionEntries.some((entry) => entry.customType === 'pi-modes-state' && entry.data?.customMode?.label === 'Reviewer' && entry.data?.customMode?.lifecycle === 'active')) {
  fail('the active custom mode was not persisted as active');
}
note('the active custom mode persists in the session as active');

const exited = runModes('custom-exit', { args: ['--mode=reviewer'], prompts: ['Start reviewing.', '/mode off', 'Which custom mode is active? Reply NONE if none.'] });
if (!exited.last.includes(EXIT_TEXT)) {
  fail('the exit notice never reached the provider request');
}
if (exited.last.includes(REMINDER_TEXT)) {
  fail('the exited mode still injected its sticky reminder');
}
note('/mode off states the exit once and stops the reminder');

const appearance = runModes('custom-appearance', {
  args: ['--mode=reviewer'],
  prompts: ['/mode color red', '/mode icon ★', '/mode color chartreuse', 'Reply DONE.'],
});
const skillFile = readSkillFile();
if (!skillFile.includes('color: "red"') || !skillFile.includes('icon: "★"')) {
  fail(`/mode color and /mode icon did not write the skill frontmatter: ${skillFile}`);
}
if (skillFile.includes('chartreuse')) {
  fail('an unknown color name was written into the skill file');
}
if (!skillFile.includes(SKILL_MARKER)) {
  fail('/mode color dropped the skill body');
}
note('/mode color and /mode icon write validated frontmatter and keep the body');

const oneMessage = runModes('one-message-skill', { prompts: ['The next step uses /reviewer. Reply with the token from that skill.', 'Reply NONE if no skill came with this turn.'] });
if (!oneMessage.first.includes(ENTERED_BLOCK) || !oneMessage.first.includes(SKILL_MARKER)) {
  fail('a prompt that mentions /reviewer did not attach the skill');
}
if (oneMessage.last.includes(ENTERED_BLOCK)) {
  fail('the one-message skill attachment leaked into the next turn');
}
note('/reviewer attaches the skill to that message only');

console.log(`PASS ${root}`);
