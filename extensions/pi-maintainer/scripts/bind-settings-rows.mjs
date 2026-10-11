#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.settings.* rows with passing proof.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const bind = 'test/settings/settings-bind.test.ts';
const load = 'test/settings/load.test.ts';
const tree = 'test/working-tree.test.ts';

const pi = ['pi.registerFlag', "pi.on('session_start')", 'pi.getFlag'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.settings.precedence': {
    pi,
    src: ['src/settings/load.ts', 'src/settings/resolve.ts', 'src/edit/options.ts'],
    tests: [
      `${bind}::an explicit --env-file dotenv sets PI_MAINTAINER options for resolution`,
      `${bind}::the default git-root .env sets PI_MAINTAINER options for resolution`,
      `${load}::the --config file outranks the default config files`,
      `${load}::an --env-file named in a config file is read last`,
    ],
  },
  'edit.settings.dotenv-overlay': {
    pi,
    src: ['src/settings/load.ts', 'src/settings/dotenv.ts', 'src/settings/config-files.ts'],
    tests: [
      `${bind}::named --env-file overrides earlier dotenv values in the extension environment`,
      `${bind}::oauth then cwd then default git-root env-file override shared keys`,
      `${bind}::an explicit --env-file dotenv sets PI_MAINTAINER options for resolution`,
      `${bind}::the default git-root .env sets PI_MAINTAINER options for resolution`,
      `${load}::.env values feed resolution but never the process environment`,
    ],
  },
  'edit.settings.encoding': {
    pi,
    src: ['src/edit/options.ts', 'src/edit/feature.ts', 'src/edit/working-tree.ts', 'src/settings/load.ts'],
    tests: [`${bind}::cli encoding wins and reaches the edit working tree`, `${tree}::reads UTF-16LE bytes when that codec is configured`],
  },
  'edit.settings.environment-pairs': {
    pi,
    src: ['src/settings/environment-pairs.ts', 'src/settings/load.ts', 'src/edit/options.ts'],
    tests: [
      `${bind}::a single --set-env pair lands in the extension environment`,
      `${bind}::multiple --set-env pairs each apply`,
      `${bind}::--set-env keeps internal spaces after trimming ends`,
      `${bind}::an invalid --set-env pair reports failure without writing`,
    ],
  },
  'edit.settings.diagnostics': {
    pi,
    src: ['src/settings/format-settings.ts', 'src/core/install.ts', 'src/edit/options.ts'],
    tests: [`${bind}::verbose diagnostics list dotenv-derived options and redact credential overlays`],
  },
  'edit.settings.redact-secrets': {
    pi,
    src: ['src/settings/format-settings.ts', 'src/settings/environment-pairs.ts', 'src/core/install.ts'],
    tests: [`${bind}::verbose diagnostics list dotenv-derived options and redact credential overlays`],
  },
  'edit.settings.chat-language-propagation': {
    pi,
    src: ['src/edit/options.ts', 'src/edit/feature.ts', 'src/edit/prompts/format.ts', 'src/settings/load.ts'],
    tests: [`${bind}::chat-language from settings reaches platform context through the edit port`],
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
