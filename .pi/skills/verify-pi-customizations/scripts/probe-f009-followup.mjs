import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { contractDigest, contractUnchangedSince } from '../lib/verification-contract.mjs';

const SKILL = '.pi/skills/verify-pi-customizations';
const SOURCE = 'extensions/pi-fixture/test/a';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'f009-followup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [`${SKILL}/a`, SOURCE, 'extensions/pi-fixture/scripts/a']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), 'X');
  }
  return root;
}
function commit(root) {
  const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
  git(['init', '-q']);
  git(['add', '.']);
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture']);
  return git(['rev-parse', 'HEAD']).trim();
}

test('distinct binary source trees cannot collide through delimiter framing', (t) => {
  const root = fixture(t);
  const second = `${SKILL}/b`;
  writeFileSync(join(root, `${SKILL}/a`), `X\0${second}\0Y`);
  const single = contractDigest({ repoRoot: root });
  writeFileSync(join(root, `${SKILL}/a`), 'X');
  writeFileSync(join(root, second), 'Y');
  assert.notEqual(contractDigest({ repoRoot: root }), single);
});

test('legacy proof rejects deletion of an entire committed extension', (t) => {
  const root = fixture(t);
  const sha = commit(root);
  assert.equal(contractUnchangedSince({ repoRoot: root, commit: sha }), true);
  rmSync(join(root, 'extensions/pi-fixture'), { recursive: true });
  assert.equal(contractUnchangedSince({ repoRoot: root, commit: sha }), false);
});

for (const source of [SKILL, '.pi', '.pi/skills', 'extensions', 'extensions/pi-fixture', 'extensions/pi-fixture/test', 'extensions/pi-fixture/scripts']) {
  test(`source root or ancestor symlink ${source} fails closed`, (t) => {
    const root = fixture(t);
    const sha = commit(root);
    const outside = mkdtempSync(join(tmpdir(), 'f009-outside-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(join(outside, 'outside'), 'must not be traversed');
    rmSync(join(root, source), { recursive: true });
    symlinkSync(outside, join(root, source));
    assert.throws(() => contractDigest({ repoRoot: root }), /symlink/);
    assert.equal(contractUnchangedSince({ repoRoot: root, commit: sha }), false);
  });
}

test('excluded dependency symlinks do not change the source contract', (t) => {
  const root = fixture(t);
  const sha = commit(root);
  const digest = contractDigest({ repoRoot: root });
  symlinkSync('/does-not-exist-f009', join(root, SKILL, 'node_modules'));
  assert.equal(contractDigest({ repoRoot: root }), digest);
  assert.equal(contractUnchangedSince({ repoRoot: root, commit: sha }), true);
});

for (const change of ['clean', 'edit', 'add', 'delete', 'bogus', 'nonrepo']) {
  test(`legacy proof ${change}`, (t) => {
    const root = fixture(t);
    const sha = commit(root);
    if (change === 'edit') writeFileSync(join(root, SOURCE), 'changed');
    if (change === 'add') writeFileSync(join(root, `${SKILL}/new`), 'new');
    if (change === 'delete') rmSync(join(root, SOURCE));
    if (change === 'nonrepo') rmSync(join(root, '.git'), { recursive: true });
    assert.equal(contractUnchangedSince({ repoRoot: root, commit: change === 'bogus' ? 'not-a-commit' : sha }), change === 'clean');
  });
}

test('legacy proof rejects changed working bytes even when Git normalizes them', (t) => {
  const root = fixture(t);
  const source = join(root, SKILL, 'normalized.mjs');
  writeFileSync(join(root, '.gitattributes'), '*.mjs text eol=lf\n');
  writeFileSync(source, 'export const value = 1;\n');
  const sha = commit(root);
  assert.equal(contractUnchangedSince({ repoRoot: root, commit: sha }), true);
  writeFileSync(source, 'export const value = 1;\r\n');
  assert.equal(execFileSync('git', ['-C', root, 'diff', '--exit-code'], { encoding: 'utf8', stdio: 'pipe' }), '');
  assert.equal(contractUnchangedSince({ repoRoot: root, commit: sha }), false);
});
