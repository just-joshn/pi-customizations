#!/usr/bin/env node
// Fill pi/src/tests and mark verified for lifecycle rows whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const turnEnd = ["pi.on('turn_end')"];
const settle = ["pi.on('turn_end')", "pi.on('agent_settled')", "pi.on('agent_before_settle')"];
const exchangeSrc = ['src/core/exchange.ts', 'src/core/install.ts'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.lifecycle.apply-order': {
    pi: turnEnd,
    src: exchangeSrc,
    tests: ['test/core/lifecycle-bind.test.ts::complete reply parses preflights authorizes then applies in that order', 'test/core/exchange.pi.test.ts::whole-file text completes an SDK edit exchange'],
  },
  'edit.lifecycle.reflect-application-errors': {
    pi: [...turnEnd, 'continue'],
    src: exchangeSrc,
    tests: ['test/core/lifecycle-bind.test.ts::a ValueError prints the edit-format notice URL and error then reflects', 'test/core/exchange.pi.test.ts::a malformed reply reaches the next actual request as feedback'],
  },
  'edit.lifecycle.malformed-count': {
    pi: [...turnEnd, 'continue'],
    src: exchangeSrc,
    tests: ['test/core/lifecycle-bind.test.ts::a ValueError prints the edit-format notice URL and error then reflects', 'test/core/lifecycle.pi.test.ts::exactly three reflections reach provider requests'],
  },
  'edit.lifecycle.max-reflections': {
    pi: [...turnEnd, 'continue', "pi.on('agent_settled')"],
    src: exchangeSrc,
    tests: [
      'test/core/lifecycle.pi.test.ts::exactly three reflections reach provider requests',
      'test/core/lifecycle-bind.test.ts::a fourth reflection stops with the three-reflection warning',
      'test/core/lifecycle.pi.test.ts::a new canonical user resets an exhausted reflection budget',
    ],
  },
  'edit.lifecycle.skip-truncated-reply': {
    pi: turnEnd,
    src: exchangeSrc,
    tests: ['test/core/exchange.pi.test.ts::provider length text never becomes a partial disk edit'],
  },
  'edit.lifecycle.skip-interrupted-reply': {
    pi: [...turnEnd, "pi.on('agent_settled')"],
    src: exchangeSrc,
    tests: ['test/core/exchange.pi.test.ts::provider aborted text never becomes a partial disk edit', 'test/core/lifecycle.pi.test.ts::provider cancellation leaves the disk file unchanged'],
  },
  'edit.lifecycle.skip-errored-reply': {
    pi: turnEnd,
    src: exchangeSrc,
    tests: ['test/core/exchange.pi.test.ts::provider error text never becomes a partial disk edit', 'test/core/retry.pi.test.ts::native retry does not apply the failed response or spend a reflection'],
  },
  'edit.lifecycle.move-to-history': {
    pi: settle,
    src: exchangeSrc,
    tests: ['test/core/lifecycle-bind.test.ts::a successful reply moves history and emits the no-repo saved notice', 'test/core/exchange.pi.test.ts::whole-file text completes an SDK edit exchange'],
  },
  'edit.lifecycle.reset-turn': {
    pi: ['pi.registerVirtualModel', "pi.on('turn_end')"],
    src: exchangeSrc,
    tests: [
      'test/core/lifecycle-bind.test.ts::a new user binding clears reflection and edit tracking',
      'test/core/lifecycle.pi.test.ts::a new canonical user resets an exhausted reflection budget',
      'test/core/lifecycle.pi.test.ts::canonical user binding precedes the actual provider call',
    ],
  },
  'edit.lifecycle.preprocess-input': {
    pi: ['pi.registerVirtualModel', "pi.on('context_with_system')"],
    src: exchangeSrc,
    tests: ['test/core/mentions.pi.test.ts::user preprocessing admits a mentioned file before the first request'],
  },
  'edit.lifecycle.supplied-reply': {
    pi: turnEnd,
    src: ['src/core/exchange.ts', 'src/edit/feature.ts'],
    tests: [
      'test/edit/patch.test.ts::replays the recorded patch CLI update content',
      'test/edit/patch.test.ts::replays the recorded patch CLI add content',
      'test/wholefile.test.ts::replays the recorded whole-file CLI replacement content',
      'test/udiff.test.ts::replays the recorded udiff CLI replacement content',
      'test/editblock-ports.test.ts::replaces only the first exact match',
    ],
  },
  'edit.lifecycle.failed-apply-outcome': {
    pi: turnEnd,
    src: exchangeSrc,
    tests: ['test/core/core-review.pi.test.ts::failed application does not report a successful file update', 'test/core/lifecycle-bind.test.ts::auto-commit and lint ports receive only successfully written paths'],
  },
  'edit.lifecycle.successful-targets': {
    pi: turnEnd,
    src: exchangeSrc,
    tests: [
      'test/core/lifecycle-bind.test.ts::auto-commit and lint ports receive only successfully written paths',
      'test/core/intents.pi.test.ts::a failed MOVE removal keeps the successful destination write separate from prepared targets',
    ],
  },
  'edit.lifecycle.git-port': {
    pi: turnEnd,
    src: exchangeSrc,
    tests: [
      'test/core/lifecycle-bind.test.ts::complete reply parses preflights authorizes then applies in that order',
      'test/core/lifecycle-bind.test.ts::auto-commit and lint ports receive only successfully written paths',
      'test/core/authorize.test.ts::repository policy refusal skips a gitignored path and approved paths reach staging and dirty-commit hooks',
    ],
  },
  'edit.lifecycle.validation-port': {
    pi: [...turnEnd, 'continue'],
    src: exchangeSrc,
    tests: ['test/core/lifecycle-bind.test.ts::a failed lint report reflects after confirmation'],
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
