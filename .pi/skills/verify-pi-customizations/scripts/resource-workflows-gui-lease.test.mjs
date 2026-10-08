import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applicationManifest, assertApplication, createGuiLease, parseGuiRequest } from '../helpers/resource-workflows-gui-lease.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gui-lease-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'workspace');
  mkdirSync(cwd);
  for (const [name, text] of Object.entries({ 'package.json': '{}', 'main.cjs': 'app', 'index.html': '<output>Hello</output>' })) writeFileSync(join(cwd, name), text);
  return { root, cwd, manifest: applicationManifest('electron', cwd) };
}

test('the finite request parser accepts only capability and action', () => {
  assert.deepEqual(parseGuiRequest({ capability: 'a'.repeat(64), action: 'read' }), { capability: 'a'.repeat(64), action: 'read' });
});
for (const bad of [null, [], 'read', {}, { action: 'read' }, { capability: 'a'.repeat(64), action: 'ACK' }, ...['reply', 'window', 'path', 'url', 'selector', 'js', 'png', 'success'].map(key => ({ capability: 'a'.repeat(64), action: 'read', [key]: '../forged' }))]) {
  test(`rejects malformed or extra client fields ${JSON.stringify(bad)}`, () => assert.throws(() => parseGuiRequest(bad), /request/));
}

test('held launch never calls a backend even with a valid capability', async t => {
  const f = fixture(t);
  const lease = createGuiLease({ ...f, kind: 'electron' });
  await assert.rejects(lease.dispatch({ capability: lease.capability, action: 'launch' }), /runtime release held/);
  assert.deepEqual(lease.snapshot(), { state: 'held', calls: [], cleanup: null, verdict: 'FAILED' });
});

test('missing or wrong capability fails before release lookup', async t => {
  const f = fixture(t);
  const lease = createGuiLease({ ...f, kind: 'electron' });
  await assert.rejects(lease.dispatch({ capability: 'b'.repeat(64), action: 'launch' }), /capability/);
});

test('model edits invalidate the application identity', t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'index.html'), '<output>Hello Ada</output>');
  assert.throws(() => assertApplication('electron', f.cwd, f.manifest), /application identity/);
});

test('symlink application files fail closed', t => {
  const f = fixture(t);
  rmSync(join(f.cwd, 'main.cjs'));
  symlinkSync('index.html', join(f.cwd, 'main.cjs'));
  assert.throws(() => applicationManifest('electron', f.cwd), /regular private file/);
});

test('application manifests cannot select paths or unsupported kinds', t => {
  const f = fixture(t);
  assert.throws(() => applicationManifest('../electron', f.cwd), /GUI kind/);
  assert.throws(() => assertApplication('electron', f.cwd, { '../escape': 'a'.repeat(64) }), /application identity/);
});

test('release needs parent-owned functions, not claimed facts', async t => {
  const f = fixture(t);
  const lease = createGuiLease({ ...f, kind: 'electron' });
  await assert.rejects(lease.release({ approved: true, guest: f.manifest }), /parent release/);
});

test('parent audit must return the exact application binding', async t => {
  const f = fixture(t);
  const lease = createGuiLease({ ...f, kind: 'electron' });
  let opened = false;
  await assert.rejects(lease.release({ audit: async () => ({ application: { 'index.html': 'scratch' } }), openBackend: async () => { opened = true; } }), /application binding/);
  assert.equal(opened, false);
});

test('actual backend observations are returned and duplicate launch is rejected', async t => {
  const f = fixture(t);
  const lease = createGuiLease({ ...f, kind: 'electron' });
  const actions = [];
  const backend = { action: async action => { actions.push(action); return { value: action === 'read' ? 'Hello Ada' : action }; }, close: async () => ({ vmStopped: true }) };
  await lease.release({ audit: async request => ({ application: request.application }), openBackend: async () => backend });
  assert.deepEqual(await lease.dispatch({ capability: lease.capability, action: 'launch' }), { value: 'launch' });
  await assert.rejects(lease.dispatch({ capability: lease.capability, action: 'launch' }), /state/);
  assert.deepEqual(actions, ['launch']);
  assert.equal(lease.snapshot().verdict, 'FAILED');
});

