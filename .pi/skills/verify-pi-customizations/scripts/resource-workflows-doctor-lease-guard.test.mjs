import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { prepareDoctorGuard } from '../helpers/resource-workflows-doctor-lease-guard.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const imagePath = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());

async function boundary(t, phase = 'mutation') {
  const root = realpathSync(mkdtempSync('/tmp/doctor-native-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'protected');
  mkdirSync(directory);
  const path = join(root, 'trust.json');
  writeFileSync(path, 'original');
  const groups = [{ id: 'trust', effect: 'edit', paths: [path], effects: [{ path, beforeSha256: digest('original'), afterSha256: digest('approved') }] }];
  const prepared = prepareDoctorGuard({ doctor: { cwd: root, imagePath }, directory, phase, groups });
  const { default: register } = await import(pathToFileURL(prepared.path));
  let tools = new Map();
  let hook;
  await register({
    registerTool(tool) {
      tools = new Map([...tools, [tool.name, tool]]);
    },
    on(event, handler) {
      assert.equal(event, 'tool_call');
      hook = handler;
    },
  });
  return { root, path, tools, hook, prepared };
}

test('actual SDK native write admits only the approved before-to-after bytes', async (t) => {
  const f = await boundary(t);
  assert.equal(f.hook({ toolName: 'write' }), undefined);
  assert.equal(f.hook({ toolName: 'edit' }), undefined);
  await f.tools.get('write').execute('approved', { path: f.path, content: 'approved' });
  assert.equal(readFileSync(f.path, 'utf8'), 'approved');
  await assert.rejects(f.tools.get('write').execute('repeat', { path: f.path, content: 'approved' }), /intermediate byte transition/);
  assert.equal(readFileSync(f.path, 'utf8'), 'approved');
});

test('intermediate writes and attempted reverts never change actual protected file bytes', async (t) => {
  const f = await boundary(t);
  for (const content of ['intermediate', 'original', '', '{}']) await assert.rejects(f.tools.get('write').execute('rejected', { path: f.path, content }), /intermediate byte transition/);
  assert.equal(readFileSync(f.path, 'utf8'), 'original');
});

test('native boundary rejects path traversal, aliases, unknown files and non-string bytes', async (t) => {
  const f = await boundary(t);
  const alias = join(f.root, 'alias');
  symlinkSync(f.path, alias);
  for (const path of [alias, join(f.root, 'unknown'), `${f.root}/protected/../trust.json`, 'trust.json']) await assert.rejects(f.tools.get('write').execute('rejected', { path, content: 'approved' }), /target or operation/);
  await assert.rejects(f.tools.get('write').execute('rejected', { path: f.path, content: null }), /target or operation/);
  assert.equal(readFileSync(f.path, 'utf8'), 'original');
});

test('approved transitions cannot be claimed concurrently or through replaced identities', async (t) => {
  const f = await boundary(t);
  const result = await Promise.allSettled([f.tools.get('write').execute('first', { path: f.path, content: 'approved' }), f.tools.get('write').execute('duplicate', { path: f.path, content: 'approved' })]);
  assert.equal(result[0].status, 'fulfilled');
  assert.equal(result[1].status, 'rejected');
  assert.equal(readFileSync(f.path, 'utf8'), 'approved');
  const other = join(f.root, 'other');
  writeFileSync(other, 'original');
  rmSync(f.path);
  symlinkSync(other, f.path);
  await assert.rejects(f.tools.get('write').execute('alias', { path: f.path, content: 'approved' }), /aliased mutation identity/);
  assert.equal(readFileSync(other, 'utf8'), 'original');
});

test('report native tool boundary rejects mutations even when its hook is bypassed', async (t) => {
  const f = await boundary(t, 'report');
  assert.equal(f.hook({ toolName: 'write' }).block, true);
  assert.equal(f.hook({ toolName: 'edit' }).block, true);
  assert.equal(f.hook({ toolName: 'bash' }).block, true);
  assert.equal(f.hook({ toolName: 'custom' }).block, true);
  assert.equal(f.hook({ toolName: 'read' }), undefined);
  await assert.rejects(f.tools.get('write').execute('write', { path: f.path, content: 'approved' }), /target or operation/);
  await assert.rejects(f.tools.get('edit').execute('edit', { path: f.path, edits: [] }), /exact approved byte transition/);
  const result = await f.tools.get('read').execute('read', { path: f.path });
  assert.deepEqual(result.content, [{ type: 'text', text: 'original' }]);
});
