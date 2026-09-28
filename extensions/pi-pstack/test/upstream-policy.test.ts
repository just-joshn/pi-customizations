import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { enforceCoverage, run } from '../scripts/verify-upstream.mjs';

test.each([
  '',
  'invalid',
  'SF:example.ts\nLF:0\nLH:0\nFNF:0\nFNH:0\n',
  'SF:example.ts\nLF:1\nLH:2\nFNF:1\nFNH:1\n',
])('coverage policy rejects invalid report %j', async report => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-coverage-policy-'));
  try {
    await mkdir(join(dir, 'coverage'));
    await writeFile(join(dir, 'coverage/lcov.info'), report);
    await expect(enforceCoverage(dir)).rejects.toThrow(/empty or invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('coverage policy rejects below-threshold reports and accepts the exact boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-coverage-policy-'));
  try {
    await mkdir(join(dir, 'coverage'));
    await writeFile(join(dir, 'coverage/lcov.info'), 'SF:example.ts\nLF:10\nLH:7\nFNF:10\nFNH:8\n');
    await expect(enforceCoverage(dir)).rejects.toThrow(/lines coverage is below 80%/);
    await writeFile(join(dir, 'coverage/lcov.info'), 'SF:example.ts\nLF:10\nLH:8\nFNF:10\nFNH:7\n');
    await expect(enforceCoverage(dir)).rejects.toThrow(/functions coverage is below 80%/);
    await writeFile(join(dir, 'coverage/lcov.info'), 'SF:example.ts\nLF:10\nLH:8\nFNF:10\nFNH:8\n');
    await enforceCoverage(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('upstream subprocess failure is propagated without running coverage', () => {
  expect(() => run(['run', '/missing-pstack-script'], tmpdir())).toThrow(/failed with|ENOENT/);
});
