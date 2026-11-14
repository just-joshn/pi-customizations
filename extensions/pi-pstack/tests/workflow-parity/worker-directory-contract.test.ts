import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadRun } from './lib/view.ts';

test('evidence directories are not workers, but a refused assignment remains visible', () => {
  const repo = mkdtempSync(join(tmpdir(), 'worker-dirs-'));
  const dir = join(repo, '.pi/pstack/runs/run/workers');
  try {
    mkdirSync(join(dir, 'evidence/receipts'), { recursive: true });
    mkdirSync(join(dir, 'refused'));
    writeFileSync(join(dir, 'refused/assignment.json'), '{"role":"candidate"}');
    expect(loadRun(repo, 'run').workers.map((worker) => worker.id)).toEqual(['refused']);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
