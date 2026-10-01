import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { packageRoot } from './session-fixture.ts';

const script = join(packageRoot, 'scripts/profile-history.mjs');

test('history profiler records both readers and refuses reused evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-profile-test-'));
  const directory = join(root, 'evidence');
  try {
    expect(spawnSync(process.execPath, [script, directory, '3'], { encoding: 'utf8' }).status).toBe(0);
    const receipt = await readFile(join(directory, 'results.json'), 'utf8');
    const result = JSON.parse(receipt);
    expect(result.count).toBe(3);
    expect(result.runs.map(({ name, returned }: { name: string; returned: number }) => ({ name, returned }))).toEqual([
      { name: 'sdk', returned: 2 },
      { name: 'gated', returned: 2 },
      { name: 'gated', returned: 2 },
      { name: 'sdk', returned: 2 },
      { name: 'sdk', returned: 2 },
      { name: 'gated', returned: 2 },
    ]);
    expect(result.runs.every(({ elapsedMs }: { elapsedMs: number }) => Number.isFinite(elapsedMs) && elapsedMs >= 0)).toBe(true);
    const duplicate = spawnSync(process.execPath, [script, directory, '3'], { encoding: 'utf8' });
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain('EEXIST');
    expect(await readFile(join(directory, 'results.json'), 'utf8')).toBe(receipt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(['0', '1', '5001', 'not-a-count'])('history profiler rejects invalid count %s', (count) => {
  const result = spawnSync(process.execPath, [script, '/uncreated-history-evidence', count], { encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Usage: node profile-history.mjs');
});
