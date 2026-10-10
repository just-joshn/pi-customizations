#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'map.commands.map-print': {
    pi: ['pi.registerCommand'],
    src: ['src/map/commands.ts', 'src/map/feature.ts', 'src/core/repo-map.ts'],
    tests: [
      'test/map/commands-bind.test.ts::/map builds the repository map through the coder wrapper and prints the resulting map text',
    ],
  },
  'map.commands.map-refresh': {
    pi: ['pi.registerCommand'],
    src: ['src/map/commands.ts', 'src/map/feature.ts', 'src/core/repo-map.ts'],
    tests: [
      'test/map/commands-bind.test.ts::/map-refresh forces the first wrapper mapping attempt and reports success without printing the map',
    ],
  },
  'map.commands.tokens-report': {
    pi: ['pi.registerCommand'],
    src: ['src/map/tokens-map.ts', 'src/edit/commands.ts'],
    tests: [
      'test/map/commands-bind.test.ts::/tokens calls RepoMap directly with editable files as chat, omitting repository read-only partitioning, mention hints, and global fallbacks',
    ],
  },
  'map.commands.show-repo-map': {
    pi: ['pi.registerFlag', "pi.on('session_start')"],
    src: ['src/map/show-repo-map.ts', 'src/map/options.ts', 'src/core/install.ts'],
    tests: [
      'test/map/commands-bind.test.ts::--show-repo-map builds the map through the coder wrapper, prints it, and exits',
    ],
  },
  'map.config.map-mul': {
    pi: ['pi.registerFlag'],
    src: ['src/map/options.ts', 'src/map/budget.ts', 'src/map/feature.ts'],
    tests: [
      'test/map/commands-bind.test.ts::the map no-files multiplier option configures how far an empty-chat map budget may expand subject to known context capacity minus 4096 tokens',
    ],
  },
  'map.security.source-disclosure': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/map/render.ts'],
    tests: [
      'test/map/commands-bind.test.ts::rendered map text can include filenames plus source excerpts with literals, comments, and configuration values, without secret redaction',
    ],
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
