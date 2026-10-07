import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';
import { afterEach, expect, test } from 'vitest';
import { runCli } from '../../src/cli/commands.ts';
import { humanOnlyKind, splitArgs } from '../../src/index.ts';
import { testContext } from '../support/context.ts';
import { commandContext, eventContext, fakeUi, loadFakePi, toolContext } from '../support/fake-pi.ts';
import { INSTALLED } from '../unit/support.ts';
import { tempRepo } from './repo.ts';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function repo(): string {
  const cwd = tempRepo();
  dirs.push(cwd);
  return cwd;
}

async function startedRun(): Promise<string> {
  const cwd = repo();
  await runCli(['registry', 'refresh', '--from', 'leaderboard.2026-10-07.json', '--sources', 'skill-sources.2026-10-07.json'], testContext(cwd));
  await runCli(['feature', 'export invoices', '--installed', INSTALLED.map((skill) => skill.name).join(',')], testContext(cwd));
  return cwd;
}

// Pi loads the package through jiti; a copy keeps the checkout's src/index.ts out of the loader cache.
async function loadPackage() {
  const [cwd, agentDir, packageDir] = await Promise.all(['s50-cwd-', 's50-agent-', 's50-package-'].map(tempDir));
  if (cwd === undefined || agentDir === undefined || packageDir === undefined) throw new Error('temp dirs missing');
  await Promise.all(['package.json', 'src', 'skills', 'registry'].map((entry) => cp(join(PACKAGE_DIR, entry), join(packageDir, entry), { recursive: true })));
  return discoverAndLoadExtensions([packageDir], cwd, agentDir);
}

