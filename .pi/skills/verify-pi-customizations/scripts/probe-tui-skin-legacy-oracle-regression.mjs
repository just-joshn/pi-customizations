#!/usr/bin/env node
/**
 * Regression for the F-014 legacy receipt closure.
 *
 * `pi-tui-skin-flow` and `pi-tui-skin-chrome` assert a narrowed clause of five
 * rows, so a package mutation that breaks the rest of the row leaves the old
 * receipt `verified`. This probe drives the actual old scenario under each
 * mutant in a disposable git-archive checkout and requires the exact target
 * receipt to read `failed`. Widening those receipts to the whole row is what
 * this probe pins; before that closure the target stays `verified`.
 *
 * The checkout is a `git archive` of `--ref` (HEAD by default) with the mutant
 * applied and committed, so `head_sha` is the tree the drive actually ran. The
 * probe prints the resolved pi binary and its version, and accepts `--ref=<rev>`
 * so the same control can be replayed against the pre-fix commit. Every run
 * writes receipts only inside the throwaway checkout, never into this
 * repository's artifacts.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPOSITE_MUTATIONS } from '../scenarios/pi-tui-skin-composite.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SKILL_ROOT = '.pi/skills/verify-pi-customizations';
const PACKAGE_ROOT = 'extensions/pi-tui-skin';
const DRIVE_TIMEOUT_MS = 900_000;

function piBinary() {
  if (process.env.PI_BIN) return process.env.PI_BIN;
  return execFileSync('sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim();
}

function compositeMutation(name) {
  const mutation = COMPOSITE_MUTATIONS.find((entry) => entry.name === name);
  assert.ok(mutation, `the composite mutation ${name} is missing from the scenario`);
  return mutation;
}

/** Remove the store's tool teardown so the activity widget line never clears. */
function activityWidgetNeverClears(srcDir) {
  const file = join(srcDir, 'state', 'presentation-store.ts');
  const text = readFileSync(file, 'utf8');
  const next = text.replace('      activeTools.delete(input.toolCallId);\n', '');
  assert.notEqual(next, text, 'the activity-widget mutation needle did not match presentation-store.ts');
  writeFileSync(file, next);
}

const CASES = [
  { case: 'cleanup-missing-surface', scenario: 'pi-tui-skin-flow', surfaceId: 'TS-EVT-2', apply: compositeMutation('cleanup-missing-surface').apply },
  { case: 'cleanup-not-idempotent', scenario: 'pi-tui-skin-flow', surfaceId: 'TS-EVT-2', apply: compositeMutation('cleanup-not-idempotent').apply },
  { case: 'activity-widget-never-clears', scenario: 'pi-tui-skin-flow', surfaceId: 'TS-EVT-3', apply: activityWidgetNeverClears },
  { case: 'stale-footer-model', scenario: 'pi-tui-skin-flow', surfaceId: 'TS-EVT-7', apply: compositeMutation('stale-footer-model').apply },
  { case: 'no-context-percentage', scenario: 'pi-tui-skin-chrome', surfaceId: 'TS-UI-3', apply: compositeMutation('no-context-percentage').apply },
  { case: 'no-embedded-working-band', scenario: 'pi-tui-skin-chrome', surfaceId: 'TS-UI-4', apply: compositeMutation('no-embedded-working-band').apply },
];

function extractArchive(dest, ref) {
  const archivePath = join(dirname(dest), `${basename(dest)}.tar`);
  try {
    execFileSync('git', ['-C', REPO_ROOT, 'archive', '-o', archivePath, '--format=tar', ref, SKILL_ROOT, PACKAGE_ROOT], { stdio: 'pipe' });
    execFileSync('tar', ['-xf', archivePath, '-C', dest], { stdio: 'pipe' });
  } finally {
    rmSync(archivePath, { force: true });
  }
}

function commitCheckout(dest, message) {
  const git = (args) => execFileSync('git', ['-C', dest, ...args], { stdio: 'pipe' });
  git(['init', '-q', '-b', 'legacy-oracle']);
  git(['add', '-A']);
  git(['-c', 'user.email=legacy-oracle@example.com', '-c', 'user.name=legacy-oracle', 'commit', '-q', '-m', message]);
}

/** The archive carries source only; the workspace dependency trees stay linked to this checkout. */
function linkDependencies(dest) {
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(dest, 'node_modules'), 'dir');
  symlinkSync(join(REPO_ROOT, PACKAGE_ROOT, 'node_modules'), join(dest, PACKAGE_ROOT, 'node_modules'), 'dir');
}

function prepareCheckout(entry, ref) {
  const dest = mkdtempSync(join(tmpdir(), `legacy-oracle-${entry.case}-`));
  extractArchive(dest, ref);
  entry.apply(join(dest, PACKAGE_ROOT, 'src'));
  commitCheckout(dest, `legacy oracle mutant: ${entry.case}`);
  linkDependencies(dest);
  return dest;
}

function driveAndRead(dest, entry) {
  const control = join(dest, SKILL_ROOT, 'bin', 'control-pi');
  const result = spawnSync(process.execPath, [control, 'drive', entry.scenario], {
    cwd: dest,
    encoding: 'utf8',
    timeout: DRIVE_TIMEOUT_MS,
    env: { ...process.env, PI_BIN: piBinary() },
  });
  const receiptPath = join(dest, 'artifacts', 'user-perspective', entry.scenario, `${entry.surfaceId}.json`);
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    throw new Error(`target receipt ${entry.surfaceId} absent after the ${entry.scenario} drive: ${error.message}; drive exit ${result.status}`);
  }
  return { receipt, driveStatus: result.status };
}

function parseArguments(argv) {
  const options = { ref: 'HEAD', case: undefined };
  for (const arg of argv) {
    if (arg.startsWith('--case=')) options.case = arg.slice('--case='.length);
    else if (arg.startsWith('--ref=')) options.ref = arg.slice('--ref='.length);
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`);
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const binary = piBinary();
const archivedRevision = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', options.ref], { encoding: 'utf8' }).trim();
process.stdout.write(`pi ${binary} -> ${execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()}\n`);
process.stdout.write(`archived ${options.ref} -> ${archivedRevision}\n`);
const selected = options.case === undefined ? CASES : CASES.filter((entry) => entry.case === options.case);
assert.ok(selected.length > 0, `no regression case matches ${JSON.stringify(options.case)}`);

const failures = [];
for (const entry of selected) {
  const dest = prepareCheckout(entry, archivedRevision);
  try {
    const headSha = execFileSync('git', ['-C', dest, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const { receipt, driveStatus } = driveAndRead(dest, entry);
    assert.equal(receipt.surface_id, entry.surfaceId, 'the receipt names a different surface');
    assert.equal(receipt.scenario, entry.scenario, 'the receipt names a different scenario');
    assert.equal(receipt.head_sha, headSha, 'the receipt HEAD is not the mutant tree the drive ran');
    const targetFailed = receipt.verdict === 'failed';
    if (!targetFailed) failures.push(entry.case);
    process.stdout.write(
      `${targetFailed ? '✓' : '✗'} ${entry.case}: ${entry.scenario} ${entry.surfaceId} verdict ${JSON.stringify(receipt.verdict)} (drive exit ${driveStatus})${receipt.reason === null || receipt.reason === undefined ? '' : `\n    reason: ${receipt.reason}`}\n`,
    );
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

process.stdout.write(`legacy oracle regression: ${selected.length - failures.length}/${selected.length} target receipts failed under their mutant\n`);
if (failures.length > 0) {
  process.stdout.write(`still verified (narrow receipt): ${failures.join(', ')}\n`);
  process.exitCode = 1;
}
