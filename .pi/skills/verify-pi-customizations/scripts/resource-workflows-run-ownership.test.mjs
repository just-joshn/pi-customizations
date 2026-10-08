import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';

const capturedOwnerStillAlive = (pid, root) => {
  const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  return cwd.split('\n').includes(`n${root}`);
};

test('captured owned process remains owned after changing cwd', async () => {
  const root = mkdtempSync('/tmp/f016-run-ownership-');
  const child = spawn(process.execPath, ['-e', 'process.chdir("/");process.stdout.write("ready\\n");setInterval(()=>{},1000)'], { cwd: root });
  try {
    await once(child.stdout, 'data');
    assert.equal(capturedOwnerStillAlive(child.pid, root), true);
  } finally {
    const exit = once(child, 'close');
    child.kill('SIGTERM');
    await exit;
    rmSync(root, { recursive: true, force: true });
  }
});
