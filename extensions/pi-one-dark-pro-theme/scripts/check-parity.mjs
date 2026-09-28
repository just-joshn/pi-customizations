#!/usr/bin/env node
/**
 * Parity gate: the shipped theme must equal a fresh build from the pinned upstream
 * file and the role map, and the role map must cover exactly the pi theme schema.
 * Exits 1 printing every problem, else prints one summary line and exits 0.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkParity, parseRoleMap, readThemeSchema, THEME_NAME, themeSchemaPath } from '../parity/theme.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reason = (error) => (error instanceof Error ? error.message : String(error));

function themeFromArgs(args) {
  const index = args.indexOf('--theme');
  if (index === -1) return join(root, 'themes', `${THEME_NAME}.json`);
  const value = args[index + 1];
  if (value === undefined) throw new Error('--theme needs a path');
  return value;
}

try {
  const themePath = themeFromArgs(process.argv.slice(2));
  const upstreamText = readFileSync(join(root, 'upstream', 'OneDark-Pro-flat.json'), 'utf8');
  const rows = parseRoleMap(readFileSync(join(root, 'parity', 'role-map.tsv'), 'utf8'));
  const schema = readThemeSchema(JSON.parse(readFileSync(themeSchemaPath(root), 'utf8')));
  const committed = JSON.parse(readFileSync(themePath, 'utf8'));
  const label = `themes/${basename(themePath)}`;
  const problems = checkParity({
    upstreamText,
    rows,
    schema,
    committed,
    themeLabel: label,
  });

  if (problems.length > 0) {
    process.stderr.write(`${problems.join('\n')}\n${problems.length} parity problem(s) in ${label}.\n`);
    process.exit(1);
  }
  process.stdout.write(`${THEME_NAME} parity OK: ${rows.length} role map rows, ${Object.keys(committed.colors).length} colors, ${Object.keys(committed.export).length} export colors, upstream sha256 verified\n`);
} catch (error) {
  process.stderr.write(`check:parity failed: ${reason(error)}\n`);
  process.exit(1);
}
