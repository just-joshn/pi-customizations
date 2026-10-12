import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { assistantTexts, contentText, makeSandbox, messages, piInvocation, runJson, type Sandbox } from './harness.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.dispose());

test('/how attaches the skill body, path, and raw arguments to one message (CMD-001)', async () => {
  const run = await runJson(sandbox, '/how why "quoted" $1 stays\n@@say ALIAS-OK', ['--no-session']);
  const [user] = messages(run.events, 'user').map((message) => contentText(message.content));
  const skillFile = join(PACKAGE_ROOT, 'skills/how/SKILL.md');
  expect(user).toContain(`<skill name="how" location="${skillFile}">`);
  expect(user).toContain(`References are relative to ${join(PACKAGE_ROOT, 'skills/how')}.`);
  expect(user).toContain('# How\n\nExplore the codebase');
  expect(user?.endsWith('</skill>\n\nwhy "quoted" $1 stays\n@@say ALIAS-OK')).toBe(true);
  expect(assistantTexts(run.events)).toEqual(['ALIAS-OK']);
});

test('the skill does not ride along on the next message (CMD-001)', async () => {
  const run = await runJson(sandbox, ['/ketchup @@say FIRST', 'next turn\n@@say SECOND'], ['--no-session']);
  const users = messages(run.events, 'user').map((message) => contentText(message.content));
  expect(users).toHaveLength(2);
  expect(users[0]).toContain('<skill name="ketchup"');
  expect(users[1]).toBe('next turn\n@@say SECOND');
  expect(assistantTexts(run.events)).toEqual(['FIRST', 'SECOND']);
});

test('aliases work in print mode, where extension commands cannot start a run (CMD-001)', () => {
  const result = spawnSync(...piInvocation(['-p', '--offline', '--no-session', '--model', 'scripted/echo', '/principle-prove-it-works @@say PRINT-OK']), {
    cwd: sandbox.workDir,
    env: sandbox.env,
    encoding: 'utf8',
    timeout: 45_000,
  });
  expect(result.stdout.trim()).toBe('PRINT-OK');
  expect(result.status).toBe(0);
});

test("a user's own prompt template of the same name wins over the alias (CMD-002)", async () => {
  mkdirSync(join(sandbox.agentDir, 'prompts'));
  writeFileSync(join(sandbox.agentDir, 'prompts/how.md'), '---\ndescription: my how\n---\nMY-TEMPLATE $@\n');
  const run = await runJson(sandbox, '/how hello', ['--no-session']);
  expect(assistantTexts(run.events)).toEqual(['ECHO: MY-TEMPLATE hello']);
});

test('aliases work when the package is installed through a symlink (recheck 1)', async () => {
  const link = join(sandbox.root, 'pkglink');
  symlinkSync(PACKAGE_ROOT, link);
  writeFileSync(join(sandbox.agentDir, 'settings.json'), JSON.stringify({ packages: [link], extensions: [join(PACKAGE_ROOT, 'test/fixtures/scripted-model.ts')] }));
  const run = await runJson(sandbox, '/ketchup now\n@@say LINKED', ['--no-session']);
  const [user] = messages(run.events, 'user').map((message) => contentText(message.content));
  expect([user?.startsWith('<skill name="ketchup"'), assistantTexts(run.events)]).toEqual([true, ['LINKED']]);
});

test("a skill of the user's own gets a /name alias too, as in Cursor (review r2: parity 1)", async () => {
  mkdirSync(join(sandbox.agentDir, 'skills/jay-mode'), { recursive: true });
  writeFileSync(join(sandbox.agentDir, 'skills/jay-mode/SKILL.md'), '---\nname: jay-mode\ndescription: Work in Jay style.\ndisable-model-invocation: true\n---\nJAY BODY\n');
  const run = await runJson(sandbox, '/jay-mode hello\n@@say JAY', ['--no-session']);
  const [user] = messages(run.events, 'user').map((message) => contentText(message.content));
  expect([user?.startsWith('<skill name="jay-mode"'), assistantTexts(run.events)]).toEqual([true, ['JAY']]);
});

test('aliases work when skill commands are hidden from the / menu', async () => {
  const settings = JSON.parse(readFileSync(join(sandbox.agentDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(sandbox.agentDir, 'settings.json'), JSON.stringify({ ...settings, enableSkillCommands: false }));
  const run = await runJson(sandbox, '/how now\n@@say HIDDEN', ['--no-session']);
  const [user] = messages(run.events, 'user').map((message) => contentText(message.content));
  expect([user?.startsWith('<skill name="how"'), assistantTexts(run.events)]).toEqual([true, ['HIDDEN']]);
});

test('non-alias slash text reaches the model unchanged (CMD-002)', async () => {
  const run = await runJson(sandbox, '/howdy partner', ['--no-session']);
  expect(assistantTexts(run.events)).toEqual(['ECHO: /howdy partner']);
});
