import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeS50Sessions, gitInit, S50_PACKAGE, startS50Session, writeS50Script } from './s50-fixture.js';

const LEADERBOARD = 'extensions/pi-s50/test/fixtures/leaderboard.2026-10-07.json';

function writeRaw(context, name, value) {
  const path = context.rawPath(name);
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function s50Calls(session) {
  const calls = [];
  let current = null;
  for (const record of session.records) {
    if (record.type === 'tool_execution_start' && record.toolName === 's50') current = { argv: record.args?.argv, end: null };
    else if (record.type === 'tool_execution_end' && record.toolName === 's50' && current !== null) {
      current.end = record;
      calls.push(current);
      current = null;
    }
  }
  return calls;
}

function summarize(call) {
  return {
    argv: call.argv,
    isError: call.end?.isError,
    resultIsError: call.end?.result?.isError,
    code: call.end?.result?.details?.code,
    firstLine: (call.end?.result?.content?.[0]?.text ?? '').split('\n')[0],
  };
}

function makeProject(scratchDir, name) {
  const project = join(scratchDir, name);
  mkdirSync(join(project, 'bin'), { recursive: true });
  writeFileSync(join(project, 'bin/hello.mjs'), '#!/usr/bin/env node\nconsole.info("hello");\n');
  writeFileSync(join(project, 'README.md'), `# ${name}\n`);
  gitInit(project);
  return project;
}

async function driveUnlocked(context) {
  writeS50Script(context.scratchDir, [
    { kind: 'tool', name: 's50', arguments: { argv: ['apply'] } },
    { kind: 'tool', name: 's50', arguments: { argv: ['registry', 'show'] } },
    { kind: 'text', text: 'S50_SCRIPTED_DONE' },
  ]);
  const session = startS50Session(context, { cwd: makeProject(context.scratchDir, 'tool-unlocked'), captureName: 'rpc-unlocked.jsonl' });
  await session.prompt('exercise the s50 tool exit-code mappings');
  return s50Calls(session);
}

async function driveLocked(context) {
  const project = makeProject(context.scratchDir, 'tool-locked');
  const refresh = spawnSync(process.execPath, [join(context.repoRoot, S50_PACKAGE, 'src/cli/main.ts'), 'registry', 'refresh', '--from', join(context.repoRoot, LEADERBOARD)], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, PI_OFFLINE: '1' },
  });
  assert.equal(refresh.status, 0, `registry refresh failed: ${refresh.stderr}`);
  writeS50Script(context.scratchDir, [
    { kind: 'tool', name: 's50', arguments: { argv: ['feature', 'print a greeting', '--consumer', 'cli:bin/hello.mjs'] } },
    { kind: 'text', text: 'S50_SCRIPTED_DONE' },
  ]);
  const session = startS50Session(context, { cwd: project, captureName: 'rpc-locked.jsonl' });
  await session.prompt('start an s50 feature run');
  return s50Calls(session);
}

function writeReceipt(receipts, errorCall, refusedCall, gatedCall, evidence) {
  const calls = [errorCall, refusedCall, gatedCall].map(summarize);
  receipts.assertVerdict({
    surfaceId: 'S50-TOOL-1',
    package: S50_PACKAGE,
    expected: 's50 tool maps exit code 1 to a thrown error, code 2 to an isError result, and code 3 to an accepted result whose details carry the human gate',
    observed: JSON.stringify(calls),
    evidence,
    check: () => {
      assert.equal(errorCall?.argv?.[0], 'apply');
      assert.equal(errorCall?.end?.isError, true, 'code 1 must surface as an error');
      assert.equal(errorCall?.end?.result?.details?.code, undefined, 'code 1 throws and must not carry a result code');
      assert.match(errorCall?.end?.result?.content?.[0]?.text ?? '', /usage: s50 <command>/, 'code 1 error text must be the usage block');
      assert.deepEqual(refusedCall?.argv, ['registry', 'show']);
      assert.equal(refusedCall?.end?.result?.details?.code, 2, 'code 2 must carry details.code 2');
      assert.equal(refusedCall?.end?.result?.isError, true, 'code 2 must return an isError result');
      assert.match(refusedCall?.end?.result?.content?.[0]?.text ?? '', /no registry lock/);
      assert.equal(gatedCall?.argv?.[0], 'feature');
      assert.equal(gatedCall?.end?.result?.details?.code, 3, 'code 3 must carry details.code 3');
      assert.notEqual(gatedCall?.end?.result?.isError, true, 'code 3 is accepted, not an error result');
      assert.match(gatedCall?.end?.result?.content?.[0]?.text ?? '', /phase: PREFLIGHT \(blocked\)/);
      assert.match(gatedCall?.end?.result?.content?.[0]?.text ?? '', /missing_skill/);
    },
  });
}

export default async function s50ToolMappings(context) {
  const { receipts, log } = context;
  try {
    const unlocked = await driveUnlocked(context);
    const locked = await driveLocked(context);
    const evidence = writeRaw(context, 'tool-mappings.json', [unlocked[0], unlocked[1], locked[0]].map(summarize));
    writeReceipt(receipts, unlocked[0], unlocked[1], locked[0], evidence);
    log(`✓ S50-TOOL-1 receipt written with mappings ${JSON.stringify([unlocked[0], unlocked[1], locked[0]].map(summarize).map((call) => ({ argv: call.argv, code: call.code })))}`);
  } finally {
    await closeS50Sessions(context);
  }
}
