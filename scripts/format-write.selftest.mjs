#!/usr/bin/env node
import { strict as assert } from 'node:assert';

import { writableSources } from './format-write.mjs';

assert.deepEqual(
  writableSources(['extensions/a/vitest.config.ts', 'vitest.config.ts', 'extensions/a/src/index.ts', 'extensions/b/test/vitest.config.ts', 'package.json', 'README.md', 'styles.css']),
  ['extensions/a/src/index.ts', 'package.json', 'styles.css'],
  'no recursive protected basename can reach a formatter writer',
);
assert.deepEqual(writableSources(['a.ts', 'a.ts', 'b.jsonc', 'test.spec.mjs']), ['a.ts', 'b.jsonc', 'test.spec.mjs'], 'writable paths are unique and include executable harnesses');
assert.deepEqual(
  writableSources([
    'extensions/pi-pstack/upstream/tool.ts',
    'extensions/pi-pstack/upstream-team-kit/render.js',
    'extensions/pi-pstack/skills/poteto-mode/scripts/store.ts',
    'extensions/pi-pstack/docs/resource-map.json',
    'extensions/pi-pstack/docs/parity/clauses/s1.json',
    'extensions/pi-pstack/src/models.ts',
    'extensions/pi-pstack/test/helpers/source-fidelity.test.ts',
  ]),
  ['extensions/pi-pstack/src/models.ts', 'extensions/pi-pstack/test/helpers/source-fidelity.test.ts'],
  'source evidence and generated delivery cannot reach the formatter writer while maintained code remains writable',
);
process.stdout.write('Protected formatting self-test passed.\n');
