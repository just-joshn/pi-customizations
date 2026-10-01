import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
const run = promisify(execFile);
const helper = new URL('../scripts/remote-lease.mjs', import.meta.url).pathname;

test('an independent machine admits one task owner until explicit release', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-machine-lease-'));
  const call = (owner: string, action: string) => run(process.execPath, [helper, dir, owner, action]);
  try {
    await call('one', 'claim');
    await expect(call('one', 'claim')).rejects.toThrow();
    await expect(call('two', 'claim')).rejects.toThrow();
    await call('two', 'release');
    await expect(call('two', 'claim')).rejects.toThrow();
    await call('one', 'release');
    await call('two', 'claim');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
