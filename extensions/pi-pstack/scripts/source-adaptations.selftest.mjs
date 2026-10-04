import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'pstack-source-adaptation-proof-'));
const hash = (text) => createHash('sha256').update(text).digest('hex');
const path = 'skills/poteto-mode/scripts/watch-pr/types.ts';
const original = 'export const values = ["one"];\nexport const first = values[0];\n';
const adapted = 'export const values = ["one"];\nexport const first = values.at(0) ?? "empty";\n';
const formatted = "export const values = ['one'];\nexport const first = values.at(0) ?? 'empty';\n";
const migration = {
  path,
  sourceSha256: hash(original),
  edits: [{ offset: 1, before: ['export const first = values[0];\n'], after: ['export const first = values.at(0) ?? "empty";\n'] }],
  adaptedSha256: hash(adapted),
  formatEdits: [{ offset: 0, before: adapted.match(/[^\n]*\n/g), after: formatted.match(/[^\n]*\n/g) }],
  migratedSha256: hash(formatted),
};
const repo = join(directory, 'repo');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const check = () => execFileSync(process.execPath, [join(directory, 'scripts/check-latest-source.mjs'), repo], { encoding: 'utf8', stdio: 'pipe' });
const record = (value) => writeFile(join(directory, 'docs/vitest-source-migration.json'), JSON.stringify([value]));

try {
  for (const base of [join(repo, 'pstack'), join(directory, 'upstream')]) await mkdir(join(base, 'skills/poteto-mode/scripts/watch-pr'), { recursive: true });
  for (const name of ['docs', 'scripts']) await mkdir(join(directory, name));
  await writeFile(join(repo, 'pstack', path), original);
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'pinned fixture');
  await writeFile(join(directory, 'docs/provenance.json'), JSON.stringify({ pstack: { commit: git('rev-parse', 'HEAD'), path: 'pstack' } }));
  await writeFile(join(directory, 'docs/source-inventory.json'), JSON.stringify([{ path, bytes: formatted.length, sha256: hash(formatted) }]));
  await writeFile(join(directory, 'upstream', path), formatted);
  for (const name of ['check-latest-source.mjs', 'source-overlay-input.mjs']) await copyFile(new URL(name, import.meta.url), join(directory, 'scripts', name));
  await record(migration);
  assert.match(check(), /^Verified 1 normalized pstack source files against [a-f0-9]{40}\.\n$/);
  const { overlayInput } = await import(pathToFileURL(join(directory, 'scripts/source-overlay-input.mjs')).href);
  assert.equal((await overlayInput(path, Buffer.from(formatted))).toString(), adapted, 'formatting reversal retains the compiler adaptation');
  await assert.rejects(overlayInput(path, Buffer.from(`${formatted}// drift\n`)), /Formatted overlay source differs/);
  await record({ ...migration, adaptedSha256: '0'.repeat(64) });
  assert.throws(check, /Compiler adaptation result hash differs/);
  await record({ ...migration, formatEdits: [{ offset: 0, before: ['wrong preformat bytes\n'], after: [formatted] }] });
  assert.throws(check, /Test migration edit differs/);
  await record({ ...migration, formatEdits: [{ offset: -1, before: [], after: [] }] });
  assert.throws(check, /Invalid test-runner source migration/);
  await record({ ...migration, migratedSha256: '0'.repeat(64) });
  assert.throws(check, /Test migration result hash differs/);
  await record(migration);
  const drift = `${formatted}// unrecorded runtime change\n`;
  await writeFile(join(directory, 'upstream', path), drift);
  await writeFile(join(directory, 'docs/source-inventory.json'), JSON.stringify([{ path, bytes: drift.length, sha256: hash(drift) }]));
  assert.throws(check, /Normalized source differs/, 'refreshed source hashes cannot authorize unrecorded drift');
  process.stdout.write('Verified exact compiler and formatting replay, inverse preservation, and refreshed-inventory drift rejection.\n');
} finally {
  await rm(directory, { recursive: true, force: true });
}
