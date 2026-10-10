#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.prompt.* rows whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const pi = ["pi.on('context_with_system')"];
const formatSrc = ['src/edit/prompts/format.ts'];
const imageSrc = ['src/edit/prompts/format.ts', 'src/support/image-files.ts'];
const prompts = 'test/edit/prompts.test.ts';

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.prompt.message-order': {
    pi,
    src: formatSrc,
    tests: [`${prompts}::all_messages follows system, examples, read-only, repo, done, chat files, current, reminder`],
  },
  'edit.prompt.examples-placement': {
    pi,
    src: formatSrc,
    tests: [`${prompts}::examples as system text use the Example conversations heading, otherwise messages plus codebase reset`],
  },
  'edit.prompt.reminder-placement': {
    pi,
    src: formatSrc,
    tests: [`${prompts}::sys reminder is a final system message and user reminder appends to the last user turn when budget allows`],
  },
  'edit.prompt.reminder-budget': {
    pi,
    src: formatSrc,
    tests: [`${prompts}::reminder admission counts each assembled message once against the input budget`],
  },
  'edit.prompt.reply-language': {
    pi,
    src: formatSrc,
    tests: [`${prompts}::a resolved chat language appears in platform info and as a Reply in instruction`],
  },
  'edit.prompt.images': {
    pi,
    src: imageSrc,
    tests: [`${prompts}::vision models send image and PDF data URLs with Image file or PDF file labels`],
  },
  'edit.prompt.image-mime-dotfiles': {
    pi,
    src: imageSrc,
    tests: [
      `${prompts}::Windows nested dot-only paths produce no image message while ordinary image and PDF paths do`,
      `${prompts}::Windows path rules drop MIME for nested dot-only image names`,
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
