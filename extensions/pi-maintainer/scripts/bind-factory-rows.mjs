#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.factory.* rows with passing proof.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.factory.select-format': {
    pi: ['pi.registerFlag', 'pi.registerCommand'],
    src: ['src/edit/factory.ts', 'src/edit/feature.ts', 'src/core/install.ts'],
    tests: [
      'test/edit/factory-bind.test.ts::UnknownEditFormat message names the requested format and valid formats',
      'test/edit/factory-bind.test.ts::selectEditFormat returns the registered protocol for each explicit name',
      'test/edit/factory-bind.test.ts::code and null resolve to the inherited or model-default format',
      'test/edit/factory-bind.test.ts::unknown edit format creation fails with the requested name and valid formats',
      'test/edit/factory-bind.test.ts::invalid --edit-format choice reports the requested name',
    ],
  },
  'edit.factory.transfer-selection': {
    pi: ['pi.registerCommand', 'pi.appendEntry'],
    src: ['src/edit/factory.ts', 'src/edit/commands.ts'],
    tests: ['test/edit/factory-bind.test.ts::mode transfer preserves editable paths, read-only paths, and declined mentions', 'test/edit/factory-bind.test.ts::/ask then /code keep the chat file selection on the active exchange'],
  },
  'edit.factory.prompt-variants': {
    pi: ["pi.on('turn_end')"],
    src: ['src/edit/feature.ts', 'src/edit/modes.ts'],
    tests: ['test/edit/factory-bind.test.ts::diff-fenced, udiff-simple, and editor variants share parent apply paths with their own prompts'],
  },
  'edit.factory.no-legacy-tools': {
    pi: ['pi.setActiveTools', "pi.on('tool_call')", "pi.on('before_agent_start')"],
    src: ['src/edit/feature.ts', 'src/edit/factory.ts', 'src/core/install.ts'],
    tests: ['test/edit/factory-bind.test.ts::active edit modes accept reply-text protocols and omit historical replace_lines tools'],
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
