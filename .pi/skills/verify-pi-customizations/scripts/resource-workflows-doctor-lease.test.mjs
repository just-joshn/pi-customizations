import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { doctorApprovedPaths, doctorLeaseJournal, doctorLeasePolicy } from '../helpers/resource-workflows-doctor-lease.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync('/tmp/doctor-lease-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const owned = join(root, 'owned');
  const out = join(root, 'protected');
  const runtime = join(owned, 'runtime');
  const config = join(owned, 'settings.json');
  const other = join(owned, 'AGENTS.md');
  for (const path of [owned, out, runtime]) mkdirSync(path);
  writeFileSync(config, 'original');
  writeFileSync(other, 'context');
  const profile = join(out, 'baseline.sb');
  writeFileSync(profile, `(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write* (require-all (subpath ${JSON.stringify(owned)}) (require-not (subpath ${JSON.stringify(out)}))) (subpath "/dev"))\n`);
  return { root: owned, out, runtime, config, other, doctor: { profile } };
}

function runPolicy(f, phase, code, groups = []) {
  const profile = join(f.out, `${phase}.sb`);
  writeFileSync(profile, doctorLeasePolicy({ doctor: f.doctor, root: f.root, protectedTargets: [f.config, f.other], runtimeWrites: [f.runtime], phase, approvedGroups: groups }));
  return spawnSync('/usr/bin/sandbox-exec', ['-f', profile, '/usr/bin/python3', '-c', code, f.config, f.other, f.runtime, profile], { encoding: 'utf8', timeout: 5000 });
}

const mutations = [
  { name: 'overwrite', code: 'open(p,"w").write("changed")' },
  { name: 'write and revert', code: ['open(p,"w").write("changed")', 'open(p,"w").write("original")'].join(';') },
  { name: 'delete', code: 'os.unlink(p)' },
  { name: 'replace', code: ['s=p+".atomic"', 'open(s,"w").write("changed")', 'os.replace(s,p)'].join(';') },
  { name: 'rename', code: 'os.rename(p,p+".renamed")' },
  { name: 'symlink', code: 'os.symlink(p,p+".link")' },
  { name: 'new child', code: 'open(p+".new","w").write("new")' },
  { name: 'path traversal', code: ['q=sys.argv[3]+"/../settings.json"', 'open(q,"w").write("changed")'].join(';') },
  { name: 'runtime symlink escape', code: ['s=os.path.join(sys.argv[3],"escape")', 'os.symlink(p,s)', 'open(s,"w").write("changed")'].join(';') },
  { name: 'policy replacement', code: ['p=sys.argv[4]', 'open(p,"w").write("(allow default)")'].join(';') },
];

for (const mutation of mutations) {
  test(`report kernel denies ${mutation.name}`, (t) => {
    const f = fixture(t);
    const result = runPolicy(f, 'report', `import os,sys;p=sys.argv[1];${mutation.code}`);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(readFileSync(f.config, 'utf8'), 'original');
  });
}

test('mutation kernel permits only approved existing-file data writes', (t) => {
  const f = fixture(t);
  const approvedGroups = [{ id: 'config', effect: 'edit', paths: [f.config] }];
  const result = runPolicy(f, 'mutation', ['import sys', 'open(sys.argv[1],"w").write("approved")'].join(';'), approvedGroups);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.config, 'utf8'), 'approved');
  const denied = runPolicy(f, 'mutation', ['import sys', 'open(sys.argv[2],"w").write("unapproved")'].join(';'), approvedGroups);
  assert.notEqual(denied.status, 0);
  assert.equal(readFileSync(f.other, 'utf8'), 'context');
});

for (const mutation of mutations.filter((item) => !['overwrite', 'write and revert'].includes(item.name))) {
  test(`mutation kernel denies unapproved ${mutation.name}`, (t) => {
    const f = fixture(t);
    const code = mutation.name === 'path traversal' ? mutation.code.replace('settings.json', 'AGENTS.md') : mutation.name === 'runtime symlink escape' ? mutation.code.replace('os.symlink(p,s)', 'os.symlink(sys.argv[2],s)') : mutation.code;
    const result = runPolicy(f, 'mutation', `import os,sys;p=sys.argv[1];${code}`, [{ id: 'config', effect: 'edit', paths: [f.config] }]);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(readFileSync(f.config, 'utf8'), 'original');
  });
}

for (const phase of ['report', 'mutation']) {
  test(`${phase} kernel denies subprocess creation and background process escape`, (t) => {
    const f = fixture(t);
    const result = runPolicy(f, phase, 'import subprocess;subprocess.run(["/bin/sh","-c","exit 0"],check=True)');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Operation not permitted/);
  });
}

