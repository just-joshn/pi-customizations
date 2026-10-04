import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { packageRoot } from './session-fixture.ts';
import { expectDefined } from './support/expect-defined.ts';

const helper = join(packageRoot, 'skills/show-me-your-work/scripts/log.sh');

test('decision log sanitizes cells and appends without rewriting history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-decisions-'));
  const file = join(root, 'nested space', 'decisions.tsv');
  try {
    expect(spawnSync('bash', [helper, file, '=phase', '+decision\nnext', '-why\rnext', '@evidence\tnext', 'result 🙂'], { encoding: 'utf8' }).status).toBe(0);
    const first = await readFile(file, 'utf8');
    const rows = first.trimEnd().split('\n');
    expect(rows[0]).toBe(['ts', 'phase', 'decision', 'why', 'evidence', 'result'].join('\t'));
    const cells = expectDefined(rows[1]).split('\t');
    expect(cells[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(cells.slice(1)).toEqual(["'=phase", "'+decision next", "'-why next", "'@evidence next", 'result 🙂']);
    expect(spawnSync('bash', [helper, file, 'verification', 'checked', 'fresh evidence', '/fixture/path', 'open'], { encoding: 'utf8' }).status).toBe(0);
    const second = await readFile(file, 'utf8');
    expect(second.startsWith(first)).toBe(true);
    expect(second.trimEnd().split('\n').length).toBe(3);
    expect(expectDefined(second.trimEnd().split('\n')[2]).split('\t').slice(1)).toEqual(['verification', 'checked', 'fresh evidence', '/fixture/path', 'open']);
    expect(spawnSync('bash', [helper, file], { encoding: 'utf8' }).status).toBe(1);
    expect(await readFile(file, 'utf8')).toBe(second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
