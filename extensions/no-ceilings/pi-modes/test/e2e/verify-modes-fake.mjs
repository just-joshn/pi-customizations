#!/usr/bin/env node
/**
 * Deterministic end-to-end check against the real `pi` binary.
 *
 * Pi points at a local OpenAI-compatible server, so the test needs no credentials and no real
 * model. The checks read the requests the runtime actually sent, then assert the read-only
 * loadout, the blocked tool call, the custom-mode skill block, the sticky reminder, a mode switch
 * through the switch_mode tool, and a mode change through the /mode command.
 *
 * Usage:
 *   node test/e2e/verify-modes-fake.mjs
 *   PI_MODES_E2E_KEEP=1 node test/e2e/verify-modes-fake.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFakeModelServer } from './fake-model-server.mjs';

const ZERO = 0;
const SKIP_CODE = 77;
const TIMEOUT_MS = 120_000;
const SKILL_MARKER = 'FAKE_BODY_MARKER';
const ENTERED_TEXT = 'The user has entered Reviewer custom mode.';
const REMINDER_TEXT = 'Reminder: you are still in Reviewer mode.';
const EXIT_TEXT = 'The user has exited Reviewer custom mode.';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(scriptDir, '../../src/index.ts');

const root = mkdtempSync(join(tmpdir(), 'pi-modes-fake-e2e-'));
const workspace = join(root, 'workspace');
const agentDir = join(root, 'agent');
const skillDir = join(workspace, '.pi', 'skills', 'reviewer');
const victimPath = join(workspace, 'victim.txt');

let server;

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function check(name, condition, detail) {
  if (condition) {
    console.log(`ok ${name}`);
    return;
  }
  fail(detail ? `${name}: ${detail}` : name);
}

function textOf(payload) {
  return (payload.messages ?? [])
    .flatMap((message) => {
      if (typeof message.content === 'string') {
        return [message.content];
      }
      return (Array.isArray(message.content) ? message.content : []).map((block) => (typeof block?.text === 'string' ? block.text : ''));
    })
    .join('\n');
}

function toolNames(payload) {
  return (payload.tools ?? []).map((tool) => tool.function?.name).filter((name) => typeof name === 'string');
}

async function run(name, { args = [], prompts }) {
  const runDir = join(root, 'sessions', name);
  mkdirSync(runDir, { recursive: true });
  server.reset();
  return await new Promise((resolveRun) => {
    const child = spawn('pi', ['-p', '--session-dir', runDir, '-ne', '-e', extensionPath, '-np', '-nc', '--no-themes', '--approve', '--model', 'fake/echo', ...args, '--', ...prompts], {
      cwd: workspace,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(`${name} timed out after ${TIMEOUT_MS}ms`);
    }, TIMEOUT_MS);
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      console.error(`SKIP pi could not start: ${error.message}`);
      process.exit(SKIP_CODE);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== ZERO) {
        console.error(stdout);
        console.error(stderr);
        fail(`${name} exited ${code}`);
      }
      resolveRun({ stdout, stderr, requests: server.requests(), runDir });
    });
  });
}

server = await startFakeModelServer();
mkdirSync(agentDir, { recursive: true });
mkdirSync(skillDir, { recursive: true });
writeFileSync(
  join(agentDir, 'models.json'),
  JSON.stringify({
    providers: {
      fake: {
        baseUrl: server.baseUrl,
        api: 'openai-completions',
        apiKey: 'fake',
        models: [{ id: 'echo', name: 'Echo', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16_000, maxTokens: 512 }],
      },
    },
  }),
  'utf-8',
);
writeFileSync(join(skillDir, 'SKILL.md'), ['---', 'name: reviewer', 'description: Reviews diffs before they ship', 'icon: "◆"', 'color: red', '---', '', `${SKILL_MARKER}. Review every diff before it ships.`, ''].join('\n'), 'utf-8');
writeFileSync(victimPath, 'keep me', 'utf-8');

const guard = await run('ask-guard', { args: ['--mode=ask'], prompts: ['USE_TOOL'] });
check('ask run exits 0', guard.requests.length > ZERO);
check('ask run sends the mode guidance', textOf(guard.requests[ZERO]).includes('[ASK MODE ACTIVE]'));
const askTools = toolNames(guard.requests[ZERO]);
check('ask loadout drops edit, write, and powershell', !askTools.includes('edit') && !askTools.includes('write') && !askTools.includes('powershell'), askTools.join(','));
check(
  'the runtime blocks the mutating tool call',
  guard.requests.some((request) => textOf(request).includes('mutating shell command blocked')),
);
check('the blocked command did not run', existsSync(victimPath));
check('the run continues after the block', guard.stdout.includes('DONE_AFTER_TOOL'));

const custom = await run('custom-mode', { args: ['--mode=reviewer'], prompts: ['start reviewing', 'a later turn'] });
check('custom run sends the entered instruction', textOf(custom.requests[ZERO]).includes(ENTERED_TEXT));
check('custom run attaches the real skill body', textOf(custom.requests[ZERO]).includes(SKILL_MARKER));
check('custom run attaches the skill block', textOf(custom.requests[ZERO]).includes('<skill name="reviewer"'));
const later = textOf(custom.requests.at(-1));
check('the later turn carries the reminder', later.includes(REMINDER_TEXT));
check('the later turn does not repeat the skill body', !later.includes(SKILL_MARKER));

const exited = await run('custom-exit', { args: ['--mode=reviewer'], prompts: ['Start reviewing.', '/mode off', 'Which custom mode is active? Reply NONE if none.'] });
const exitedLast = textOf(exited.requests.at(-1));
check('/mode off states the exit once and stops the reminder', exitedLast.includes(EXIT_TEXT) && !exitedLast.includes(REMINDER_TEXT));

const appearance = await run('custom-appearance', { args: ['--mode=reviewer'], prompts: ['/mode color red', '/mode icon ★', '/mode color chartreuse', 'Reply DONE.'] });
const savedReviewer = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
check(
  '/mode color and /mode icon write validated frontmatter and keep the body',
  savedReviewer.includes('color: "red"') && savedReviewer.includes('icon: "★"') && !savedReviewer.includes('chartreuse') && savedReviewer.includes(SKILL_MARKER),
);

const oneMessage = await run('one-message-skill', { prompts: ['The next step uses /reviewer. Reply with the token from that skill.', 'Reply NONE if no skill came with this turn.'] });
check(
  '/reviewer attaches the skill to that message only',
  textOf(oneMessage.requests[ZERO]).includes('<skill name="reviewer"') && textOf(oneMessage.requests[ZERO]).includes(SKILL_MARKER) && !textOf(oneMessage.requests.at(-1)).includes('<skill name="reviewer"'),
);

const switched = await run('switch-tool', { prompts: ['SWITCH_TO_ASK'] });
check('switch run sends a second request', switched.requests.length >= 2);
check(
  'the switch tool reached the model as success',
  switched.requests.some((request) => textOf(request).includes('Switched from Agent to Ask mode.')),
);
const afterSwitch = switched.requests.at(-1);
check('the request after switch_mode carries the Ask guidance', textOf(afterSwitch).includes('[ASK MODE ACTIVE]'));
check('the request after switch_mode uses the read-only loadout', !toolNames(afterSwitch).includes('edit'), toolNames(afterSwitch).join(','));

const plan = await run('slash-plan', { prompts: ['/mode plan', 'go'] });
const afterPlan = plan.requests.at(-1);
check('the request after /mode plan carries the Plan guidance', textOf(afterPlan).includes('[PLAN MODE ACTIVE]'));
check('/mode plan offers create_plan', toolNames(afterPlan).includes('create_plan'), toolNames(afterPlan).join(','));

const inline = await run('inline', { prompts: ['/mode reviewer Check this inline.', 'Continue in the same mode.'] });
check('print mode sends the prompt embedded in /mode', inline.requests.length === 2 && textOf(inline.requests[ZERO]).includes('Check this inline.'));
check('the embedded prompt enters the requested custom mode', textOf(inline.requests[ZERO]).includes(SKILL_MARKER));
check('the next positional prompt keeps the mode', textOf(inline.requests.at(-1)).includes(REMINDER_TEXT));
const inlineOnly = await run('inline-only', { prompts: ['/mode ask Explain this inline.'] });
check('print mode waits for a lone slash-command prompt', inlineOnly.requests.length === 1 && textOf(inlineOnly.requests[ZERO]).includes('Explain this inline.'));
check('the inline Ask prompt gets read-only guidance', textOf(inlineOnly.requests[ZERO]).includes('[ASK MODE ACTIVE]'));

const paletteFile = join(workspace, '.pi', 'skills', 'palette-review.md');
const paletteBody = 'PALETTE_BODY. Review the color choices.';
writeFileSync(paletteFile, `---\nname: palette-review\ntitle: Color Palette\ndescription: Reviews color choices\ncolor: >-\n  blue\n---\n\n${paletteBody}\n`);
const palette = await run('palette', { prompts: ['/mode Color Palette', '/mode color red', '/mode icon ◆', 'Review the palette.', 'Continue.'] });
const savedPalette = readFileSync(paletteFile, 'utf8');
check('an exact title wins over the appearance verb and loads the single-file skill', palette.requests.length === 2 && textOf(palette.requests[ZERO]).includes(paletteBody));
check(
  'appearance edits replace a folded value without damaging the skill',
  savedPalette.includes('title: Color Palette') && /color:\s*["']?red/.test(savedPalette) && !savedPalette.includes('  blue') && savedPalette.includes('◆') && savedPalette.endsWith(`${paletteBody}\n`),
);
check('the reminder names the single-file skill', textOf(palette.requests.at(-1)).includes('palette-review.md'));

const unknown = await run('unknown', { args: ['--mode=plna'], prompts: ['Continue.'] });
check('an unknown startup mode warns on stderr in print mode', unknown.stderr.includes('Unknown mode "plna"'));

const kickoffFile = join(root, 'kickoff.ts');
writeFileSync(
  kickoffFile,
  `export default function (pi) {
    pi.registerCommand('kickoff', {
      description: 'Trigger a custom turn',
      handler: async (_args, ctx) => {
        pi.sendMessage({ customType: 'test-kickoff', content: 'KICKOFF_MARKER', display: true }, { triggerTurn: true });
        await ctx.waitForIdle();
      },
    });
  }`,
);
const kickoff = await run('kickoff', { args: ['--mode=reviewer', '-e', kickoffFile], prompts: ['/kickoff'] });
check('an extension-triggered first turn receives the custom skill', kickoff.requests.length === 1 && textOf(kickoff.requests[ZERO]).includes('KICKOFF_MARKER') && textOf(kickoff.requests[ZERO]).includes(SKILL_MARKER));

const sessionFileName = readdirSync(custom.runDir).find((name) => name.endsWith('.jsonl'));
check('the selected custom mode has a session file', sessionFileName !== undefined);
const sessionFile = join(custom.runDir, sessionFileName);
const snapshots = () =>
  readFileSync(sessionFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'custom' && entry.customType === 'pi-modes-state');
const snapshotCount = snapshots().length;
const resumed = await run('resumed', { args: ['--session', sessionFile], prompts: ['Continue the review.'] });
check('the resumed custom mode still sends its reminder', resumed.requests.length === 1 && textOf(resumed.requests[ZERO]).includes(REMINDER_TEXT));
check('resuming does not append an unchanged snapshot', snapshots().length === snapshotCount);

await server.close();
if (process.env.PI_MODES_E2E_KEEP !== '1') {
  rmSync(root, { recursive: true, force: true });
} else {
  console.log(`evidence root: ${root}`);
}
console.log('PASS deterministic end-to-end mode checks');