test('Doctor can prepare fixtures without starting a broad-policy client', () => {
  const source = readFileSync(resolve('.pi/skills/verify-pi-customizations/helpers/resource-workflows-local.mjs'), 'utf8');
  assert.match(source, /deferSession/);
  assert.match(source, /persistSession/);
});

test('exact edit authority rejects symlinks, hardlinks, directories and parent paths', (t) => {
  const f = fixture(t);
  const group = (path, effect = 'edit') => [{ id: 'approved', effect, paths: [path] }];
  assert.deepEqual(doctorApprovedPaths(group(f.config), [f.config], f.root), [f.config]);
  const alias = join(f.root, 'alias');
  symlinkSync(f.config, alias);
  assert.throws(() => doctorApprovedPaths(group(alias), [f.root], f.root), /symlinks/);
  linkSync(f.config, join(f.root, 'hardlink'));
  assert.throws(() => doctorApprovedPaths(group(f.config), [f.config], f.root), /singly-linked/);
  assert.throws(() => doctorApprovedPaths(group(f.runtime), [f.runtime], f.root), /regular files/);
  assert.throws(() => doctorApprovedPaths(group(f.other), [f.config], f.root), /outside/);
  assert.throws(() => doctorApprovedPaths(group(join(f.root, '..', 'outside')), [f.root], f.root), /Unowned/);
  assert.throws(() => doctorApprovedPaths(group(f.config, 'delete'), [f.config], f.root), /existing-file edit/);
});

test('immutable policy refuses broad runtime grants and unknown baseline grants', (t) => {
  const f = fixture(t);
  const options = { doctor: f.doctor, root: f.root, protectedTargets: [f.config], runtimeWrites: [f.runtime], phase: 'report' };
  assert.throws(() => doctorLeasePolicy({ ...options, phase: 'unknown' }), /Invalid/);
  assert.throws(() => doctorLeasePolicy({ ...options, approvedGroups: [{ id: 'x' }] }), /Invalid/);
  assert.throws(() => doctorLeasePolicy({ ...options, runtimeWrites: [f.root] }), /disjoint/);
  assert.throws(() => doctorLeasePolicy({ ...options, sdkLock: join(f.root, 'arbitrary.lock') }), /exact SDK output/);
  writeFileSync(f.doctor.profile, '(allow default)');
  assert.throws(() => doctorLeasePolicy(options), /offline baseline/);
});

const completedLease = { id: 'lease-control', phase: 'report', root: '/private/tmp/owned', cwd: '/private/tmp/owned/workspace', drained: true, shutdownErrors: [], profileSha256: 'policy-digest' };
const startCall = (toolName, path, id = 'one') => ({ type: 'tool_execution_start', toolName, toolCallId: id, args: { path } });
const endCall = (id = 'one', isError = false) => ({ type: 'tool_execution_end', toolCallId: id, isError });

test('OS-blocked preapproval write attempts remain violations', () => {
  const journal = doctorLeaseJournal([startCall('write', 'AGENTS.md'), endCall('one', true)], completedLease);
  assert.equal(journal.entries[0].path, '/private/tmp/owned/workspace/AGENTS.md');
  assert.equal(journal.entries[0].succeeded, false);
  assert.equal(journal.violations.length, 1);
  assert.equal(journal.proof.syscallTrace, false);
});

test('unknown shell or custom calls and incomplete or duplicate calls never prove a bounded native journal', () => {
  for (const records of [[startCall('bash'), endCall()], [startCall('custom'), endCall()], [startCall('read', 'AGENTS.md')], [startCall('read', 'AGENTS.md'), endCall(), startCall('read', 'AGENTS.md'), endCall()]]) {
    const journal = doctorLeaseJournal(records, completedLease);
    assert.equal(journal.complete, false);
    assert.ok(journal.unknownCalls.length > 0);
  }
  assert.equal(doctorLeaseJournal([], { ...completedLease, drained: false }).complete, false);
  assert.equal(doctorLeaseJournal([], { ...completedLease, shutdownErrors: [{ error: 'forced kill' }] }).complete, false);
});

test('mutation journal attributes exact approved native writes without accepting unknown target attempts', () => {
  const approved = '/private/tmp/owned/workspace/trust.json';
  const records = [startCall('read', 'AGENTS.md', 'read'), endCall('read'), startCall('write', approved, 'approved'), endCall('approved'), startCall('edit', 'AGENTS.md', 'unapproved'), endCall('unapproved', true)];
  const journal = doctorLeaseJournal(records, { ...completedLease, phase: 'mutation' }, { offset: 20, approvedGroups: [{ id: 'trust', effect: 'edit', paths: [approved] }] });
  assert.equal(journal.entries[0].groupId, 'trust');
  assert.equal(journal.entries[0].index, 22);
  assert.equal(journal.entries[0].succeeded, true);
  assert.equal(journal.violations.length, 1);
});
