/**
 * Theme coverage: every role `src/**` reads from a `Theme` must exist in
 * `themes/cursor-ui.json`. `Theme.fg`/`Theme.bg` throw on an unknown role, so a
 * code-only role would crash a render path at runtime instead of failing at
 * load. This test extracts the read set from the source text and asserts it is
 * a subset of the theme's `colors` map.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

interface ThemeDocument {
  readonly name: string;
  readonly colors: Record<string, string | number>;
}

const THEME: ThemeDocument = JSON.parse(readFileSync(fileURLToPath(new URL('../themes/cursor-ui.json', import.meta.url)), 'utf8'));

/** `theme.fg('role', ...)` / `appTheme.bg('role', ...)` with a literal role. */
const DIRECT_ROLE = /(?:theme|appTheme)\.(?:fg|bg)\(\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g;

/** A `ThemeColor` carried in a lookup table, for example `{ role: 'thinkingHigh' }`. */
const MAPPED_ROLE = /\brole:\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g;

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

function extractThemeRoles(source: string): Set<string> {
  const roles = new Set<string>();
  for (const match of source.matchAll(DIRECT_ROLE)) {
    if (match[1] !== undefined) roles.add(match[1]);
  }
  for (const match of source.matchAll(MAPPED_ROLE)) {
    if (match[1] !== undefined) roles.add(match[1]);
  }
  return roles;
}

function findMissingRoles(source: string, themeRoles: ReadonlySet<string>): string[] {
  return [...extractThemeRoles(source)].filter((role) => !themeRoles.has(role)).sort();
}

const SOURCE = collectSourceFiles(fileURLToPath(new URL('../src', import.meta.url)))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

const THEME_ROLES = new Set(Object.keys(THEME.colors));
const EXTRACTED_ROLES = [...extractThemeRoles(SOURCE)].sort();

/** Roles every current src surface reads. A drop here means the extractor regressed. */
const REQUIRED_ROLES = [
  'accent',
  'borderAccent',
  'dim',
  'error',
  'muted',
  'success',
  'text',
  'thinkingHigh',
  'thinkingLow',
  'thinkingMax',
  'thinkingMedium',
  'thinkingMinimal',
  'thinkingOff',
  'thinkingXhigh',
  'toolDiffAdded',
  'toolDiffContext',
  'toolDiffRemoved',
  'toolOutput',
  'toolTitle',
  'warning',
] as const;

describe('theme role coverage', () => {
  test('extracts the expected role surface from src', () => {
    expect(EXTRACTED_ROLES, `extracted theme roles (${EXTRACTED_ROLES.length}): ${EXTRACTED_ROLES.join(', ')}`).toEqual(expect.arrayContaining([...REQUIRED_ROLES]));
  });

  test('every role referenced in src exists in themes/cursor-ui.json', () => {
    const missing = findMissingRoles(SOURCE, THEME_ROLES);
    expect(EXTRACTED_ROLES).toContain('toolTitle');
    expect(EXTRACTED_ROLES).toContain('toolDiffAdded');
    expect(missing, `extracted theme roles (${EXTRACTED_ROLES.length}): ${EXTRACTED_ROLES.join(', ')}`).toEqual([]);
  });

  test('the extractor flags a code-only role the theme does not define', () => {
    const synthetic = "theme.fg('totallyMissingRole', 'x'); appTheme.bg('alsoMissingBg', 'y');";
    expect(findMissingRoles(synthetic, THEME_ROLES)).toEqual(['alsoMissingBg', 'totallyMissingRole']);
  });

  test('the extractor reads the thinking role table', () => {
    expect(extractThemeRoles("const map = { off: { role: 'thinkingOff' } };")).toEqual(new Set(['thinkingOff']));
  });
});
