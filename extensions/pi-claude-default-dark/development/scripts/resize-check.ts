import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolve, screen } from '../lib/align.ts';
import { PaletteSchema, readJson } from '../lib/schemas.ts';

const [dir, ...frames] = process.argv.slice(2);
if (!dir || !frames.length) throw new Error('usage: resize-check.ts <dir> <file>:<width>...');
const palette = readJson(join(import.meta.dirname, '../captures/terminal-palette.json'), PaletteSchema);
const DIFF_BG = new Set(['#3d0100', '#022800', '#5c0200', '#044700']);

const results = frames.map((frame) => {
  const [file = '', w = ''] = frame.split(':');
  const width = Number(w);
  const view = screen(readFileSync(join(dir, file), 'utf8'));
  const painted = (row: number) => (view.cells[row] ?? []).flatMap((cell, col) => (DIFF_BG.has(resolve(cell.style.bg, 'bg', palette)) ? [col] : []));
  const rows = view.cells.flatMap((_, row) => (painted(row).length ? [row] : []));
  const gaps = rows.filter((row) => {
    const cols = painted(row);
    return cols[0] !== 1 || cols.at(-1) !== width - 2 || cols.length !== width - 2;
  });
  return { file, width, diffRows: rows.length, rowsNotFilledFromColumn1ToWidthMinus2: gaps };
});
const verdict = results.every((r) => r.diffRows > 0 && !r.rowsNotFilledFromColumn1ToWidthMinus2.length) ? 'PASS' : 'FAIL';
console.log(JSON.stringify({ verdict, results }, null, 2));
process.exitCode = verdict === 'PASS' ? 0 : 1;
