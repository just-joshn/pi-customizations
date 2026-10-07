import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPROVAL_RELATIVE = 'docs/user-perspective-testing/approved-verification-contract.json';
const FIXTURE_SCENARIO = 'f009-contract-fixture';
const SURFACES_TSV = [
  'surface_id\tpackage\tkind\tname\ttrigger\texpected\tsource\ttier\tveto',
  'F009-FIX-1\tfixture\tbehaviour\tF-009 fixture\tprobe\tThe F-009 fixture reports a trailing-newline capture\tprobe\tT2\tnot observed: The F-009 fixture reports a trailing-newline capture',
  '',
].join('\n');

const CLAIM = 'The F-009 fixture reports a trailing-newline capture';

function fixtureScenario(condition, failure) {
  return `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLAIM = ${JSON.stringify(CLAIM)};

export default async function fixture(context) {
  const content = readFileSync(join(context.artifactDir, 'f009-output.txt'), 'utf8');
  context.receipts.assertVerdict({
    surfaceId: 'F009-FIX-1',
    package: 'fixture',
    expected: CLAIM,
    observed: \`f009-output.txt is \${JSON.stringify(content)}\`,
    evidence: context.rawPath('f009-output.txt'),
    check: () => {
      assert.ok(${condition}, ${JSON.stringify(failure)});
    },
  });
}
`;
}

// biome-ignore lint/security/noSecrets: fixture assertion condition, not a secret
const ORIGINAL_SCENARIO = fixtureScenario("content.endsWith('\\n')", 'f009-output.txt must end with a trailing newline');
const WEAKENED_SCENARIO = fixtureScenario('content.trim().length > 0', 'f009-output.txt must not be empty');

async function contractApi(moduleDir) {
  try {
    return await import(pathToFileURL(join(moduleDir, 'lib/verification-contract.mjs')).href);
  } catch {
    return null;
  }
}

function requireApi(api) {
  assert.ok(api, 'lib/verification-contract.mjs must exist with contractDigest, contractUnchangedSince, and loadApproval');
  return api;
}

function writeTree(repoRoot) {
  const skill = join(repoRoot, '.pi/skills/verify-pi-customizations');
  mkdirSync(join(skill, 'bin'), { recursive: true });
  mkdirSync(join(skill, 'scripts'), { recursive: true });
  writeFileSync(join(skill, 'bin/control-pi'), '#!/usr/bin/env node\n');
  writeFileSync(join(skill, 'scripts/tool.mjs'), 'export const tool = 1;\n');
  const testDir = join(repoRoot, 'extensions/pi-fixture/test');
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, 'helper.js'), 'export const helper = 1;\n');
  writeFileSync(join(testDir, 'helper.ts'), 'export const helper: number = 1;\n');
  const scriptsDir = join(repoRoot, 'extensions/pi-fixture/scripts');
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, 'runner.mjs'), 'export const runner = 1;\n');
  const dependency = join(repoRoot, 'extensions/pi-fixture/node_modules');
  mkdirSync(dependency, { recursive: true });
  writeFileSync(join(dependency, 'ignored.js'), 'module.exports = 1;\n');
}

function gitInit(repoRoot) {
  const git = (args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['add', '-A']);
  git(['-c', 'user.email=f009-probe@example.com', '-c', 'user.name=f009-probe', 'commit', '-q', '-m', 'fixture']);
}

function buildCheckout(repoRoot, scenarioSource) {
  const checkout = join(repoRoot, '.pi/skills/verify-pi-customizations');
  mkdirSync(dirname(checkout), { recursive: true });
  cpSync(SKILL_DIR, checkout, { recursive: true });
  const docs = join(repoRoot, 'docs/user-perspective-testing');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, 'surfaces.tsv'), SURFACES_TSV);
  writeFileSync(join(docs, 'open-findings.md'), '# Open findings\n');
  const artifacts = join(repoRoot, 'artifacts/user-perspective', FIXTURE_SCENARIO);
  mkdirSync(artifacts, { recursive: true });
  const scenarioPath = join(checkout, 'scenarios', `${FIXTURE_SCENARIO}.mjs`);
  writeFileSync(scenarioPath, scenarioSource);
  const outputPath = join(artifacts, 'f009-output.txt');
  writeFileSync(outputPath, 'CAPTURE_OK\n');
  gitInit(repoRoot);
  return { checkout, artifacts, scenarioPath, outputPath };
}

