import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';

test('tmux new-session is invoked from exactly one source file', () => {
  const src = join(PACKAGE_ROOT, 'src');
  const invoking = readdirSync(src, { recursive: true })
    .map(String)
    .filter((file) => /\.(ts|mjs|js)$/.test(file) && /['"]new-session['"]/.test(readFileSync(join(src, file), 'utf8')))
    .map((file) => relative(src, join(src, file)));
  expect(invoking).toEqual(['workers.ts']);
});
