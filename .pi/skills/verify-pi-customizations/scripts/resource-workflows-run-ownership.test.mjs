import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { reservePort } from '../helpers/resource-workflows-recipes.mjs';
import { listenerAbsent, openRunOwnership, processIdentity } from '../helpers/resource-workflows-run-ownership.mjs';

test('captured owned process remains owned after changing cwd', async () => {
  const root = mkdtempSync('/tmp/f016-run-ownership-');
  function fixtureProcess() {
    process.chdir('/');
    process.stdout.write('ready\n');
    setInterval(() => {}, 1000);
  }
  const code = `(${fixtureProcess.toString()})()`;
  const child = spawn(process.execPath, ['-e', code], { cwd: root });
  const ownership = openRunOwnership({ pid: child.pid, includeRoot: true });
  try {
    await once(child.stdout, 'data');
    const before = await ownership.snapshot();
    assert.equal(before.resources[0].alive, true);
    assert.equal(before.complete, false);
    const rescued = await ownership.rescue();
    assert.equal(rescued.confirmed, true);
    assert.equal(before.resources[0].alive, true);
    assert.equal(processIdentity(child.pid), null);
  } finally {
    ownership.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'close');
      child.kill('SIGTERM');
      await exit;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('listener and changing-cwd descendant are captured before rescue and confirmed absent afterward', async () => {
  const port = await reservePort();
  const code = `const {spawn}=require('node:child_process');const {createServer}=require('node:net');const helper=spawn(process.execPath,['-e','process.chdir("/");setInterval(()=>{},1000)']);createServer().listen(${port},'127.0.0.1',()=>process.stdout.write(String(helper.pid)+'\\n'));`;
  const child = spawn(process.execPath, ['-e', code]);
  const ownership = openRunOwnership({ pid: child.pid, port, includeRoot: true });
  try {
    const [output] = await once(child.stdout, 'data');
    const helperPid = Number(output.toString().trim());
    ownership.capture();
    const before = await ownership.snapshot();
    assert.equal(
      before.resources.some((item) => item.pid === helperPid && item.alive),
      true,
    );
    assert.equal(
      before.resources.some((item) => item.listenerAbsent === false),
      true,
    );
    const rescue = await ownership.rescue();
    assert.equal(rescue.confirmed, true);
    assert.equal(await listenerAbsent(port), true);
    assert.equal(processIdentity(helperPid), null);
    assert.equal(
      before.resources.some((item) => item.alive),
      true,
    );
    assert.equal((await ownership.rescue()).performed, false);
  } finally {
    ownership.close();
    await ownership.rescue();
  }
});

test('only the explicitly leased tmux socket is captured and rescued', async () => {
  const root = mkdtempSync('/tmp/f016-run-tmux-');
  const socket = join(root, 'owned.sock');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const ownership = openRunOwnership({ pid: child.pid, socket, includeRoot: true });
  try {
    execFileSync('tmux', ['-S', socket, 'new-session', '-d', '-s', 'owned', 'sleep 60']);
    const before = await ownership.snapshot();
    assert.equal(before.socketAbsent, false);
    assert.equal(
      before.resources.some((item) => item.socketLease === socket && item.alive),
      true,
    );
    const rescue = await ownership.rescue();
    assert.equal(rescue.confirmed, true);
    assert.equal((await ownership.snapshot()).socketAbsent, true);
    assert.equal(before.socketAbsent, false);
  } finally {
    ownership.close();
    await ownership.rescue();
    rmSync(root, { recursive: true, force: true });
  }
});

test('unavailable root identity cannot claim complete capture or gain signalling authority', async () => {
  const ownership = openRunOwnership({ pid: -1 });
  try {
    const snapshot = await ownership.snapshot();
    assert.equal(snapshot.complete, false);
    assert.deepEqual(snapshot.resources, []);
    assert.equal(snapshot.gaps.includes('Root process identity unavailable.'), true);
    assert.equal((await ownership.rescue()).performed, false);
    assert.equal(processIdentity(1), null);
    assert.equal(processIdentity(null), null);
  } finally {
    ownership.close();
  }
});
