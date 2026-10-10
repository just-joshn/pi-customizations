#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.reasoning.* rows with passing proof.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.reasoning.strip-before-edits': {
    pi: ["pi.on('turn_end')", 'ThinkingContent (type: thinking) omitted from reply text'],
    src: ['src/edit/reasoning.ts', 'src/core/exchange.ts', 'src/core/install.ts'],
    tests: [
      'test/edit/reasoning-bind.test.ts::removeReasoningContent drops paired tags and text before a stray closing tag',
      'test/edit/reasoning-bind.test.ts::Pi thinking content blocks are omitted from reply text before edits',
      'test/edit/reasoning-bind.test.ts::think tags are stripped from the reply before edits apply',
      'test/edit/reasoning-bind.test.ts::default reply tag strips REASONING_TAG wrappers before edits',
    ],
  },
  'edit.reasoning.strip-auxiliary-replies': {
    pi: ['ctx.modelRegistry (aux call boundary; strip before commit-message consumers)'],
    src: ['src/edit/reasoning.ts'],
    tests: ['test/edit/reasoning-bind.test.ts::auxiliary replies strip the model reasoning tag'],
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
