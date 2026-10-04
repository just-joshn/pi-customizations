#!/usr/bin/env node
import { strict as assert } from 'node:assert';

import { writableSources } from './format-write.mjs';

assert.deepEqual(
  writableSources(['extensions/a/vitest.config.ts', 'vitest.config.ts', 'extensions/a/src/index.ts', 'extensions/b/test/vitest.config.ts', 'package.json', 'README.md', 'styles.css']),
  ['extensions/a/src/index.ts', 'package.json', 'styles.css'],
  'no recursive protected basename can reach a formatter writer',
);
assert.deepEqual(writableSources(['a.ts', 'a.ts', 'b.jsonc', 'test.spec.mjs']), ['a.ts', 'b.jsonc', 'test.spec.mjs'], 'writable paths are unique and include executable harnesses');
process.stdout.write('Protected formatting self-test passed.\n');
