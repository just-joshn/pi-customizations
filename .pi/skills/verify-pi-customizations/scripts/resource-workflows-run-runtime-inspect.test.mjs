import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { seedRecipe } from '../helpers/resource-workflows-recipes.mjs';
import { runIdentity } from '../helpers/resource-workflows-run-evidence.mjs';
import { assertSource, inspectListener, inspectPane, inspectProcess, requestGreeting, runRead, sameProcess, unchanged } from '../helpers/resource-workflows-run-runtime-inspect.mjs';

async function withServer(mode, run) {
  const handlers = {
    large: (_, response) => response.end('x'.repeat(65537)),
    silent: () => {},
    wrong: (request, response) => {
      response.writeHead(201);
      response.end(request.url === '/greet?name=Ada' ? 'Wrong Ada\n' : 'Wrong route');
    },
  };
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', `import {createServer} from 'node:http'; const server=createServer(${handlers[mode].toString()}); server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = once(child, 'close');
  try {
    const [output] = await once(child.stdout, 'data');
    await run({ port: Number(output.toString().trim()) });
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
}

test('host HTTP observation preserves the real literal response and status', async () => {
  await withServer('wrong', async (identity) => {
    assert.deepEqual(await requestGreeting(identity), { status: 201, body: 'Wrong Ada\n' });
  });
});

test('host HTTP observation rejects bodies beyond its protected capture limit', async () => {
  await withServer('large', async (identity) => {
    await assert.rejects(requestGreeting(identity), { code: 'ENOBUFS' });
  });
});

test('host HTTP observation bounds a listener that never responds', async () => {
  await withServer('silent', async (identity) => {
    await assert.rejects(requestGreeting(identity));
  });
});

test('host HTTP observation rejects connection failure', async () => {
  await assert.rejects(requestGreeting({ port: 1 }));
});

test('host command readers distinguish absence from command failure and timeout', async () => {
  assert.equal(await runRead('/bin/sh', ['-c', 'exit 1'], true), '');
  assert.equal(await runRead('/bin/sh', ['-c', 'printf real']), 'real');
  await assert.rejects(runRead('/bin/sh', ['-c', 'exit 2'], true));
  await assert.rejects(runRead('/bin/sleep', ['2']));
  await assert.rejects(runRead('/bin/echo', ['never'], false, Date.now() - 1), /total deadline exceeded/);
});

test('host subprocess observation leaves the RPC event loop responsive', async () => {
  const timer = new Promise((resolve) => setTimeout(() => resolve('timer'), 0));
  const reading = runRead('/bin/sleep', ['0.1']).then(() => 'read');
  try {
    assert.equal(await Promise.race([reading, timer]), 'timer');
  } finally {
    await reading;
    await timer;
  }
});

test('host identities require PID and birth together', () => {
  assert.equal(sameProcess({ pid: 10, birth: 'a' }, { pid: 10, birth: 'a' }), true);
  assert.equal(sameProcess({ pid: 10, birth: 'a' }, { pid: 10, birth: 'b' }), false);
  assert.equal(sameProcess(null, { pid: 10, birth: 'a' }), false);
});

test('fixture hashes detect source and package replacement rather than marker claims', () => {
  const cwd = mkdtempSync('/tmp/f016-runtime-hashes-');
  try {
    seedRecipe('tui', cwd, 49123, join(cwd, 'terminal.sock'));
    const identity = runIdentity({ kind: 'tui', cwd, port: 49123, socket: join(cwd, 'terminal.sock') });
    assert.equal(unchanged(identity), true);
    assert.doesNotThrow(() => assertSource(identity));
    writeFileSync(join(cwd, 'interaction.txt'), 'Settings enabled');
    assert.equal(unchanged(identity), true);
    writeFileSync(join(cwd, 'package.json'), '{}');
    assert.equal(unchanged(identity), false);
    assert.throws(() => assertSource(identity), /source or package changed/);
    rmSync(join(cwd, 'package.json'));
    writeFileSync(identity.executable, 'print("Settings enabled")');
    assert.equal(unchanged(identity), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('unrelated running processes and sockets cannot become application leases', async () => {
  const cwd = mkdtempSync('/tmp/f016-runtime-unrelated-');
  try {
    seedRecipe('server', cwd, 49123, join(cwd, 'terminal.sock'));
    const identity = runIdentity({ kind: 'server', cwd, port: 49123, socket: join(cwd, 'terminal.sock') });
    const unrelated = { pid: process.pid, birth: 'not-the-current-process' };
    assert.equal(await inspectProcess(identity, unrelated), null);
    assert.equal(await inspectListener(identity, unrelated), null);
    await assert.rejects(inspectPane({ ...identity, kind: 'tui' }, []));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
