#!/usr/bin/env node
// Validates parity/ledger.json against the pinned Caveman checkout.
// Usage: node scripts/check-parity.mjs [--final]   (CAVEMAN_CHECKOUT defaults to /tmp/caveman)
// Without --final it fails on any applicable row that is neither verified nor blocked with a blocker.
// With --final it fails on any applicable row that is not verified, blocked rows included.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checkout = resolve(process.env['CAVEMAN_CHECKOUT'] ?? '/tmp/caveman');
const final = process.argv.includes('--final');
const ledger = JSON.parse(readFileSync(join(root, 'parity/ledger.json'), 'utf8'));
const failures = [];
const fail = (message) => failures.push(message);
const pass = (label) => process.stdout.write(`PASS ${label}\n`);

const STATUSES = new Set(['unmapped', 'mapped', 'implemented', 'verified', 'blocked']);
const OWNERS = new Set(['extension', 'skill', 'prompt', 'pi-session', 'external-caveman-service']);
const BEHAVIOR_KEYS = ['preconditions', 'inputs', 'observableOutputs', 'sideEffects', 'persistence', 'failureBehavior', 'safetyBehavior'];
const VERIFICATION_KEYS = ['positiveCases', 'negativeCases', 'edgeCases'];

const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== ledger.upstream.commit) fail(`checkout ${checkout} is at ${head}, ledger pins ${ledger.upstream.commit}`);

function listNames(dir, test) {
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter(test)
        .map((entry) => entry.name)
    : [];
}

