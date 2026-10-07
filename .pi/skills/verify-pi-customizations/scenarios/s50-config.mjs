import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeS50Sessions, gitInit, S50_PACKAGE, startS50Session, writeS50Script } from './s50-fixture.js';

const LEADERBOARD = 'extensions/pi-s50/test/fixtures/leaderboard.2026-10-07.json';
const RUN_FILES = ['run.json', 'graph.json', 'evidence.jsonl', 'findings.jsonl', 'decisions.jsonl', 'registry.lock.json', '.gitignore'];

function writeRaw(context, name, value) {
  const path = context.rawPath(name);
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function cli(repoRoot, project, argv) {
  return spawnSync(process.execPath, [join(repoRoot, S50_PACKAGE, 'src/cli/main.ts'), ...argv], { cwd: project, encoding: 'utf8', env: { ...process.env, PI_OFFLINE: '1' } });
}

function statusText(session) {
  return session.customMessages
    .filter((message) => message.customType === 's50')
    .map((message) => (typeof message.content === 'string' ? message.content : ''))
    .at(-1);
}

function seedState(context, project) {
  const refresh = cli(context.repoRoot, project, ['registry', 'refresh', '--from', join(context.repoRoot, LEADERBOARD)]);
  assert.equal(refresh.status, 0, `registry refresh failed: ${refresh.stderr}`);
  const feature = cli(context.repoRoot, project, ['feature', 'print a greeting', '--consumer', 'cli:bin/hello.mjs']);
  assert.equal(feature.status, 3, `feature start exited ${feature.status}: ${feature.stdout}${feature.stderr}`);
  const evidence = cli(context.repoRoot, project, [
    'apply',
    '{"kind":"record_evidence","evidence":{"claim":"greeting prints","criterion":"print a greeting","state":"MEASURED","dependencies":[],"method":"cli","expected":"hello","observed":"hello","artifact":"output.txt"}}',
  ]);
  const finding = cli(context.repoRoot, project, ['apply', '{"kind":"record_finding","finding":{"severity":"low","trigger":"t","consequence":"c","evidence":"e","owner":"o","reviewer":"r"}}']);
  assert.equal(evidence.status, 3, `record_evidence exited ${evidence.status}: ${evidence.stderr}`);
  assert.equal(finding.status, 3, `record_finding exited ${finding.status}: ${finding.stderr}`);
  const stateDir = join(project, '.s50');
  return {
    stateDir,
    listing: readdirSync(stateDir).sort(),
    gitignore: readFileSync(join(stateDir, '.gitignore'), 'utf8'),
    run: JSON.parse(readFileSync(join(stateDir, 'run.json'), 'utf8')),
  };
}

async function driveRestart(context, project, stateDir) {
  writeS50Script(context.scratchDir, [{ kind: 'text', text: 'S50_SCRIPTED_OK' }]);
  const session = startS50Session(context, { cwd: project, persistSession: true, sessionId: 's50-config-drive', captureName: 'rpc-config.jsonl' });
  await session.prompt('/s50 status');
  const before = statusText(session);
  const filesBefore = RUN_FILES.map((name) => [name, readFileSync(join(stateDir, name), 'utf8')]);
  await session.restart();
  await session.prompt('/s50 status');
  const after = statusText(session);
  const filesAfter = RUN_FILES.map((name) => [name, readFileSync(join(stateDir, name), 'utf8')]);
  return { before, after, filesBefore, filesAfter };
}

function writeReceipt(receipts, evidence, seed, restart) {
  receipts.assertVerdict({
    surfaceId: 'S50-CFG-1',
    package: S50_PACKAGE,
    expected: 'any /s50 or s50 command creates durable .s50 state (run.json, graph.json, evidence.jsonl, findings.jsonl, decisions.jsonl, registry.lock.json, .gitignore) that survives a session restart',
    observed: `files=${JSON.stringify(seed.listing)} gitignore=${JSON.stringify(seed.gitignore)} run=mode:${seed.run.mode} phase:${seed.run.phase}; after restart status=${JSON.stringify(restart.after?.split('\n').slice(0, 2))}`,
    evidence,
    check: () => {
      for (const name of RUN_FILES) assert.ok(seed.listing.includes(name), `.s50/${name} missing; listing=${seed.listing.join(', ')}`);
      assert.equal(seed.gitignore, '*\n');
      assert.equal(seed.run.schemaVersion, 2);
      assert.equal(seed.run.mode, 'feature');
      assert.equal(seed.run.objective, 'print a greeting');
      assert.ok(restart.before && restart.after, 'no /s50 status custom message');
      assert.match(restart.before, /objective: print a greeting/);
      assert.match(restart.after, /objective: print a greeting/);
      assert.match(restart.after, /phase: PREFLIGHT \(blocked\)/);
      assert.match(restart.after, /missing_skill/);
      assert.ok(
        restart.filesBefore.every(([, content], index) => content === restart.filesAfter[index][1]),
        'a .s50 file changed across the restart',
      );
    },
  });
}

export default async function s50Config(context) {
  const { receipts, log } = context;
  const project = join(context.scratchDir, 'config-project');
  mkdirSync(join(project, 'bin'), { recursive: true });
  writeFileSync(join(project, 'bin/hello.mjs'), '#!/usr/bin/env node\nconsole.info("hello");\n');
  writeFileSync(join(project, 'README.md'), '# config project\n');
  gitInit(project);
  try {
    const seed = seedState(context, project);
    const restart = await driveRestart(context, project, seed.stateDir);
    const evidence = writeRaw(context, 'config-facts.json', {
      listing: seed.listing,
      gitignore: seed.gitignore,
      run: { schemaVersion: seed.run.schemaVersion, mode: seed.run.mode, objective: seed.run.objective, phase: seed.run.phase, status: seed.run.status },
      before: restart.before?.split('\n').slice(0, 2),
      after: restart.after?.split('\n').slice(0, 2),
      survived: restart.filesBefore.every(([, content], index) => content === restart.filesAfter[index][1]),
    });
    writeReceipt(receipts, evidence, seed, restart);
    log(`✓ S50-CFG-1 receipt written for .s50 files ${JSON.stringify(seed.listing)}`);
  } finally {
    await closeS50Sessions(context);
  }
}
