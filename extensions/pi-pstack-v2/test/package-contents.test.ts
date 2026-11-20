import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { z } from 'zod';

const root = fileURLToPath(new URL('..', import.meta.url));
const POSIX_SEP = '/';

const packResult = z.array(z.object({ files: z.array(z.object({ path: z.string(), size: z.number() })) })).length(1);

function packedFiles(): { path: string; size: number }[] {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
  const [pack] = packResult.parse(JSON.parse(out));
  return pack?.files ?? [];
}

// The release job runs `bun install` inside skills before publishing, and 0.2.1 shipped
// 1885 files of skills/poteto-mode/scripts/node_modules, including a 23 MB tsc binary.
test('the published tarball carries no installed dependencies', { timeout: 60_000 }, () => {
  const installed = packedFiles().filter((file) => file.path.split(POSIX_SEP).includes('node_modules'));
  expect(installed.map((file) => file.path)).toEqual([]);
});
