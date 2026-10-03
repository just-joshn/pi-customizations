import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** The fixture sources whose recorded lint output lives in test/fixtures. */
export const GOLDEN_SOURCES = {
  'syntax_err.py': 'def broken(\n    return 1\n',
  'undef_name.py': 'def ok():\n    return not_defined\n',
  'syntax_err.js': 'function broken( {\n  return 1;\n}\n',
} as const;

export function goldenText(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

export function goldenJson(name: string): unknown {
  return JSON.parse(goldenText(name));
}