function writeApproval(repoRoot, sha256) {
  writeFileSync(join(repoRoot, APPROVAL_RELATIVE), `${JSON.stringify({ schema_version: 1, sha256 }, null, 2)}\n`);
}

function drive(repoRoot, checkout) {
  const result = spawnSync(process.execPath, [join(checkout, 'bin/control-pi'), 'drive', FIXTURE_SCENARIO], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.error, undefined, 'the drive must finish');
  assert.equal(result.status, 0, `the fixture drive must verify\n${result.stdout}\n${result.stderr}`);
  return result;
}

function report(repoRoot, checkout) {
  return spawnSync(process.execPath, [join(checkout, 'scripts/coverage-report.mjs'), '--require-complete'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
}

test('a weakened assertion re-driven under an unapproved contract fails the strict report', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'f009-contract-'));
  try {
    const { checkout, scenarioPath, outputPath } = buildCheckout(repoRoot, ORIGINAL_SCENARIO);
    const api = await contractApi(checkout);
    if (api) writeApproval(repoRoot, api.contractDigest({ repoRoot }));
    writeFileSync(scenarioPath, WEAKENED_SCENARIO);
    writeFileSync(outputPath, 'CAPTURE_OK');
    drive(repoRoot, checkout);
    const rejected = report(repoRoot, checkout);
    // Retained evidence for the pre-fix baseline: the pre-fix report exits 0 here.
    console.log(`[f009] strict report exit after weakening an assertion and re-driving: ${rejected.status}`);
    console.log(rejected.stdout);
    assert.equal(rejected.status, 1, `the strict report must refuse an unapproved contract\n${rejected.stdout}\n${rejected.stderr}`);
    assert.match(rejected.stdout, /contract approval: unapproved/, 'the report must label the unapproved contract explicitly');
    writeFileSync(scenarioPath, ORIGINAL_SCENARIO);
    writeFileSync(outputPath, 'CAPTURE_OK\n');
    drive(repoRoot, checkout);
    const accepted = report(repoRoot, checkout);
    assert.equal(accepted.status, 0, `the restored, approved contract must pass\n${accepted.stdout}\n${accepted.stderr}`);
    assert.match(accepted.stdout, /contract approval: approved/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('the contract digest covers helper JS, helper TS, and extensionless source but skips dependencies', async () => {
  const api = requireApi(await contractApi(SKILL_DIR));
  const repoRoot = mkdtempSync(join(tmpdir(), 'f009-digest-'));
  try {
    writeTree(repoRoot);
    const base = api.contractDigest({ repoRoot });
    const dependency = join(repoRoot, 'extensions/pi-fixture/node_modules/ignored.js');
    writeFileSync(dependency, 'module.exports = 2;\n');
    assert.equal(api.contractDigest({ repoRoot }), base, 'a dependency edit must not change the contract digest');
    const helperJs = join(repoRoot, 'extensions/pi-fixture/test/helper.js');
    writeFileSync(helperJs, 'export const helper = 2;\n');
    assert.notEqual(api.contractDigest({ repoRoot }), base, 'a helper JS edit must change the contract digest');
    writeFileSync(helperJs, 'export const helper = 1;\n');
    const helperTs = join(repoRoot, 'extensions/pi-fixture/test/helper.ts');
    writeFileSync(helperTs, 'export const helper: number = 2;\n');
    assert.notEqual(api.contractDigest({ repoRoot }), base, 'a helper TS edit must change the contract digest');
    writeFileSync(helperTs, 'export const helper: number = 1;\n');
    writeFileSync(join(repoRoot, '.pi/skills/verify-pi-customizations/bin/control-pi'), '#!/usr/bin/env node\n// changed\n');
    assert.notEqual(api.contractDigest({ repoRoot }), base, 'an extensionless source edit must change the contract digest');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('the contract digest is stable when an identical tree is relocated', async () => {
  const api = requireApi(await contractApi(SKILL_DIR));
  const source = mkdtempSync(join(tmpdir(), 'f009-relocate-a-'));
  const target = join(mkdtempSync(join(tmpdir(), 'f009-relocate-b-')), 'moved');
  try {
    writeTree(source);
    const before = api.contractDigest({ repoRoot: source });
    cpSync(source, target, { recursive: true });
    assert.equal(api.contractDigest({ repoRoot: target }), before, 'relocating an identical tree must not change the digest');
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(dirname(target), { recursive: true, force: true });
  }
});

test('a source symlink beneath a contract root is rejected', async () => {
  const api = requireApi(await contractApi(SKILL_DIR));
  const repoRoot = mkdtempSync(join(tmpdir(), 'f009-symlink-'));
  try {
    writeTree(repoRoot);
    symlinkSync(join(repoRoot, '.pi/skills/verify-pi-customizations/bin/control-pi'), join(repoRoot, '.pi/skills/verify-pi-customizations/scripts/link.mjs'));
    assert.throws(() => api.contractDigest({ repoRoot }), /symlink/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('a missing or malformed approval record fails closed', async () => {
  const api = requireApi(await contractApi(SKILL_DIR));
  const repoRoot = mkdtempSync(join(tmpdir(), 'f009-approval-'));
  try {
    const path = join(repoRoot, 'approval.json');
    assert.equal(api.loadApproval({ path }), null, 'a missing approval record is not an error object');
    writeFileSync(path, 'not json\n');
    assert.throws(() => api.loadApproval({ path }), /JSON/);
    writeFileSync(path, `${JSON.stringify({ schema_version: 2, sha256: 'a'.repeat(64) })}\n`);
    assert.throws(() => api.loadApproval({ path }), /schema/);
    writeFileSync(path, `${JSON.stringify({ schema_version: 1, sha256: 'not-a-digest' })}\n`);
    assert.throws(() => api.loadApproval({ path }), /sha256/);
    writeFileSync(path, `${JSON.stringify({ schema_version: 1, sha256: 'a'.repeat(64) })}\n`);
    assert.deepEqual(api.loadApproval({ path }), { schemaVersion: 1, sha256: 'a'.repeat(64) });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('a receipt produced under changed helpers stays stale after the helpers are restored', async () => {
  const api = requireApi(await contractApi(SKILL_DIR));
  const repoRoot = mkdtempSync(join(tmpdir(), 'f009-stale-'));
  try {
    const { checkout } = buildCheckout(repoRoot, ORIGINAL_SCENARIO);
    const helperPath = join(repoRoot, 'extensions/pi-fixture/scripts/helper.mjs');
    mkdirSync(dirname(helperPath), { recursive: true });
    writeFileSync(helperPath, 'export const value = "approved";\n');
    writeApproval(repoRoot, api.contractDigest({ repoRoot }));
    writeFileSync(helperPath, 'export const value = "changed";\n');
    drive(repoRoot, checkout);
    writeFileSync(helperPath, 'export const value = "approved";\n');
    const rejected = report(repoRoot, checkout);
    assert.equal(rejected.status, 1, `a receipt from changed helpers must stay stale\n${rejected.stdout}\n${rejected.stderr}`);
    assert.match(rejected.stdout, /contract binding: 0 unchanged, 1 stale, 0 unbound/);
    assert.match(rejected.stdout, /contract approval: approved/, 'the restored contract is approved but the receipt is still stale');
    rmSync(join(repoRoot, APPROVAL_RELATIVE), { force: true });
    const unapproved = report(repoRoot, checkout);
    assert.equal(unapproved.status, 1, 'a missing approval record must fail strict completion');
    assert.match(unapproved.stdout, /contract approval: unapproved/);
    assert.match(unapproved.stdout, /no approval record/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('a malformed approval fails the real strict report after a successful drive', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'f009-malformed-report-'));
  try {
    const { checkout } = buildCheckout(repoRoot, ORIGINAL_SCENARIO);
    drive(repoRoot, checkout);
    writeFileSync(join(repoRoot, APPROVAL_RELATIVE), 'not json\n');
    const rejected = report(repoRoot, checkout);
    assert.equal(rejected.status, 1, `${rejected.stdout}\n${rejected.stderr}`);
    assert.match(`${rejected.stdout}\n${rejected.stderr}`, /approval.*not valid JSON/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('a real drive stamps the contract digest it ran under', async () => {
  const api = requireApi(await contractApi(SKILL_DIR));
  const repoRoot = mkdtempSync(join(tmpdir(), 'f009-stamp-'));
  try {
    const { checkout, artifacts, scenarioPath } = buildCheckout(repoRoot, ORIGINAL_SCENARIO);
    const expected = api.contractDigest({ repoRoot });
    drive(repoRoot, checkout);
    const receipt = JSON.parse(readFileSync(join(artifacts, 'F009-FIX-1.json'), 'utf8'));
    assert.equal(receipt.contract_sha256, expected, 'the receipt must carry the contract digest at production time');
    assert.equal(receipt.scenario_sha256, createHash('sha256').update(readFileSync(scenarioPath)).digest('hex'), 'the existing scenario digest must remain the scenario file digest');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