test('Pi registers exactly one s50 command with one s50 tool', async () => {
  const { errors, extensions } = await loadPackage();
  expect(errors).toStrictEqual([]);
  expect(extensions).toHaveLength(1);
  const [loaded] = extensions;
  expect([...(loaded?.commands.keys() ?? [])]).toStrictEqual(['s50']);
  expect([...(loaded?.tools.keys() ?? [])]).toStrictEqual(['s50']);
  const tool = loaded?.tools.get('s50')?.definition;
  expect([tool?.executionMode, tool?.annotations, tool?.promptGuidelines?.length]).toStrictEqual(['sequential', { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, 3]);
});

test('the s50 skill frontmatter names s50 with a Use when trigger', async () => {
  const text = await readFile(join(PACKAGE_DIR, 'skills/s50/SKILL.md'), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  const frontmatter = match?.[1] ?? '';
  const body = match?.[2] ?? '';
  expect(/^name: (.+)$/m.exec(frontmatter)?.[1]).toBe('s50');
  expect(/^description: (.+)$/m.exec(frontmatter)?.[1]).toContain('Use when');
  expect(body.split('\n').length).toBeLessThanOrEqual(80);
});

test('the s50 tool reports no run in a fresh repository', async () => {
  const { tool } = loadFakePi();
  await expect(tool.execute('call-1', { argv: ['status'] }, undefined, undefined, toolContext(repo(), null))).rejects.toThrow(/^no run in \.s50\/\n$/);
});

test('a blocked run comes back as an error result with details', async () => {
  const { tool } = loadFakePi();
  const cwd = repo();
  const result = await tool.execute('call-2', { argv: ['feature', 'export invoices'] }, undefined, undefined, toolContext(cwd, null));
  expect([result.isError, result.details]).toStrictEqual([true, { code: 2 }]);
});

test('Pi skill discovery feeds the run its installed skills', async () => {
  const fresh = repo();
  const { tool } = loadFakePi({ skills: [{ name: 'tdd', path: join(fresh, 'missing/SKILL.md') }] });
  await runCli(['registry', 'refresh', '--from', 'leaderboard.2026-10-07.json', '--sources', 'skill-sources.2026-10-07.json'], testContext(fresh));
  const result = await tool.execute('call-3', { argv: ['feature', 'export invoices'] }, undefined, undefined, toolContext(fresh, null));
  const run = JSON.parse(await readFile(join(fresh, '.s50/run.json'), 'utf8'));
  expect([result.isError, result.details, run.capabilities.installedSkills]).toStrictEqual([undefined, { code: 3 }, [{ name: 'tdd', contentHash: null }]]);
});

test('a subagent tool marks the host as having independent agents', async () => {
  const { tool } = loadFakePi({ tools: ['subagent'] });
  const cwd = repo();
  await runCli(['registry', 'refresh', '--from', 'leaderboard.2026-10-07.json', '--sources', 'skill-sources.2026-10-07.json'], testContext(cwd));
  await tool.execute('call-4', { argv: ['feature', 'export invoices'] }, undefined, undefined, toolContext(cwd, null));
  const run = JSON.parse(await readFile(join(cwd, '.s50/run.json'), 'utf8'));
  expect(run.capabilities.independentAgents).toBe(true);
});

const CONFIRM_SEAMS = ['apply', '{"kind":"confirm_seams","ids":["csv"]}'];

test('the model cannot confirm seams without a UI', async () => {
  const { tool } = loadFakePi();
  await expect(tool.execute('call-5', { argv: CONFIRM_SEAMS }, undefined, undefined, toolContext(tmpdir(), null))).rejects.toThrow(`confirm_seams records a user decision; ask the user to run /s50 ${CONFIRM_SEAMS.join(' ')}`);
});

test('a declined confirmation blocks the human-only command', async () => {
  const { tool } = loadFakePi();
  const ui = fakeUi(false);
  await expect(tool.execute('call-6', { argv: CONFIRM_SEAMS }, undefined, undefined, toolContext(tmpdir(), ui))).rejects.toThrow('user declined confirm_seams');
  expect(ui.confirms).toStrictEqual([`S50: confirm_seams: ${CONFIRM_SEAMS[1]}`]);
});

test.for([
  [['apply', '{"kind":"answer_decisions","decisions":[{"id":"q","question":"?","answer":"a","decidedBy":"user"}]}'], 'answer_decisions'],
  [['apply', '{"kind":"answer_decisions","decisions":[{"id":"q","question":"?","answer":"a","decidedBy":"fact"}]}'], null],
  [['apply', '{"kind":"grant_authorization","action":"merge","scope":"PR 1"}'], 'grant_authorization'],
  [['status'], null],
] as const)('%j human-only kind is %s', ([argv, expected]) => {
  expect(humanOnlyKind(argv)).toBe(expected);
});

test.for([
  ['apply \'{"kind":"advance","to":"DOMAIN"}\'', ['apply', '{"kind":"advance","to":"DOMAIN"}']],
  ['feature "export invoices" --criteria a\\;b', ['feature', 'export invoices', '--criteria', 'a;b']],
  ['apply "{\\"kind\\":\\"freeze_revision\\"}"', ['apply', '{"kind":"freeze_revision"}']],
] as const)('splitArgs(%s)', ([text, expected]) => {
  expect(splitArgs(text)).toStrictEqual(expected);
});

test('/s50 posts its output to the transcript', async () => {
  const { command, sent } = loadFakePi();
  const ui = fakeUi(true);
  await command.handler('status', commandContext(repo(), ui));
  expect([sent.map((message) => [message.customType, message.content, message.display]), ui.notes]).toStrictEqual([[['s50', 'no run in .s50/\n', true]], ['error: s50 exited 1']]);
});

test('/s50 completes its subcommands', async () => {
  const { command } = loadFakePi();
  expect(await command.getArgumentCompletions?.('re')).toStrictEqual([
    { value: 'resume', label: 'resume' },
    { value: 'registry', label: 'registry' },
  ]);
});

async function bashCall(handlers: ReturnType<typeof loadFakePi>['handlers'], cwd: string, command: string, ui: ReturnType<typeof fakeUi> | null) {
  const [handler] = handlers.get('tool_call') ?? [];
  if (handler === undefined) throw new Error('no tool_call handler');
  return handler({ type: 'tool_call', toolCallId: 't1', toolName: 'bash', input: { command } }, eventContext(cwd, ui));
}

test('a force-push during a run is blocked without a UI', async () => {
  const { handlers } = loadFakePi();
  expect(await bashCall(handlers, await startedRun(), 'git push --force origin main', null)).toStrictEqual({
    block: true,
    reason: 'S50 stops for force_push: ask the user to authorize this exact command',
  });
});

test('a confirmed force-push is recorded as an exact grant', async () => {
  const { handlers } = loadFakePi();
  const cwd = await startedRun();
  expect(await bashCall(handlers, cwd, 'git push --force origin main', fakeUi(true))).toStrictEqual(undefined);
  const decisions = (await readFile(join(cwd, '.s50/decisions.jsonl'), 'utf8')).trim().split('\n').slice(-2);
  expect(decisions.map((line) => JSON.parse(line).summary)).toStrictEqual(['authorization requested: force_push git push --force origin main', 'authorization granted: force_push git push --force origin main']);
});

test('gated commands outside an S50 run pass through', async () => {
  const { handlers } = loadFakePi();
  expect(await bashCall(handlers, repo(), 'git push --force origin main', null)).toStrictEqual(undefined);
});

const SELF_DECLARED = ['feature', 'export invoices', '--capabilities', '{"independentAgents":true,"isolatedWorktrees":true}'];

test.fails('the model cannot declare host capabilities without the user', async () => {
  const { tool } = loadFakePi();
  const cwd = repo();
  await runCli(['registry', 'refresh', '--from', 'leaderboard.2026-10-07.json', '--sources', 'skill-sources.2026-10-07.json'], testContext(cwd));
  await expect(tool.execute('call-7', { argv: SELF_DECLARED }, undefined, undefined, toolContext(cwd, null))).rejects.toThrow(`--capabilities overrides what the host reports; ask the user to run /s50 ${SELF_DECLARED.join(' ')}`);
});
