import { describe, expect, test } from 'vitest';
import { align, occurrences, screen } from '../lib/align.ts';
import { type Coordinate, PaletteSchema, parseCoordinate, parseValue } from '../lib/schemas.ts';

const ESC = '\x1b';
const palette = parseValue({ foreground_rgb: '#d8d8d8', background_rgb: '#181818', ansi16_rgb: Array.from({ length: 16 }, () => '#000000') }, PaletteSchema);
const roleOf = (hex: string) => (hex === '#010203' ? 'accent' : undefined);
const cellAt = (s: ReturnType<typeof screen>, at: Coordinate) => {
  const { row, col } = parseCoordinate(at);
  return s.cells[row]?.[col]?.char;
};

describe('occurrences', () => {
  test('counts overlapping occurrences of a token across lines', () => {
    expect(occurrences(screen('aaa\nxaa\n'), 'aa')).toBe(3);
  });
});

describe('align', () => {
  test.for([
    ['ascii prefix', '+ 2   const maxAttempts = 5;'],
    ['wide prefix', '日本 const maxAttempts = 5;'],
  ])('points piAt at the anchored token, not the start of its run (%s)', ([, piLine]) => {
    const pi = screen(`SCENE:x\n${ESC}[38;2;1;2;3m${piLine}${ESC}[39m\n`);
    const claude = screen(`SCENE:x\n  ${ESC}[38;2;248;248;242mmaxAttempts${ESC}[39m\n`);
    const found = align({ scene: 'x', pi, claude, roleOf, palette }).filter((o) => o.token === 'maxAttempts');
    expect(found).toHaveLength(1);
    const [o] = found;
    expect(cellAt(pi, o?.piAt ?? '0:0')).toBe('m');
    expect(cellAt(claude, o?.claudeAt ?? '0:0')).toBe('m');
  });
});