function census() {
  const keys = new Set();
  for (const name of listNames(join(checkout, 'skills'), (e) => e.isDirectory() && existsSync(join(checkout, 'skills', e.name, 'SKILL.md')))) keys.add(`skill:${name}`);
  for (const name of listNames(join(checkout, 'commands'), (e) => /\.(toml|md)$/.test(e.name))) keys.add(`command:${name.replace(/\.(toml|md)$/, '')}`);
  for (const name of listNames(join(checkout, 'src/hooks'), (e) => /\.(js|sh|ps1)$/.test(e.name))) keys.add(`hook:${name.replace(/\.(js|sh|ps1)$/, '')}`);
  for (const name of listNames(join(checkout, 'agents'), (e) => /^cavecrew-.*\.md$/.test(e.name))) keys.add(`agent:${name.replace(/\.md$/, '')}`);
  if (existsSync(join(checkout, 'agents/delegate'))) keys.add('agent:delegate');
  for (const name of listNames(join(checkout, 'src/plugins'), (e) => e.isDirectory())) keys.add(`plugin:${name}`);
  for (const name of listNames(join(checkout, 'src/rules'), (e) => e.name.endsWith('.md'))) keys.add(`rule:${name.replace(/\.md$/, '')}`);
  for (const name of listNames(join(checkout, 'src/mcp-servers'), (e) => e.isDirectory())) keys.add(`mcp:${name}`);
  const extension = readFileSync(join(checkout, 'packages/pi-extension/src/index.ts'), 'utf8');
  for (const [, name] of extension.matchAll(/pi\.on\("([a-z_]+)"/g)) keys.add(`pi-event:${name}`);
  for (const [, name] of extension.matchAll(/const RECOVERY_TOOL = "([a-z_]+)"/g)) keys.add(`pi-tool:${name}`);
  for (const verb of JSON.parse(readFileSync(join(checkout, 'agents/reserved-verbs.json'), 'utf8')).verbs) {
    if (!verb.startsWith('-')) keys.add(`cli-verb:${verb}`);
  }
  return keys;
}

function checkShape(row) {
  const where = `row ${row.id ?? '(no id)'}`;
  if (typeof row.id !== 'string' || !row.id) fail(`${where}: missing id`);
  if (typeof row.capability !== 'string' || !row.capability) fail(`${where}: missing capability`);
  if (!['pi', 'host-specific'].includes(row.applicability)) fail(`${where}: applicability must be pi or host-specific`);
  if (!Array.isArray(row.userEntrypoints) || !Array.isArray(row.surface)) fail(`${where}: userEntrypoints and surface must be arrays`);
  if (row.cavemanSource?.commit !== ledger.upstream.commit) fail(`${where}: cavemanSource.commit differs from the pin`);
  for (const key of BEHAVIOR_KEYS) if (!Array.isArray(row.behavior?.[key])) fail(`${where}: behavior.${key} must be an array`);
  if (!OWNERS.has(row.piMapping?.owner)) fail(`${where}: unknown piMapping.owner`);
  if (!row.piMapping?.rationale) fail(`${where}: piMapping.rationale is required`);
  if (!Array.isArray(row.verification?.tests) || !row.verification?.oracle) fail(`${where}: verification needs tests and an oracle`);
  for (const key of VERIFICATION_KEYS) if (!Array.isArray(row.verification?.[key])) fail(`${where}: verification.${key} must be an array`);
  if (!STATUSES.has(row.status)) fail(`${where}: unknown status ${row.status}`);
  if (row.status === 'blocked' && !row.blocker) fail(`${where}: blocked without a blocker`);
}

function checkReferences(row, ids) {
  for (const file of row.cavemanSource.files) if (!existsSync(join(checkout, file))) fail(`row ${row.id}: source path missing upstream: ${file}`);
  for (const ref of row.verification.tests) {
    const [file, name] = ref.split('::');
    if (!file || !name) {
      fail(`row ${row.id}: test reference needs <file>::<name>: ${ref}`);
      continue;
    }
    if (!existsSync(join(root, file))) fail(`row ${row.id}: test file missing: ${file}`);
    else if (!readFileSync(join(root, file), 'utf8').includes(name)) fail(`row ${row.id}: ${file} has no test or check named "${name}"`);
  }
  if (row.applicability === 'host-specific') {
    const missing = (row.piEquivalent ?? []).filter((id) => !ids.has(id));
    if (!row.piEquivalent?.length || missing.length) fail(`row ${row.id}: host-specific rows need existing piEquivalent rows`);
  } else if (row.status === 'verified' && row.verification.tests.length === 0) {
    fail(`row ${row.id}: verified without executable verification`);
  }
}

function checkCoverage(rows) {
  const covered = new Set(rows.flatMap((row) => row.surface));
  const keys = census();
  const wildcard = (key) => covered.has(`${key.split(':')[0]}:*`);
  const uncovered = [...keys].filter((key) => !covered.has(key) && !wildcard(key));
  if (uncovered.length) fail(`upstream surface without a ledger row: ${uncovered.join(', ')}`);
  const stale = [...covered].filter((key) => !key.endsWith(':*') && !keys.has(key));
  if (stale.length) fail(`ledger surface missing upstream: ${stale.join(', ')}`);
  if (!uncovered.length && !stale.length) pass(`every one of ${keys.size} upstream surface keys has a ledger row`);
}

function checkResources() {
  const vendor = spawnSync(process.execPath, [join(root, 'scripts/vendor-runtime.mjs'), '--check'], { encoding: 'utf8', env: { ...process.env, CAVEMAN_CHECKOUT: checkout } });
  if (vendor.status === 0) pass('vendored runtime matches the pin');
  else fail(`vendored runtime drift: ${vendor.stderr.trim()}`);
  const scratch = mkdtempSync(join(tmpdir(), 'pi-caveman-sync-'));
  try {
    execFileSync(process.execPath, [join(root, 'scripts/sync-upstream.mjs'), checkout], { env: { ...process.env, PI_CAVEMAN_SYNC_TARGET: scratch }, stdio: 'ignore' });
    const diff = spawnSync('/usr/bin/diff', ['-r', join(scratch, 'skills'), join(root, 'skills')], { encoding: 'utf8' });
    const agents = spawnSync('/usr/bin/diff', ['-r', join(scratch, 'agents'), join(root, 'agents')], { encoding: 'utf8' });
    if (diff.status === 0 && agents.status === 0) pass('skills/ and agents/ match sync-upstream output');
    else fail(`skills or agents drift from upstream:\n${diff.stdout}${agents.stdout}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const body = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  const prompt = readFileSync(join(root, 'prompts/caveman-init.md'), 'utf8');
  if (body(prompt) === body(readFileSync(join(checkout, 'commands/caveman-init.md'), 'utf8'))) pass("prompts/caveman-init.md matches upstream's command");
  else fail("prompts/caveman-init.md differs from upstream's commands/caveman-init.md");
}

function checkPack() {
  const listing = execFileSync('bun', ['pm', 'pack', '--dry-run', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const files = new Set([...listing.matchAll(/^packed \S+ (.+)$/gm)].map((match) => match[1]));
  const runtime = readdirSync(join(root, 'vendor/caveman/packages/pi-extension/src')).map((name) => `vendor/caveman/packages/pi-extension/src/${name}`);
  const required = [...runtime, 'vendor/caveman/packages/cli/src/provider-routing.ts', 'src/index.ts', 'src/runtime.ts', 'skills/caveman/SKILL.md', 'prompts/caveman-init.md', 'agents/cavecrew-builder.md', 'NOTICE'];
  const missing = required.filter((path) => !files.has(path));
  const leaked = [...files].filter((path) => /(^|\/)(tests?|node_modules|dist)\//.test(path));
  if (!missing.length && !leaked.length) pass('the packed package includes every runtime file');
  else fail(`package contents: missing ${missing.join(', ') || 'none'}; unexpected ${leaked.join(', ') || 'none'}`);
}

const rows = ledger.rows;
for (const row of rows) checkShape(row);
const ids = new Set(rows.map((row) => row.id));
if (ids.size !== rows.length) fail('duplicate row ids');
for (const row of rows) checkReferences(row, ids);
checkCoverage(rows);
checkResources();
checkPack();

const applicable = rows.filter((row) => row.applicability === 'pi');
const count = (status) => applicable.filter((row) => row.status === status).length;
const open = applicable.filter((row) => (final ? row.status !== 'verified' : row.status !== 'verified' && row.status !== 'blocked'));
for (const row of open) fail(`row ${row.id} is ${row.status}${row.blocker ? ` (${row.blocker})` : ''}`);
process.stdout.write(
  `rows ${rows.length}: applicable ${applicable.length}, verified ${count('verified')}, blocked ${count('blocked')}, incomplete ${applicable.length - count('verified') - count('blocked')}, host-specific ${rows.length - applicable.length}\n`,
);
if (failures.length) {
  process.stderr.write(`${failures.map((f) => `FAIL ${f}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(final ? 'parity gate: every applicable row verified\n' : 'parity ledger valid\n');
