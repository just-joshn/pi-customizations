#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.mentions.* rows whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const mentionsSrc = ['src/core/mentions.ts', 'src/core/exchange.ts'];
const pi = ["pi.on('turn_end')", 'pi.registerVirtualModel'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.mentions.extract-paths': {
    pi,
    src: mentionsSrc,
    tests: [
      'test/core/mentions-bind.test.ts::getFileMentions extracts plain, backtick, fence, quote, bold, and Windows-slash paths',
      'test/core/mentions-bind.test.ts::getFileMentions keeps multiline backtick paths',
      'test/core/mentions-bind.test.ts::getFileMentions skips ambiguous basenames and basenames already in chat',
      'test/core/mentions-bind.test.ts::checkForFileMentions prefers the exact shorter path when basenames collide',
      'test/core/mentions-bind.test.ts::checkForFileMentions admits a nested backtick path',
      'test/core/mentions-bind.test.ts::checkForFileMentions skips read-only inventory without prompting',
    ],
  },
  'edit.mentions.confirm-and-remember': {
    pi,
    src: mentionsSrc,
    tests: [
      'test/core/mentions-bind.test.ts::checkForFileMentions offers paths in sorted order, admits approvals, and remembers declines',
      'test/core/mentions-bind.test.ts::checkForFileMentions prefers the exact shorter path when basenames collide',
      'test/core/mentions-bind.test.ts::checkForFileMentions admits a nested backtick path',
      'test/core/mentions.pi.test.ts::assistant mentions reflect before applying the proposed edit',
      'test/core/mentions.pi.test.ts::denied mentions persist on the active branch across reload',
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
