#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UPSTREAM_SHA256 } from '../parity/theme.ts';
import { formatJSON, parseOriginalSource } from '../parity/upstream.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const original = parseOriginalSource(readFileSync(join(root, 'upstream', 'provenance.json'), 'utf8'));
  const digest = createHash('sha256').update(original).digest('hex');
  if (digest !== UPSTREAM_SHA256) throw new Error(`upstream source sha256 is ${digest}, expected ${UPSTREAM_SHA256}`);
  process.stdout.write(formatJSON(original, join(root, 'upstream', 'OneDark-Pro-flat.json')));
} catch (error) {
  process.stderr.write(`replay:upstream failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
