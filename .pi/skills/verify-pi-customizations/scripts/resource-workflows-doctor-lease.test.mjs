import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { doctorLeasePolicy } from '../helpers/resource-workflows-doctor-lease.mjs';

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
  { name: 'write and revert', code: 'open(p,"w").write("changed");open(p,"w").write("original")' },
  { name: 'delete', code: 'os.unlink(p)' },
  { name: 'replace', code: 's=p+".atomic";open(s,"w").write("changed");os.replace(s,p)' },
  { name: 'rename', code: 'os.rename(p,p+".renamed")' },
  { name: 'symlink', code: 'os.symlink(p,p+".link")' },
  { name: 'new child', code: 'open(p+".new","w").write("new")' },
  { name: 'path traversal', code: 'open(os.path.join(sys.argv[3],"..","settings.json"),"w").write("changed")' },
  { name: 'runtime symlink escape', code: 's=os.path.join(sys.argv[3],"escape");os.symlink(p,s);open(s,"w").write("changed")' },
  { name: 'policy replacement', code: 'open(sys.argv[4],"w").write("(allow default)")' },
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
  const result = runPolicy(f, 'mutation', 'import sys;open(sys.argv[1],"w").write("approved")', approvedGroups);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.config, 'utf8'), 'approved');
  const denied = runPolicy(f, 'mutation', 'import sys;open(sys.argv[2],"w").write("unapproved")', approvedGroups);
  assert.notEqual(denied.status, 0);
  assert.equal(readFileSync(f.other, 'utf8'), 'context');
});

for (const mutation of mutations.filter((item) => !['overwrite', 'write and revert'].includes(item.name))) {
  test(`mutation kernel denies unapproved ${mutation.name}`, (t) => {
    const f = fixture(t);
    const result = runPolicy(f, 'mutation', `import os,sys;p=sys.argv[1];${mutation.code}`, [{ id: 'config', effect: 'edit', paths: [f.config] }]);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(readFileSync(f.config, 'utf8'), 'original');
  });
}

test('Doctor can prepare fixtures without starting a broad-policy client', () => {
  const source = readFileSync(resolve('.pi/skills/verify-pi-customizations/helpers/resource-workflows-local.mjs'), 'utf8');
  assert.match(source, /deferSession/);
  assert.match(source, /persistSession/);
});
