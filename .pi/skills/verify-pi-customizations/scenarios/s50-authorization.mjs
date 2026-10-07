import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeS50Sessions, gitInit, S50_PACKAGE, startS50Session, writeS50Script } from './s50-fixture.js';

const LEADERBOARD = 'extensions/pi-s50/test/fixtures/leaderboard.2026-10-07.json';
const PUSH = 'git push --force origin main';
const S50_ONLY = 'S50 state changes only through the s50 tool';
const BIN = join(S50_PACKAGE, 'src/cli/main.ts');

function writeRaw(context, name, value) {
  const path = context.rawPath(name);
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function resultText(record) {
  return record?.result?.content?.[0]?.text ?? '';
}

function callsOf(session, toolName) {
  const pending = [];
  const done = [];
  for (const record of session.records) {
    if (record.type === 'tool_execution_start' && record.toolName === toolName) pending.push(record);
    else if (record.type === 'tool_execution_end' && record.toolName === toolName && pending.length > 0) done.push({ start: pending.shift(), end: record });
  }
  return done;
}

function makeProject(scratchDir, name) {
  const project = join(scratchDir, name);
  mkdirSync(join(project, 'bin'), { recursive: true });
  writeFileSync(join(project, 'bin/hello.mjs'), '#!/usr/bin/env node\nconsole.info("hello");\n');
  writeFileSync(join(project, 'README.md'), `# ${name}\n`);
  gitInit(project);
  return project;
}

function cli(repoRoot, project, argv) {
  return spawnSync(process.execPath, [join(repoRoot, BIN), ...argv], { cwd: project, encoding: 'utf8', env: { ...process.env, PI_OFFLINE: '1' } });
}

function seedRun(context, project, installed) {
  const refresh = cli(context.repoRoot, project, ['registry', 'refresh', '--from', join(context.repoRoot, LEADERBOARD)]);
  assert.equal(refresh.status, 0, `registry refresh failed: ${refresh.stderr}`);
  const args = ['feature', 'print a greeting', '--consumer', 'cli:bin/hello.mjs'];
  if (installed) args.push('--installed', 'grilling,codebase-design,tdd');
  const start = cli(context.repoRoot, project, args);
  assert.ok([0, 3].includes(start.status), `unexpected start exit ${start.status}: ${start.stdout}${start.stderr}`);
  return start.status;
}

async function driveGuardSession(context, active, runPath) {
  writeS50Script(context.scratchDir, [
    { kind: 'tool', name: 'edit', arguments: { path: runPath, edits: [{ oldText: '"schemaVersion": 2', newText: '"schemaVersion": 999' }] } },
    { kind: 'tool', name: 'write', arguments: { path: runPath, content: '{"tampered":true}\n' } },
    { kind: 'tool', name: 'bash', arguments: { command: `echo tampered >> ${runPath}` } },
    { kind: 'tool', name: 'bash', arguments: { command: `cat ${runPath}` } },
    { kind: 'tool', name: 'bash', arguments: { command: PUSH } },
    { kind: 'text', text: 'S50_SCRIPTED_DONE' },
  ]);
  const session = startS50Session(context, { cwd: active, answers: { confirm: false }, captureName: 'rpc-active.jsonl' });
  await session.prompt('drive the s50 guards');
  return {
    afterHash: sha256(readFileSync(runPath, 'utf8')),
    edits: callsOf(session, 'edit'),
    writes: callsOf(session, 'write'),
    bashes: callsOf(session, 'bash'),
    confirms: session.uiRequests.filter((request) => request.method === 'confirm'),
    answers: session.dialogs.filter((dialog) => dialog.request.method === 'confirm'),
  };
}

async function driveOpenGate(context, blocked) {
  writeS50Script(context.scratchDir, [
    { kind: 'tool', name: 'bash', arguments: { command: PUSH } },
    { kind: 'text', text: 'S50_SCRIPTED_DONE' },
  ]);
  const session = startS50Session(context, { cwd: blocked, answers: { confirm: false }, captureName: 'rpc-blocked.jsonl' });
  await session.prompt('drive the open-gate guard');
  return { call: callsOf(session, 'bash')[0], confirms: session.uiRequests.filter((request) => request.method === 'confirm') };
}

function runHeadless(context, active) {
  writeS50Script(context.scratchDir, [
    { kind: 'tool', name: 'bash', arguments: { command: PUSH } },
    { kind: 'text', text: 'S50_SCRIPTED_DONE' },
  ]);
  const providerPath = join(context.scratchDir, 's50-fixture', 's50-scripted-provider.ts');
  const headless = spawnSync('pi', ['--no-extensions', '-e', join(context.repoRoot, S50_PACKAGE), '-e', providerPath, '--mode', 'json', '--no-session', '-p', 'drive the headless guard'], {
    cwd: active,
    env: { ...process.env, PI_CODING_AGENT_DIR: context.scratchDir, PI_OFFLINE: '1' },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const text = headless.stdout + headless.stderr;
  const ends = text
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter((record) => record.type === 'tool_execution_end' && record.toolName === 'bash');
  return { status: headless.status, text, ends };
}

function assertGuards(facts) {
  const { edits, writes, bashes, gated } = facts;
  assert.equal(edits.length, 1, 'edit step missing');
  assert.equal(edits[0].end.isError, true, 'edit under .s50 must be blocked');
  assert.ok(resultText(edits[0].end).includes(S50_ONLY), 'edit block reason does not name the s50 tool');
  assert.equal(writes.length, 1, 'write step missing');
  assert.equal(writes[0].end.isError, true, 'write under .s50 must be blocked');
  assert.ok(resultText(writes[0].end).includes(S50_ONLY), 'write block reason does not name the s50 tool');
  assert.equal(bashes.length, 3, 'expected redirect, read and push bash calls');
  assert.equal(bashes[0].end.isError, true, 'bash redirect into .s50 must be blocked');
  assert.ok(resultText(bashes[0].end).includes(S50_ONLY), 'bash bypass block reason does not name the s50 tool');
  assert.notEqual(bashes[1].end.isError, true, 'read-only cat of .s50 must be allowed');
  assert.ok(resultText(bashes[1].end).includes('"schemaVersion": 2'), 'read-only cat did not return the intact state');
  assert.equal(bashes[2].end.isError, true, 'declined force push must be blocked');
  assert.ok(resultText(bashes[2].end).includes('user declined force_push'), 'decline reason missing');
  assert.ok(resultText(gated.call?.end).includes('S50 is blocked on the missing_skill gate'), 'open gate must be named');
  assert.ok(resultText(gated.call?.end).includes('force_push'), 'blocked action must be named');
  assert.equal(gated.confirms.length, 0, 'open gate must not open a confirm dialog');
  assert.equal(facts.headless.status, 0, `headless pi exited ${facts.headless.status}`);
  assert.ok(facts.noUiText.includes('S50 stops for force_push: ask the user to authorize this exact command'), 'headless run must block force_push without a UI');
}

function writeEvtReceipt(receipts, evidence, facts) {
  const { beforeHash, afterHash, gated } = facts;
  receipts.assertVerdict({
    surfaceId: 'S50-EVT-1',
    package: S50_PACKAGE,
    expected: 'the tool_call hook blocks every .s50 bypass, asks to authorize gated commands, blocks while a gate is open (no dialog), and blocks without a UI',
    observed: `edit/write/bash redirect blocked with ${JSON.stringify(S50_ONLY)}; run.json unchanged=${beforeHash === afterHash}; read-only cat allowed; force_push confirm declined; open-gate block=${JSON.stringify(resultText(gated.call?.end))}; no-UI block=${JSON.stringify(facts.noUiText.split('\n')[0] ?? '')}`,
    evidence,
    check: () => {
      assertGuards(facts);
      assert.equal(beforeHash, afterHash, '.s50/run.json changed: a bypass was not blocked');
    },
  });
}

export default async function s50Authorization(context) {
  const { receipts, log } = context;
  const active = makeProject(context.scratchDir, 'auth-active');
  const blocked = makeProject(context.scratchDir, 'auth-blocked');
  assert.equal(seedRun(context, active, true), 0, 'active run did not start cleanly');
  assert.equal(seedRun(context, blocked, false), 3, 'blocked run did not stop at the missing_skill gate');
  const runPath = join(active, '.s50/run.json');
  const beforeHash = sha256(readFileSync(runPath, 'utf8'));
  let guard = null;
  let gated = null;
  let headless = null;
  try {
    guard = await driveGuardSession(context, active, runPath);
    gated = await driveOpenGate(context, blocked);
    headless = runHeadless(context, active);
    const facts = { beforeHash, ...guard, gated, headless, noUiText: headless.ends.map((record) => resultText(record)).join('\n') };
    const evidence = writeRaw(context, 'guard-calls.json', {
      beforeHash,
      afterHash: guard.afterHash,
      unchanged: beforeHash === guard.afterHash,
      edit: guard.edits.map((call) => ({ isError: call.end.isError, text: resultText(call.end) })),
      write: guard.writes.map((call) => ({ isError: call.end.isError, text: resultText(call.end) })),
      bash: guard.bashes.map((call) => ({ command: call.start.args?.command, isError: call.end.isError, text: resultText(call.end) })),
      confirms: guard.confirms,
      answers: guard.answers.map((dialog) => ({ answered: dialog.answered, usedDefault: dialog.usedDefault, answer: dialog.answer })),
    });
    writeEvtReceipt(receipts, evidence, facts);
    receipts.assertVerdict({
      surfaceId: 'S50-UI-2',
      package: S50_PACKAGE,
      expected: 'a bash command touching a gated action during a run shows "S50: authorize <action>?" with the exact command and the bridge answer',
      observed: `confirm=${JSON.stringify(guard.confirms)} answered=${JSON.stringify(guard.answers.map((dialog) => dialog.answer))}`,
      evidence,
      check: () => {
        assert.equal(guard.confirms.length, 1, 'expected exactly one confirm dialog');
        assert.equal(guard.confirms[0].title, 'S50: authorize force_push?');
        assert.equal(guard.confirms[0].message, PUSH);
        assert.equal(guard.answers.length, 1, 'expected the bridge to record one confirm answer');
        assert.equal(guard.answers[0].answer, false, 'bridge answer not recorded');
        assert.equal(guard.answers[0].usedDefault, false, 'bridge must not fall back to the default answer');
      },
    });
    log(`✓ S50-EVT-1 and S50-UI-2 receipts written (headless exit ${headless.status})`);
  } finally {
    await closeS50Sessions(context);
  }
}
