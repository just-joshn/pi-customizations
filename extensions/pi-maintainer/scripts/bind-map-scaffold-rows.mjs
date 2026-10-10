#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'map.architect.disable-editor-map': {
    pi: ["pi.on('context_with_system')", "pi.on('turn_end')"],
    src: ['src/core/exchange.ts', 'src/core/repo-map.ts'],
    tests: [
      'test/core/modes.pi.test.ts::architect editor frame keeps file context and disables shell, warming, and format-change summarization',
      'test/map/scaffold-bind.test.ts::disabled map policy never calls the repository-context port',
    ],
  },
  'map.budget.no-files': {
    pi: ["pi.on('context_with_system')", 'pi.registerFlag'],
    src: ['src/map/budget.ts', 'src/map/context.ts', 'src/map/options.ts'],
    tests: ['test/map/scaffold-bind.test.ts::without chat files the configured multiplier expands the map budget subject to context capacity minus 4096'],
  },
  'map.model.mapping-policy': {
    pi: ['pi.registerFlag'],
    src: ['src/map/mapping-policy.ts', 'src/map/model-map-settings.json', 'src/map/feature.ts'],
    tests: ['test/map/scaffold-bind.test.ts::repository mapping defaults off unless packaged settings or heuristics enable it'],
  },
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
