#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'map.rank.lexical-graph': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/map/rank.ts', 'src/map/pagerank.ts', 'src/map/context.ts'],
    tests: [
      'test/map/rank-bind.test.ts::weighted PageRank over same-name def/ref edges omits chat definitions from ranked tags',
    ],
  },
  'map.rank.weights': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/map/rank.ts'],
    tests: [
      'test/map/rank-bind.test.ts::identifier weights multiply mentions and long names by ten, chat refs by fifty, commons by one tenth',
    ],
  },
  'map.rank.personalization': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/map/rank.ts', 'src/map/pagerank.ts'],
    tests: [
      'test/map/rank-bind.test.ts::personalization boosts chat and path/ident matches by 100 over the scan universe and stores only positives',
    ],
  },
  'map.rank.definition-scores': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/map/rank.ts'],
    tests: [
      'test/map/rank-bind.test.ts::definition scores order non-chat defs then append filename-only leftovers before budget search',
    ],
  },
  'map.files.tracked-universe': {
    pi: ['Host.exec'],
    src: ['src/git/policy.ts', 'src/core/chat-files.ts'],
    tests: [
      'test/map/files-hints-bind.test.ts::map file universe is sorted deduplicated Git HEAD-and-index inventory after aiderignore; untracked excluded',
    ],
  },
  'map.files.partition-chat-other': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/core/repo-map.ts'],
    tests: [
      'test/map/files-hints-bind.test.ts::normal mapping partitions editable plus in-root read-only as chat files and excludes them from rendered map text',
    ],
  },
  'map.files.important-basenames': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/map/special.ts', 'src/map/rank.ts'],
    tests: [
      'test/map/rank-bind.test.ts::important basenames match configured root names case-sensitively and prepend when absent from ranked list',
    ],
  },
  'map.hints.mention-extraction': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/core/repo-map.ts', 'src/core/mentions.ts', 'src/core/context.ts'],
    tests: [
      'test/map/files-hints-bind.test.ts::mention hints come from current messages only via path, unique punctuated basename, and stem matches of length >= 5',
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
