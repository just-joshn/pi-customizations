import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import test from 'node:test';
import { openGuiBridge } from '../helpers/resource-workflows-gui-bridge.mjs';

test('bridge teardown destroys an adversarial half-open SDK connection within the five-second budget', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gui-shutdown-'));
  const cwd = join(root, 'workspace'); const out = join(root, 'out');
  mkdirSync(cwd); mkdirSync(out);
  for (const name of ['main.cjs', 'index.html', 'package.json']) writeFileSync(join(cwd, name), name);
  const bridge = await openGuiBridge({ kind: 'electron', root, out, cwd });
  const client = connect({ path: bridge.socket, allowHalfOpen: true });
  client.on('error', () => {});
  let timer;
  try {
    await new Promise(done => client.once('connect', done));
    const result = await Promise.race([bridge.close().then(() => 'closed'), new Promise(done => { timer = setTimeout(() => done('stalled'), 200); })]);
    assert.equal(result, 'closed');
  } finally {
    clearTimeout(timer);
    client.destroy();
    await bridge.close();
    rmSync(root, { recursive: true, force: true });
  }
});
