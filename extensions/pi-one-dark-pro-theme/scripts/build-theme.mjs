#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTheme, parseRoleMap, THEME_NAME } from '../parity/theme.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstreamPath = join(root, 'upstream', 'OneDark-Pro-flat.json');
const roleMapPath = join(root, 'parity', 'role-map.tsv');
const themePath = join(root, 'themes', `${THEME_NAME}.json`);

const reason = (error) => (error instanceof Error ? error.message : String(error));

try {
  const document = JSON.parse(readFileSync(upstreamPath, 'utf8'));
  const rows = parseRoleMap(readFileSync(roleMapPath, 'utf8'));
  writeFileSync(themePath, `${JSON.stringify(buildTheme(document, rows), null, '\t')}\n`);
  process.stdout.write(`wrote themes/${THEME_NAME}.json from ${rows.length} role map rows\n`);
} catch (error) {
  process.stderr.write(`build:theme failed: ${reason(error)}\n`);
  process.exit(1);
}
