import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ownedTranscriptSource } from './probe-pstack-hooks-policy-guards-owned.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2] ?? 'HEAD';
const output = resolve(process.argv[3] ?? join(root, 'artifacts/user-perspective/pstack-hooks-policy-guards-probe'));
const owned = mkdtempSync(join(tmpdir(), 'probe-pstack-hooks-policy-guards-'));
const archive = join(owned, 'repo');
const pi = process.env.PI_BIN ?? 'pi';
mkdirSync(archive);
mkdirSync(output, { recursive: true });
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
try {
  const sha = git(['rev-parse', ref]);
  const version = execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim();
  console.log(`Pi actual version=${version}; archived ref=${sha}`);
  assert.equal(version, '1.1.0');
  const tar = execFileSync('git', ['archive', sha], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', archive], { input: tar });
  const packages = git(['ls-tree', '-r', '--name-only', sha]).split('\n').filter((path) => path === 'package.json' || path.endsWith('/package.json'));
  for (const manifest of packages) {
    const relative = dirname(manifest);
    const modules = join(root, relative, 'node_modules');
    if (existsSync(modules)) symlinkSync(modules, join(archive, relative, 'node_modules'), 'dir');
  }
  git(['init', '-q'], archive);
  git(['config', 'user.name', 'Owned guard probe'], archive);
  git(['config', 'user.email', 'probe@example.invalid'], archive);
  git(['add', '.'], archive);
  git(['commit', '-qm', `Archive ${sha}`], archive);
  const policy = join(archive, '.pi/skills/verify-pi-customizations/scenarios/pstack-hooks-policy.mjs');
  const original = readFileSync(policy, 'utf8');
  if (original.includes('readdirSync(tmpdir())')) {
    writeFileSync(policy, ownedTranscriptSource(original));
    console.log('Archived legacy receipt logic unchanged; transcript lookup restricted to owned RPC task metadata.');
  }
  const temp = join(owned, 'tmp');
  mkdirSync(temp);
  const run = spawnSync(process.execPath, [join(archive, '.pi/skills/verify-pi-customizations/bin/control-pi'), 'drive', 'pstack-hooks-policy', '--out', output], {
    cwd: archive,
    env: { ...process.env, TMPDIR: temp, PI_BIN: pi },
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(join(output, 'drive.log'), `${run.stdout ?? ''}${run.stderr ?? ''}`);
  console.log(`Actual archived producer exit=${run.status}`);
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  assert.equal(run.status, 0, `Archived producer failed: ${run.error?.message ?? run.stderr}`);
  const receipts = ['PS-EVT-30', 'PS-EVT-31'].map((id) => JSON.parse(readFileSync(join(output, `${id}.json`), 'utf8')));
  console.log(JSON.stringify(receipts, null, 2));
  for (const receipt of receipts) {
    assert.equal(receipt.scenario, 'pstack-hooks-policy');
    assert.equal(receipt.verdict, 'verified', `${receipt.surface_id} legacy producer must run causal dynamic guards`);
    assert.match(receipt.observed, /control package .* omitted/);
  }
  const raw = join(output, 'raw');
  const write = readFileSync(join(raw, 'gate-production-child.jsonl'), 'utf8');
  const writeControl = readFileSync(join(raw, 'gate-control-child.jsonl'), 'utf8');
  assert.match(write, /The parent session is in plan mode, so this agent cannot modify files/);
  assert.doesNotMatch(write, /Tool write not found/);
  assert.doesNotMatch(writeControl, /The parent session is in plan mode/);
  const policyText = readFileSync(join(raw, 'policy-production-child.jsonl'), 'utf8');
  const policyControl = readFileSync(join(raw, 'policy-control-child.jsonl'), 'utf8');
  assert.match(policyText, /mcp__hkmcp__hk_echo is not one of the tools this agent was given/);
  assert.doesNotMatch(policyControl, /is not one of the tools this agent was given/);
  assert.match(receipts.find((receipt) => receipt.surface_id === 'PS-EVT-31').observed, /gated file exists=false; .* wrote the file=true/);
  assert.match(receipts.find((receipt) => receipt.surface_id === 'PS-EVT-30').observed, /mcp tools\/call reached the server=false; .* executed the call=true/);
  console.log('PASS legacy receipts require causal production and guard-omitted controls.');
} finally {
  rmSync(owned, { recursive: true, force: true });
}
