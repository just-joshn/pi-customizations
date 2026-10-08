import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import test from 'node:test';
import { openGuiBridge } from '../helpers/resource-workflows-gui-bridge.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gui-bridge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'workspace');
  const out = join(root, 'protected');
  mkdirSync(cwd); mkdirSync(out, { mode: 0o700 });
  for (const name of ['main.cjs', 'index.html', 'package.json']) writeFileSync(join(cwd, name), name);
  const bridge = await openGuiBridge({ kind: 'electron', root, out, cwd });
  t.after(() => bridge.close());
  return { root, cwd, out, bridge };
}

function request(socket, body) {
  return new Promise((resolve, reject) => {
    const client = connect(socket);
    let text = '';
    client.on('connect', () => client.end(body));
    client.on('data', chunk => { text += chunk; });
    client.on('end', () => resolve(JSON.parse(text)));
    client.on('error', reject);
  });
}

test('a genuine socket action reaches a held lease without starting a VM', async t => {
  const f = await fixture(t);
  const response = await request(f.bridge.socket, JSON.stringify({ capability: f.bridge.capability, action: 'launch' }));
  assert.deepEqual(response, { error: 'runtime release held' });
  assert.equal(f.bridge.snapshot().state, 'held');
});

for (const extra of ['reply', 'window', 'path', 'png', 'success']) {
  test(`the socket rejects agent supplied ${extra}`, async t => {
    const f = await fixture(t);
    assert.deepEqual(await request(f.bridge.socket, JSON.stringify({ capability: f.bridge.capability, action: 'read', [extra]: '../fake' })), { error: 'invalid GUI request' });
  });
}

test('invalid JSON and an oversized request fail closed', async t => {
  const f = await fixture(t);
  assert.deepEqual(await request(f.bridge.socket, '{'), { error: 'invalid GUI JSON' });
  assert.deepEqual(await request(f.bridge.socket, 'x'.repeat(2048)), { error: 'GUI request cap' });
});

test('an existing socket path is never overwritten or followed', async t => {
  const root = mkdtempSync(join(tmpdir(), 'gui-symlink-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'workspace'); const out = join(root, 'out');
  mkdirSync(cwd); mkdirSync(out);
  for (const name of ['main.cjs', 'index.html', 'package.json']) writeFileSync(join(cwd, name), name);
  symlinkSync(join(out, 'protected'), join(root, 'gui.sock'));
  await assert.rejects(openGuiBridge({ kind: 'electron', root, out, cwd }), /socket already exists/);
});

test('the production release rejects missing exact guest application binding', async t => {
  const f = await fixture(t);
  await assert.rejects(f.bridge.releaseRoot({ audit: async () => ({ approved: true }), openBackend: async () => assert.fail('must not start') }), /sealed application binding unavailable/);
});
