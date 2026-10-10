#!/usr/bin/env node
// Bind map render/budget/cache/context/fail open rows closed by pm/map-render.
// Leaves map.render.structural-context open (TreeContext / filename-map subset only).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const src = [
  'src/map/budget.ts',
  'src/map/context.ts',
  'src/map/sampled-prefix.ts',
  'src/map/tags-cache.ts',
  'src/map/rendered-cache.ts',
  'src/map/prompt-insertion.ts',
  'src/map/render.ts',
  'src/core/repo-map.ts',
  'src/edit/prompts/format.ts',
];
const pi = ["pi.on('context_with_system')", 'pi.registerFlag'];
const tests = {
  modelDefault:
    'test/map/render-bind.test.ts::default map budget is one eighth of model input capacity clamped to 1024 through 4096',
  explicit:
    'test/map/render-bind.test.ts::positive explicit map budget enables mapping when model policy would disable it',
  sampled:
    'test/map/render-bind.test.ts::map selection uses sampled token estimates and binary search for a ranked prefix within fifteen percent of budget',
  tagsMtime:
    'test/map/render-bind.test.ts::tag cache entries are reused only for the same filename and mtime and are replaced after a miss',
  rendered:
    'test/map/render-bind.test.ts::manual refresh reuses the last map, files refresh reuses file-set and budget keys, always recomputes, and auto reuses hint-sensitive keys when map processing exceeds one second',
  expand:
    'test/map/render-bind.test.ts::context mode forces map refresh, multiplies the map budget by the no-file multiplier, and resets that multiplier to one',
  seed: 'test/map/render-bind.test.ts::repository mapping uses editable and in-root read-only seeds with conversation hints and retries an empty map with fewer hints or seeds',
  zero: 'test/map/render-bind.test.ts::a nonpositive map token budget returns no map text from RepoMap',
  recursion:
    'test/map/render-bind.test.ts::a RecursionError during map generation is reported and the map budget is set to zero so later maps stay disabled',
  memory:
    'test/map/render-bind.test.ts::when persistent tag-cache creation fails, mapping recreates the cache or falls back to an in-memory dictionary and continues producing maps',
  prompt:
    'test/map/render-bind.test.ts::the coder inserts the prefixed repository map as a user message followed by an assistant acknowledgment, with optional cache marking after the map chunk',
};

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'map.budget.model-default': { pi, src, tests: [tests.modelDefault] },
  'map.budget.explicit-enable': { pi, src, tests: [tests.explicit] },
  'map.budget.sampled-prefix': { pi, src, tests: [tests.sampled] },
  'map.cache.tags-mtime': { pi, src, tests: [tests.tagsMtime] },
  'map.cache.rendered-policy': { pi, src, tests: [tests.rendered] },
  'map.context.expand-refresh-map': { pi, src, tests: [tests.expand] },
  'map.context.seed-and-fallback': { pi, src, tests: [tests.seed] },
  'map.fail.zero-budget-none': { pi, src, tests: [tests.zero] },
  'map.fail.recursion-disables': { pi, src, tests: [tests.recursion] },
  'map.fail.cache-memory-fallback': { pi, src, tests: [tests.memory] },
  'map.render.prompt-insertion': { pi, src, tests: [tests.prompt] },
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