test('an expired runtime lease fails closed and performs parent cleanup', async t => {
  const f = fixture(t);
  let now = 0;
  let closed = false;
  const lease = createGuiLease({ ...f, kind: 'electron', clock: () => now });
  await lease.release({ audit: async request => ({ application: request.application }), openBackend: async () => ({ action: async () => assert.fail('expired action'), close: async () => { closed = true; return {}; } }) });
  now = 100000;
  await assert.rejects(lease.dispatch({ capability: lease.capability, action: 'launch' }), /lease expired/);
  assert.equal(closed, true);
  assert.equal(lease.snapshot().cleanup.origin, 'parent');
});

test('the runtime deadline closes an idle backend without another client call', async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lease = createGuiLease({ ...f, kind: 'electron' });
  let closed = false;
  await lease.release({ audit: async request => ({ application: request.application }), openBackend: async () => ({ action: async () => ({}), close: async () => { closed = true; return {}; } }) });
  t.mock.timers.tick(100000);
  await lease.close();
  assert.equal(closed, true);
  assert.equal(lease.snapshot().state, 'closed');
  assert.equal(lease.snapshot().cleanup.origin, 'parent');
});

test('the deadline aborts an in-flight action even if its callback ignores cancellation', async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lease = createGuiLease({ ...f, kind: 'electron' });
  await lease.release({ audit: async request => ({ application: request.application }), openBackend: async () => ({ action: async () => new Promise(() => {}), close: async () => ({}) }) });
  const pending = lease.dispatch({ capability: lease.capability, action: 'launch' });
  const rejection = assert.rejects(pending, /closed/);
  t.mock.timers.tick(100000);
  await rejection;
  assert.equal(lease.snapshot().state, 'closed');
});

test('a stuck trusted backend teardown fails within the original five-second budget', async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lease = createGuiLease({ ...f, kind: 'electron' });
  await lease.release({ audit: async request => ({ application: request.application }), openBackend: async () => ({ action: async () => ({}), close: async () => new Promise(() => {}) }) });
  const pending = lease.close();
  const rejection = assert.rejects(pending, /teardown deadline/);
  t.mock.timers.tick(5000);
  await rejection;
  assert.equal(lease.snapshot().cleanup.origin, 'parent');
  assert.equal(lease.snapshot().verdict, 'FAILED');
});

test('parent close invalidates late backend creation and closes it exactly once', async t => {
  const f = fixture(t);
  const lease = createGuiLease({ ...f, kind: 'electron' });
  let finish;
  let closes = 0;
  const creating = new Promise(done => { finish = done; });
  let started;
  const opening = new Promise(done => { started = done; });
  const release = lease.release({ audit: async request => ({ application: request.application }), openBackend: async () => { started(); return creating; } });
  await opening;
  const closed = lease.close();
  finish({ action: async () => ({}), close: async () => { closes++; return {}; } });
  await assert.rejects(release, /closed/);
  await closed;
  assert.equal(closes, 1);
  assert.equal(lease.snapshot().state, 'closed');
});

test('late action completion cannot reopen a lease and concurrent close shares cleanup', async t => {
  const f = fixture(t);
  const lease = createGuiLease({ ...f, kind: 'electron' });
  let finish;
  let closes = 0;
  const action = new Promise(done => { finish = done; });
  await lease.release({ audit: async request => ({ application: request.application }), openBackend: async () => ({ action: async () => action, close: async () => { closes++; return {}; } }) });
  const pending = lease.dispatch({ capability: lease.capability, action: 'launch' });
  await Promise.all([lease.close(), lease.close()]);
  finish({ value: 'ready' });
  await assert.rejects(pending, /closed/);
  assert.equal(closes, 1);
  assert.equal(lease.snapshot().state, 'closed');
});

test('close is idempotent and parent rescue is never agent cleanup', async t => {
  const f = fixture(t);
  const lease = createGuiLease({ ...f, kind: 'electron' });
  assert.deepEqual(await lease.close(), { origin: 'parent', runtime: null });
  assert.deepEqual(await lease.close(), { origin: 'parent', runtime: null });
  assert.equal(lease.snapshot().verdict, 'FAILED');
});
