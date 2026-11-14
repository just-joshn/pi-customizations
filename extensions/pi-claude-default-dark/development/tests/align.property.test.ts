import fc from 'fast-check';
import { expect, test } from 'vitest';
import { align, resolve, type Screen, screen } from '../lib/align.ts';
import { type Coordinate, PaletteSchema, parseCoordinate, parseValue } from '../lib/schemas.ts';

const ESC = '\x1b';
const PROBE = { hex: '#010203', sgr: '38;2;1;2;3', bgSgr: '48;2;1;2;3' } as const;
const palette = parseValue({ foreground_rgb: '#d8d8d8', background_rgb: '#181818', ansi16_rgb: Array.from({ length: 16 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`) }, PaletteSchema);
const roleOf = (hex: string) => (hex === PROBE.hex ? 'accent' : undefined);

const SEED = Number(process.env['ALIGN_PROPERTY_SEED'] ?? 20261113);
const RUNS = Number(process.env['ALIGN_PROPERTY_RUNS'] ?? 5000);

const glyph = fc.constantFrom('a', 'b', 'x', 'M', '1', '_', '=', '(', '日', '本', '語', 'é', 'e\u0301', '🚀', '✓', '─');
const word = fc.array(glyph, { minLength: 1, maxLength: 6 }).map((parts) => parts.join(''));
const gap = fc.constantFrom(' ', '  ', ' + ', ' │ ');
const sgr = fc.constantFrom('39', '49', '0', '1', '22', '2', '3', '23', PROBE.sgr, PROBE.bgSgr, '38;2;248;248;242', '48;2;2;40;0', '34', '38;5;174', '91');
const segment = fc.record({ codes: fc.array(sgr, { maxLength: 3 }), text: fc.array(fc.oneof(word, gap), { minLength: 1, maxLength: 4 }).map((parts) => parts.join('')) });
const line = fc.array(segment, { minLength: 1, maxLength: 5 }).map((segments) => segments.map((s) => s.codes.map((c) => `${ESC}[${c}m`).join('') + s.text).join(''));
const styledRun = (words: fc.Arbitrary<string>) =>
  fc
    .record({ codes: fc.array(sgr, { minLength: 1, maxLength: 3 }), parts: fc.array(fc.oneof(word, gap, words, words), { minLength: 1, maxLength: 6 }) })
    .map(({ codes, parts }) => `${codes.map((c) => `${ESC}[${c}m`).join('')}${parts.join(' ')}`);
const mixedLine = (words: fc.Arbitrary<string>) => fc.array(fc.oneof(styledRun(words), line), { minLength: 1, maxLength: 4 }).map((runs) => runs.join(''));
const padding = fc.record({ reset: fc.boolean(), spaces: fc.integer({ min: 0, max: 12 }) }).map(({ reset, spaces }) => `${reset ? `${ESC}[0m` : ''}${' '.repeat(spaces)}`);
const paddedLine = (words: fc.Arbitrary<string>) => fc.tuple(mixedLine(words), padding).map(([text, pad]) => text + pad);
const capture = (words: fc.Arbitrary<string>) => fc.array(paddedLine(words), { minLength: 1, maxLength: 6 }).map((lines) => `SCENE:x${ESC}[0m\n${lines.join(`${ESC}[0m\n`)}${ESC}[0m\n`);

const cellsAt = (s: Screen, at: Coordinate, length: number) => {
  const { row, col } = parseCoordinate(at);
  return s.cells[row]?.slice(col, col + length) ?? [];
};

const scenario = fc.array(word, { minLength: 1, maxLength: 4 }).chain((shared) => {
  const sharedWord = fc.constantFrom(...shared);
  return fc.record({ piText: capture(sharedWord), claudeText: capture(sharedWord) });
});

test('every observation points at its token in both captures, on cells painted with its role', () => {
  let observed = 0;
  fc.assert(
    fc.property(scenario, ({ piText, claudeText }) => {
      const pi = screen(piText);
      const claude = screen(claudeText);
      for (const o of align({ scene: 'x', pi, claude, roleOf, palette })) {
        observed++;
        const length = [...o.token].length;
        const piCells = cellsAt(pi, o.piAt, length);
        const claudeCells = cellsAt(claude, o.claudeAt, length);
        expect(piCells.map((c) => c.char).join(''), `Pi cells at ${o.piAt} for ${JSON.stringify(o.token)}`).toBe(o.token);
        expect(claudeCells.map((c) => c.char).join(''), `Claude cells at ${o.claudeAt} for ${JSON.stringify(o.token)}`).toBe(o.token);
        for (const c of piCells) expect(c.style[o.direction], `Pi ${o.direction} at ${o.piAt}`).toEqual({ kind: 'rgb', hex: PROBE.hex });
        for (const c of claudeCells) expect(resolve(c.style[o.direction], o.direction, palette), `Claude ${o.direction} at ${o.claudeAt}`).toBe(o.claude);
      }
    }),
    { seed: SEED, numRuns: RUNS },
  );
  expect(observed, 'the generators produced observations to check').toBeGreaterThan(RUNS);
}, 60_000);
