import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { packageRoot } from './session-fixture.ts';

const available =
  process.platform === 'darwin' &&
  (await access('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome').then(
    () => true,
    () => false,
  ));
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type Allocation = { pid: number; profile: string };

async function release(child: ReturnType<typeof spawn>, exited: Promise<unknown>, allocation: Allocation | undefined, root: string): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await exited;
  }
  if (allocation) {
    if (alive(allocation.pid)) process.kill(allocation.pid, 'SIGTERM');
    await vi.waitFor(
      () => {
        expect(alive(allocation.pid)).toBe(false);
      },
      { timeout: 10000 },
    );
    await rm(allocation.profile, { recursive: true, force: true });
  }
  await rm(root, { recursive: true, force: true });
}

test.skipIf(!available).each(['SIGINT', 'SIGTERM'] as const)(
  'interrupting the browser harness with %s cleans its owned Chrome allocation',
  async (signal) => {
    const root = await mkdtemp(join(tmpdir(), 'pstack-canvas-signal-'));
    const hook = join(root, 'capture.mjs');
    await writeFile(
      hook,
      `import childProcess from 'node:child_process';\nimport { mock } from 'node:test';\nimport { syncBuiltinESMExports } from 'node:module';\nconst original = childProcess.spawn;\nmock.method(childProcess, 'spawn', (...args) => { const child = original(...args); if (String(args[0]).endsWith('/Google Chrome')) process.stdout.write(JSON.stringify({ pid: child.pid, profile: args[1].find((value) => value.startsWith('--user-data-dir=')).slice('--user-data-dir='.length) }) + '\\n'); return child; });\nsyncBuiltinESMExports();\n`,
    );
    const child = spawn(process.execPath, ['--import', hook, join(packageRoot, 'scripts/verify-canvas-browser.mjs'), join(root, 'evidence')], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    let allocation: Allocation | undefined;
    const allocationLine = new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
        if (output.includes('\n')) resolve(output.split('\n')[0] ?? '');
      });
      child.once('exit', () => reject(new Error('the harness exited before it spawned Chrome')));
    });
    try {
      allocation = JSON.parse(await allocationLine);
      if (!allocation) throw new Error('missing owned Chrome allocation');
      expect(alive(allocation.pid)).toBe(true);
      expect(child.kill(signal)).toBe(true);
      await exited;
      expect(alive(allocation.pid)).toBe(false);
      await expect(stat(allocation.profile)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await release(child, exited, allocation, root);
    }
  },
  30000,
);
