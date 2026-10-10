#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.context.* rows with passing proof.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const contextSrc = ['src/core/context.ts', 'src/core/exchange.ts', 'src/core/repo-map.ts', 'src/core/chat-files.ts'];
const contextPi = ["pi.on('context_with_system')", "pi.on('turn_end')"];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.context.inventory-port': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/core/chat-files.ts', 'src/core/exchange.ts', 'src/core/repo-map.ts'],
    tests: ['test/core/context-bind.test.ts::inventory uses tracked files when the git port reports a repository', 'test/core/context-bind.test.ts::inventory falls back to chat files without walking the workspace'],
  },
  'edit.context.map-request': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/core/repo-map.ts', 'src/core/exchange.ts'],
    tests: ['test/core/context-bind.test.ts::repo map request seeds chat files, hints, and retries with fewer constraints'],
  },
  'edit.context.map-summary': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/core/context.ts', 'src/core/exchange.ts'],
    tests: ['test/core/context.pi.test.ts::repository port text occupies the native provider repository chunk'],
  },
  'edit.context.map-policy': {
    pi: contextPi,
    src: ['src/core/exchange.ts', 'src/core/repo-map.ts', 'src/edit/modes.ts'],
    tests: [
      'test/core/context-bind.test.ts::context mode expands map refresh and budget policy on every attempt',
      'test/core/context-bind.test.ts::disabled map policy never calls the repository-context port',
      'test/core/context.pi.test.ts::context mode expands repository-map refresh and budget on the map port',
      'test/core/modes.pi.test.ts::architect editor frame keeps file context and disables shell, warming, and format-change summarization',
    ],
  },
  'edit.context.fresh-files': {
    pi: ["pi.on('context_with_system')"],
    src: contextSrc,
    tests: [
      'test/core/context.pi.test.ts::fresh file content occupies the completed/current boundary',
      'test/core/context.pi.test.ts::failed reads drop editable paths but retain read-only paths',
      'test/edit/prompts.test.ts::the chat files message lists each file above its fenced content',
      'test/working-tree.test.ts::invalid UTF-8 bytes produce the encoding hint',
      'test/working-tree.test.ts::reads UTF-16LE bytes when that codec is configured',
    ],
  },
  'edit.context.read-only-files': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/core/context.ts', 'src/core/exchange.ts'],
    tests: ['test/core/context.pi.test.ts::read-only files are reference text and stay outside the editable set', 'test/core/context.pi.test.ts::repository port text occupies the native provider repository chunk'],
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
