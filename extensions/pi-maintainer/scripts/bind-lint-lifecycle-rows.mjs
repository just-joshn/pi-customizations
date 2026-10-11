#!/usr/bin/env node
// Fill pi/src/tests and mark verified for the lint lifecycle/selection/reflection cluster whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const turnEnd = ["pi.on('turn_end')"];
const continueHooks = [...turnEnd, 'continue'];
const exchangeSrc = ['src/core/exchange.ts', 'src/core/install.ts'];
const lintSrc = ['src/lint/validation.ts', 'src/lint/feature.ts', ...exchangeSrc];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'lint.selection.edit-targets': {
    pi: turnEnd,
    src: lintSrc,
    tests: ['test/lint/lifecycle-bind.test.ts::automatic lint selects authorized prepare targets not a git dirty listing', 'test/lint/lifecycle-bind.test.ts::dry-run still lints the authorized edit-target set without writing'],
  },
  'lint.lifecycle.message-reset': {
    pi: ['pi.registerVirtualModel', "pi.on('turn_end')"],
    src: exchangeSrc,
    tests: [
      'test/lint/lifecycle-bind.test.ts::a new user binding clears edit tracking and the shared reflection budget',
      'test/core/lifecycle-bind.test.ts::a new user binding clears reflection and edit tracking',
      'test/core/lifecycle.pi.test.ts::a new canonical user resets an exhausted reflection budget',
    ],
  },
  'lint.reflection.budget': {
    pi: continueHooks,
    src: exchangeSrc,
    tests: [
      'test/lint/lifecycle-bind.test.ts::lint test and malformed reflections share one three-request budget',
      'test/core/lifecycle.pi.test.ts::exactly three reflections reach provider requests',
      'test/core/lifecycle-bind.test.ts::a fourth reflection stops with the three-reflection warning',
    ],
  },
  'lint.commit.post-lint': {
    pi: turnEnd,
    src: [...lintSrc, 'src/git/policy.ts'],
    tests: ['test/lint/lifecycle-bind.test.ts::post-lint commit uses Ran the linter context whether diagnostics were produced', 'test/core/lifecycle-bind.test.ts::a failed lint report reflects after confirmation'],
  },
  'lint.apply.bypasses-validation': {
    pi: ['pi.registerFlag'],
    src: ['src/edit/options.ts', 'src/edit/feature.ts', ...exchangeSrc],
    tests: ['test/lint/lifecycle-bind.test.ts::applySavedResponse applies edits and bypasses lint shell and test validation'],
  },
  'lint.coder.ask-architect': {
    pi: turnEnd,
    src: ['src/edit/modes.ts', ...exchangeSrc],
    tests: [
      'test/lint/lifecycle-bind.test.ts::ask mode produces no edits and skips automatic lint',
      'test/lint/lifecycle-bind.test.ts::architect editor path still runs lint validation after the editor applies',
      'test/core/modes.pi.test.ts::ask mode answers without writing files',
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
