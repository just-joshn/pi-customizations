import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { enforceCoverage, run } from '../scripts/verify-upstream.mjs';

for (const report of ['', 'invalid', 'SF:example.ts\nLF:0\nLH:0\nFNF:0\nFNH:0\n', 'SF:example.ts\nLF:1\nLH:2\nFNF:1\nFNH:1\n']) {
  test(`coverage policy rejects invalid report ${JSON.stringify(report)}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pstack-coverage-policy-'));
    try {
      await mkdir(join(dir, 'coverage'));
      await writeFile(join(dir, 'coverage/lcov.info'), report);
      await assert.rejects(enforceCoverage(dir), /empty or invalid/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test('coverage policy rejects below-threshold reports and accepts the exact boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-coverage-policy-'));
  try {
    await mkdir(join(dir, 'coverage'));
    await writeFile(join(dir, 'coverage/lcov.info'), 'SF:example.ts\nLF:10\nLH:7\nFNF:10\nFNH:8\n');
    await assert.rejects(enforceCoverage(dir), /lines coverage is below 80%/);
    await writeFile(join(dir, 'coverage/lcov.info'), 'SF:example.ts\nLF:10\nLH:8\nFNF:10\nFNH:7\n');
    await assert.rejects(enforceCoverage(dir), /functions coverage is below 80%/);
    await writeFile(join(dir, 'coverage/lcov.info'), 'SF:example.ts\nLF:10\nLH:8\nFNF:10\nFNH:8\n');
    await enforceCoverage(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('upstream subprocess failure is propagated without running coverage', () => {
  assert.throws(() => run(['run', '/missing-pstack-script'], tmpdir()), /failed with|ENOENT/);
});
