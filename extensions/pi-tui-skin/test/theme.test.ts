import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

type ColorValue = string | number;

interface ThemeDocument {
  name: string;
  vars: Record<string, ColorValue>;
  colors: Record<string, ColorValue>;
}

interface ThemeSchema {
  properties: {
    colors: { required: string[] };
  };
}

const THEME_SCHEMA_TAIL = 'dist/modes/interactive/theme/theme-schema.json';

function resolveThemeSchemaPath(): string {
  const require = createRequire(import.meta.url);
  try {
    const manifest = require.resolve('@earendil-works/pi-coding-agent/package.json');
    return join(dirname(manifest), THEME_SCHEMA_TAIL);
  } catch {
    // The package's exports map does not publish ./package.json, so fall back to
    // walking node_modules for the installed package directory.
    let directory = dirname(fileURLToPath(import.meta.url));
    while (!existsSync(join(directory, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'))) {
      const parent = dirname(directory);
      if (parent === directory) throw new Error('cannot locate the installed @earendil-works/pi-coding-agent');
      directory = parent;
    }
    return join(directory, 'node_modules', '@earendil-works', 'pi-coding-agent', THEME_SCHEMA_TAIL);
  }
}

const schema: ThemeSchema = JSON.parse(readFileSync(resolveThemeSchemaPath(), 'utf8'));
const theme: ThemeDocument = JSON.parse(readFileSync(fileURLToPath(new URL('../themes/tui-skin.json', import.meta.url)), 'utf8'));

function resolveColor(value: ColorValue | undefined): ColorValue | undefined {
  return typeof value === 'string' && value !== '' && !value.startsWith('#') ? (theme.vars[value] ?? value) : value;
}

describe('tui-skin theme', () => {
  test('names the theme tui-skin', () => {
    expect(theme.name).toBe('tui-skin');
  });

  test('defines every schema-required color', () => {
    const missing = schema.properties.colors.required.filter((role) => !(role in theme.colors));
    expect(missing.length).toBe(0);
  });

  test('uses hex strings or 0..255 integers', () => {
    const values = [...Object.values(theme.colors), ...Object.values(theme.vars)];
    const outOfRange = values.filter((value) => typeof value === 'number' && (!Number.isInteger(value) || value < 0 || value > 255));
    const wrongType = values.filter((value) => typeof value !== 'string' && typeof value !== 'number');
    expect(outOfRange.length).toBe(0);
    expect(wrongType.length).toBe(0);
  });

  test('resolves every variable reference', () => {
    const references = Object.values(theme.colors).filter((value): value is string => typeof value === 'string' && value !== '' && !value.startsWith('#'));
    const unresolved = references.filter((reference) => !(reference in theme.vars));
    expect(unresolved.length).toBe(0);
  });

  test('starts the thinking ramp at the success green', () => {
    expect(theme.vars['green']).toBe('#3ed07a');
    expect(resolveColor(theme.colors['thinkingOff'])).toBe('#3ed07a');
  });
});
