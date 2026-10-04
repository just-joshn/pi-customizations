import './leak-preload.ts';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const source = join(root, 'upstream/skills/poteto-mode/scripts');
const target = join(root, 'skills/poteto-mode/scripts');

async function files(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(prefix, entry.name);
      if (entry.name === 'node_modules') return [];
      return entry.isDirectory() ? files(directory, path) : [path];
    }),
  );
  return nested.flat();
}

for (const path of ['bootstrap.ts', 'check-plan.mjs', 'package.json', 'bun.lock', ...(await files(join(source, 'orch'))).map((path) => join('orch', path)), ...(await files(join(source, 'watch-pr'))).map((path) => join('watch-pr', path))]) {
  test(`portable helper retains the frozen source bytes: ${path}`, async () => {
    expect(await readFile(join(target, path), 'utf8')).toBe(await readFile(join(source, path), 'utf8'));
  });
}

test('worktree path parsing and dirty/safe classification retain source expressions', async () => {
  const text = await readFile(join(target, 'worktree-audit.sh'), 'utf8');
  expect(text).toContain("main_wt=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')");
  expect(text).toContain("git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do");
  expect(text).toContain('case "$dirty" in wip:*) bucket=hold-wip');
  expect(text).toContain('elif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe');
});

test('decision log retains the source append behavior without a writer lock', async () => {
  const text = await readFile(join(root, 'skills/show-me-your-work/scripts/log.sh'), 'utf8');
  expect(text).not.toContain('lockdir=');
  expect(text).toContain('# that exists. Then the cost is one stray header line, not the rows.');
});
