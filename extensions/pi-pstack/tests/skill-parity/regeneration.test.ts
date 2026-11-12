import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { fixture, PKG, run, treeHash } from './helpers.ts';

let cleanup = () => {};
afterEach(() => cleanup());

test('regenerating the skills twice produces the committed tree byte for byte', () => {
  const f = fixture();
  cleanup = f.cleanup;
  const committed = treeHash(join(PKG, 'generated'));
  expect(run('compile-skills.mjs', ['--root', f.root]).status).toBe(0);
  const first = treeHash(join(f.root, 'generated'));
  expect(run('compile-skills.mjs', ['--root', f.root]).status).toBe(0);
  expect(treeHash(join(f.root, 'generated'))).toBe(first);
  expect(first).toBe(committed);
});
