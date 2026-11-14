import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { ColorValueSchema, MappingSchema, PaletteSchema, PointerSchema, parseColorValue, parsePointer, parseValue, RoleSchema, readJson, roleNames } from '../lib/schemas.ts';
import { THEME_TOKENS } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-tokens.js';

const dev = join(import.meta.dirname, '..');

describe('JSON boundaries', () => {
  test('covers exactly the host theme roles', () => {
    expect(Object.keys(roleNames).sort()).toEqual(Object.keys(THEME_TOKENS).sort());
    expect(Object.keys(roleNames)).toHaveLength(56);
    expect(() => parseValue('not-a-role', RoleSchema)).toThrow();
  });

  test('reports the input path when a JSON file does not match its schema', () => {
    const path = join(dev, 'captures/terminal-palette.json');
    expect(() => readJson(path, MappingSchema)).toThrow(`Invalid JSON file ${path}`);
  });

  test('rejects an incomplete terminal palette', () => {
    expect(() => parseValue({ foreground_rgb: '#ffffff', background_rgb: '#000000', ansi16_rgb: [] }, PaletteSchema)).toThrow();
  });
});

describe('capture primitives', () => {
  test('decomposes a validated capture pointer', () => {
    const pointer = parseValue('tool-read-expanded@10:6', PointerSchema);
    expect(parsePointer(pointer)).toEqual({ scene: 'tool-read-expanded', at: '10:6', row: 10, col: 6 });
  });

  test.for(['#f8f8f2', 'ansi:174', 'default'])('accepts color value %s', (value) => {
    expect(parseColorValue(value)).toBe(value);
  });

  test.for(['#fff', '#zzzzzz', 'ansi:-1', 'context-dependent'])('rejects color value %s', (value) => {
    expect(() => parseValue(value, ColorValueSchema)).toThrow();
  });

  test.for(['tool-read@-1:0', 'tool-read@1', 'tool-read@1:NaN'])('rejects malformed pointer %s', (value) => {
    expect(() => parseValue(value, PointerSchema)).toThrow();
  });
});
