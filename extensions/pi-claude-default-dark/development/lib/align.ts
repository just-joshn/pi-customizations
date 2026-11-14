import type { ThemeToken } from '@earendil-works/pi-coding-agent';
import { type Direction, directions, type Observation, type Palette } from './schemas.ts';
import { type Color, parseCapture, type Run, type Style } from './sgr.ts';

export type { Direction, Observation, Palette } from './schemas.ts';

export interface Cell {
  char: string;
  style: Style;
}

export interface Screen {
  lines: string[];
  cells: Cell[][];
  runs: Run[];
  runStartCellIndex: Map<Run, number>;
}

export function screen(text: string): Screen {
  const runs = parseCapture(text);
  const cells: Cell[][] = [];
  const runStartCellIndex = new Map<Run, number>();
  for (const run of runs) {
    const row = cells[run.row] ?? [];
    cells[run.row] = row;
    runStartCellIndex.set(run, row.length);
    for (const char of run.text) row.push({ char, style: run.style });
  }
  const filled = Array.from(cells, (row) => row ?? []);
  return { runs, runStartCellIndex, cells: filled, lines: filled.map((row) => row.map((c) => c.char).join('')) };
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function resolve(color: Color, direction: Direction, palette: Palette): string {
  switch (color.kind) {
    case 'rgb':
      return color.hex;
    case 'default':
      return direction === 'fg' ? 'default-fg' : 'default-bg';
    case 'ansi256': {
      const i = color.index;
      if (i < 16) {
        const value = palette.ansi16_rgb[i];
        if (value === undefined) throw new Error(`missing ANSI color ${i}`);
        return value;
      }
      if (i < 232) {
        const n = i - 16;
        return `#${[Math.floor(n / 36), Math.floor(n / 6) % 6, n % 6].map((v) => hex2(v === 0 ? 0 : 55 + 40 * v)).join('')}`;
      }
      return `#${hex2(8 + (i - 232) * 10).repeat(3)}`;
    }
    default: {
      const _exhaustive: never = color;
      return _exhaustive;
    }
  }
}

export const attrList = (style: Style) =>
  Object.entries(style.attrs)
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join('+') || 'none';

const ANCHOR = /[^\s]{3,}/gu;
const CHROME = /Claude Code v|API Usage Billing|Auto mode|▎|escape interrupt|Press ctrl\+o|Pi can explain|New session started|▀▀█|█▀ █|❯ \/clear/;

export function sceneRows(view: Screen, scene: string): Set<number> {
  const prompt = view.lines.findIndex((line) => line.includes(`SCENE:${scene.replace(/-expanded$|-\d+ms$/, '')}`));
  return new Set(view.lines.map((_, row) => row).filter((row) => row >= prompt && !CHROME.test(view.lines[row] ?? '')));
}

export function align({ scene, pi, claude, roleOf, palette }: { scene: string; pi: Screen; claude: Screen; roleOf: (hex: `#${string}`) => ThemeToken | undefined; palette: Palette }): Observation[] {
  const observations: Observation[] = [];
  const piRows = sceneRows(pi, scene);
  const claudeRows = sceneRows(claude, scene);
  for (const run of pi.runs) {
    if (!piRows.has(run.row)) continue;
    for (const direction of directions) {
      const color = run.style[direction];
      if (color.kind !== 'rgb') continue;
      const role = roleOf(color.hex);
      if (!role) continue;
      for (const match of run.text.matchAll(ANCHOR)) {
        const token = match[0];
        const piAt: Observation['piAt'] = `${run.row}:${(pi.runStartCellIndex.get(run) ?? 0) + [...run.text.slice(0, match.index)].length}`;
        claude.lines.forEach((line, row) => {
          if (!claudeRows.has(row)) return;
          for (let col = line.indexOf(token); col !== -1; col = line.indexOf(token, col + 1)) {
            const start = [...line.slice(0, col)].length;
            const styles = new Set(claude.cells[row]?.slice(start, start + [...token].length).map((c) => `${resolve(c.style[direction], direction, palette)}|${attrList(c.style)}`));
            if (styles.size !== 1) continue;
            const [value = '', attrs = ''] = ([...styles][0] ?? '').split('|');
            observations.push({ role, direction, token, scene, piAt, claudeAt: `${row}:${start}`, claude: value, claudeAttrs: attrs });
          }
        });
      }
    }
  }
  return observations;
}

export function occurrences(view: Screen, token: string): number {
  let total = 0;
  for (const line of view.lines) for (let at = line.indexOf(token); at !== -1; at = line.indexOf(token, at + 1)) total++;
  return total;
}
