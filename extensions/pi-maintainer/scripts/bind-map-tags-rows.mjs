#!/usr/bin/env node
// Bind map tags/query open rows closed by pm/map-tags.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const src = [
  'src/map/tag.ts',
  'src/map/extract.ts',
  'src/map/query-runtime.ts',
  'src/map/query-assets.ts',
  'src/map/queries/tree-sitter-language-pack/python-tags.scm',
  'src/map/queries/tree-sitter-languages/julia-tags.scm',
];
const pi = ["pi.on('context_with_system')", 'pi.registerFlag'];
const tests = {
  coordinates:
    'test/map/tags-bind.test.ts::repository tags carry relative and absolute paths, kind, name, and zero-based or minus-one lines',
  extract:
    'test/map/tags-bind.test.ts::unsupported language, unavailable parser or query, and empty input yield no semantic tags',
  lexical:
    'test/map/tags-bind.test.ts::when definitions exist without references, name tokens supply reference tags at line minus one',
  python:
    'test/map/tags-bind.test.ts::Python query assets identify constants, classes, functions, and attribute call names',
  nodup:
    'test/map/tags-bind.test.ts::a parser capture contributes each returned node once rather than appending the final node again',
  assets:
    'test/map/tags-bind.test.ts::query selection prefers language-pack tags assets then tree-sitter-languages; missing yields none',
  julia:
    'test/map/tags-bind.test.ts::Julia mapping degrades without an uncaught query error when the tags query is incompatible',
  deps: 'test/map/tags-bind.test.ts::an install with zero query assets cannot emit definition or reference tags',
};

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'map.tags.coordinates': { pi, src, tests: [tests.coordinates] },
  'map.tags.extract': { pi, src, tests: [tests.extract, tests.coordinates] },
  'map.tags.lexical-fallback': { pi, src, tests: [tests.lexical] },
  'map.tags.python-query': { pi, src, tests: [tests.python] },
  'map.tags.no-duplicate-final-capture': { pi, src, tests: [tests.nodup] },
  'map.query.asset-selection': { pi, src, tests: [tests.assets] },
  'map.query.julia-compat': { pi, src, tests: [tests.julia] },
  'map.deps.query-runtime': { pi, src, tests: [tests.deps, tests.extract] },
};

const updated = [];
for (const row of ledger.rows) {
  const binding = bindings[row.id];
  if (!binding || row.status === 'verified') continue;
  row.status = 'verified';
  row.pi = binding.pi;
  row.src = binding.src;
  row.tests = binding.tests;
  updated.push(row.id);
}

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
process.stdout.write(`verified ${updated.length} rows\n${updated.join('\n')}\n`);
