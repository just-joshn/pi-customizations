import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeS50Sessions, gitInit, S50_PACKAGE, startS50Session, writeS50Script } from './s50-fixture.js';

const LEADERBOARD = 'extensions/pi-s50/test/fixtures/leaderboard.2026-10-07.json';
const SKILL_PHRASE = 'are the only writers of';

function writeRaw(context, name, value) {
  const path = context.rawPath(name);
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function notices(session) {
  return session.notifications.map((record) => ({ message: record.message, level: record.notifyType ?? 'info' }));
}

function s50Messages(session) {
  return session.customMessages.filter((message) => message.customType === 's50').map((message) => ({ text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content), code: message.details?.code }));
}

function userSkillText(session) {
  return session
    .ofType('message_end')
    .filter((record) => record.message?.role === 'user')
    .flatMap((record) => (Array.isArray(record.message.content) ? record.message.content : []))
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .find((text) => text.includes('<skill name="s50"'));
}

function prepareProject(context) {
  const project = join(context.scratchDir, 'surfaces-project');
  mkdirSync(join(project, 'bin'), { recursive: true });
  writeFileSync(join(project, 'bin/hello.mjs'), '#!/usr/bin/env node\nconsole.info("hello");\n');
  writeFileSync(join(project, 'README.md'), '# surfaces project\n');
  gitInit(project);
  const refresh = spawnSync(process.execPath, [join(context.repoRoot, S50_PACKAGE, 'src/cli/main.ts'), 'registry', 'refresh', '--from', join(context.repoRoot, LEADERBOARD)], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, PI_OFFLINE: '1' },
  });
  assert.equal(refresh.status, 0, `registry refresh failed: ${refresh.stderr}`);
  return project;
}

async function driveCommands(session) {
  await session.prompt('/s50 help');
  await session.prompt('/s50 bogus');
  await session.prompt('/s50 feature print a greeting --consumer cli:bin/hello.mjs');
  await session.prompt('/s50 feature print a greeting --consumer cli:bin/hello.mjs');
  const seen = notices(session);
  const messages = s50Messages(session);
  await session.prompt('/skill:s50');
  return { seen, messages, injected: userSkillText(session) };
}

function writeCommandReceipt(receipts, session, commands, messages) {
  const command = commands.find((candidate) => candidate.name === 's50');
  const help = messages.find((entry) => entry.text.startsWith('usage: s50'));
  const blocked = messages.find((entry) => entry.code === 3);
  const refused = messages.find((entry) => entry.code === 2);
  receipts.assertVerdict({
    surfaceId: 'S50-CMD-1',
    package: S50_PACKAGE,
    expected: '/s50 is registered in Pi; running it executes the coordinator and posts bounded stdout as an s50 custom message, and a nonzero exit notifies',
    observed: `command=${command?.name ?? 'missing'} source=${command?.source ?? 'none'} description=${JSON.stringify(command?.description ?? '')}; message codes=${JSON.stringify(messages.map((entry) => ({ code: entry.code, firstLine: entry.text.split('\n')[0] })))}`,
    evidence: session.capturePath,
    check: () => {
      assert.ok(command, `command s50 not registered; commands: ${commands.map((candidate) => candidate.name).join(', ')}`);
      assert.equal(command.source, 'extension');
      assert.ok(command.description && command.description.length > 0, 's50 command has no description');
      assert.ok(help, 'no s50 custom message starting with usage');
      assert.match(help.text, /usage: s50 <command>/);
      assert.equal(help.code, 0);
      assert.ok(blocked && /phase: PREFLIGHT \(blocked\)/.test(blocked.text), 'no code 3 message with blocked status');
      assert.match(blocked.text, /missing_skill/);
      assert.ok(refused && /a run already exists/.test(refused.text), 'no code 2 refusal message');
    },
  });
}

function writeUiReceipt(receipts, evidence, seen) {
  receipts.assertVerdict({
    surfaceId: 'S50-UI-1',
    package: S50_PACKAGE,
    expected: '/s50 nonzero exits post "s50 exited <code>" notices at the matching level; code 0 posts no notice',
    observed: `notices=${JSON.stringify(seen)}`,
    evidence,
    check: () => {
      assert.deepEqual(seen, [
        { message: 's50 exited 1', level: 'error' },
        { message: 's50 exited 3', level: 'warning' },
        { message: 's50 exited 2', level: 'warning' },
      ]);
      assert.ok(!seen.some((entry) => entry.message === 's50 exited 0'), 'code 0 must not notify');
    },
  });
}

function writeSkillReceipt(receipts, evidence, commands, injected) {
  const skill = commands.find((candidate) => candidate.name === 'skill:s50');
  receipts.assertVerdict({
    surfaceId: 'S50-SKILL-1',
    package: S50_PACKAGE,
    expected: 'the s50 skill is discoverable as /skill:s50 and injects the S50 coordinator skill body',
    observed: `command=${skill?.name ?? 'missing'} source=${skill?.source ?? 'none'} path=${skill?.sourceInfo?.path ?? 'none'}; injected=${injected ? JSON.stringify(injected.slice(0, 120)) : 'none'}`,
    evidence,
    check: () => {
      assert.ok(
        skill,
        `skill:s50 not registered; skill commands: ${commands
          .filter((candidate) => candidate.source === 'skill')
          .map((candidate) => candidate.name)
          .join(', ')}`,
      );
      assert.match(skill.sourceInfo?.path ?? '', /skills\/s50\/SKILL\.md$/);
      assert.ok(injected, 's50 skill body was not injected by /skill:s50');
      assert.ok(injected.includes(SKILL_PHRASE), `injected skill body is missing ${JSON.stringify(SKILL_PHRASE)}`);
    },
  });
}

export default async function s50Surfaces(context) {
  const { receipts, log } = context;
  const project = prepareProject(context);
  writeS50Script(context.scratchDir, [{ kind: 'text', text: 'S50_SCRIPTED_OK' }]);
  const session = startS50Session(context, { cwd: project, captureName: 'rpc-surfaces.jsonl' });
  try {
    const commands = await session.commands();
    const { seen, messages, injected } = await driveCommands(session);
    const factsRaw = writeRaw(context, 'surface-facts.json', {
      command: commands.find((candidate) => candidate.name === 's50') ?? null,
      skill: commands.find((candidate) => candidate.name === 'skill:s50') ?? null,
      notices: seen,
      customMessages: messages,
      injectedSkill: injected ?? null,
    });
    writeCommandReceipt(receipts, session, commands, messages);
    writeUiReceipt(receipts, factsRaw, seen);
    writeSkillReceipt(receipts, factsRaw, commands, injected);
    log(`✓ S50-CMD-1, S50-SKILL-1 and S50-UI-1 receipts written (capture ${session.capturePath})`);
  } finally {
    await closeS50Sessions(context);
  }
}
