import type { Theme } from '@earendil-works/pi-coding-agent';
import { backgroundAnsi, foregroundAnsi, visibleWidth } from '@earendil-works/pi-tui';
import { CLAUDE } from './palette.js';
import { type Cell, parse, serialize } from './sgr.js';

interface DiffLine {
  cells: Cell[];
  start: number;
  end: number;
  sign: string;
  content: string;
  field: string;
  continuations: Cell[][];
}

const textOf = (cells: Cell[]) => cells.map((cell) => cell.text).join('');
const roleFor = (sign: string) => (sign === '+' ? 'toolDiffAdded' : sign === '-' ? 'toolDiffRemoved' : 'toolDiffContext');

function recognize(line: string, theme: Theme): DiffLine | undefined {
  const cells = parse(line);
  const text = textOf(cells);
  const match = /^(\s*)([+\- ])(\s*\d+) /.exec(text);
  if (!match) return;
  const start = match[1]?.length ?? 0;
  const sign = match[2] ?? '';
  if (cells[start]?.fg !== theme.getFgAnsi(roleFor(sign))) return;
  const end = match[0].length;
  return { cells, start, end, sign, content: text.slice(end).trimEnd(), field: match[3] ?? '', continuations: [] };
}

function continues(line: string, head: DiffLine, theme: Theme): Cell[] | undefined {
  const cells = parse(line);
  const first = cells.findIndex((cell) => cell.text.trim());
  if (first < head.start || cells.slice(0, head.start).some((cell) => cell.text.trim())) return;
  return cells[first]?.fg === theme.getFgAnsi(roleFor(head.sign)) ? cells : undefined;
}

function changedWords(oldText: string, newText: string): [Set<number>, Set<number>] {
  const tokenize = (text: string) => [...text.matchAll(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)].map((match) => ({ text: match[0], at: match.index }));
  const old = tokenize(oldText);
  const next = tokenize(newText);
  if (old.length * next.length > 65_536) return [new Set(), new Set()];
  const table = Array.from({ length: old.length + 1 }, () => new Uint16Array(next.length + 1));
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = next.length - 1; j >= 0; j--) {
      const row = table[i];
      const below = table[i + 1];
      if (!row || !below) continue;
      row[j] = old[i]?.text === next[j]?.text ? 1 + (below[j + 1] ?? 0) : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const removed = new Set(old.map((_, i) => i));
  const added = new Set(next.map((_, i) => i));
  let i = 0;
  let j = 0;
  while (i < old.length && j < next.length) {
    if (old[i]?.text === next[j]?.text) {
      removed.delete(i++);
      added.delete(j++);
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }
  const offsets = (tokens: typeof old, changed: Set<number>) => new Set(tokens.flatMap((token, index) => (changed.has(index) && token.text.trim() ? Array.from({ length: token.text.length }, (_, offset) => token.at + offset) : [])));
  return [offsets(old, removed), offsets(next, added)];
}

interface Continuation {
  head: DiffLine;
  cells: Cell[];
  offset: number;
}

export type Highlight = (code: string) => string[];

function tokenColors(content: string, theme: Theme, highlight: Highlight | undefined): (string | undefined)[] {
  if (!highlight) return [];
  let highlighted: string | undefined;
  try {
    highlighted = highlight(content)[0];
  } catch {
    return [];
  }
  const mode = theme.getColorMode();
  const keyword = theme.getFgAnsi('syntaxKeyword');
  const names = new Set([theme.getFgAnsi('syntaxFunction'), theme.getFgAnsi('syntaxVariable')]);
  const number = theme.getFgAnsi('syntaxNumber');
  const cells = parse(highlighted ?? '');
  if (textOf(cells) !== content) return [];
  const runs: { fg: string; text: string }[] = [];
  for (const cell of cells) {
    const last = runs.at(-1);
    if (last?.fg === cell.fg) last.text += cell.text;
    else runs.push({ fg: cell.fg, text: cell.text });
  }
  return runs.flatMap(({ fg, text }) => {
    const color = fg === keyword ? CLAUDE.diffKeyword : names.has(fg) ? CLAUDE.diffName : fg === number && /^\d[\d.]*$/.test(text) ? CLAUDE.diffNumber : undefined;
    return Array.from(text).flatMap((char) => Array.from({ length: char.length }, () => (color && /[\p{L}\p{N}_$]/u.test(char) ? foregroundAnsi(color, mode) : undefined)));
  });
}

const contentWidth = (cells: Cell[], start: number) => cells.length - 2 * start;
const rowText = (cells: Cell[], start: number) => textOf(cells.slice(start)).trimEnd();
const filledByLongWord = (cells: Cell[], start: number) => {
  const text = rowText(cells, start);
  return !/\s/.test(text) && visibleWidth(text) === contentWidth(cells, start);
};

function wrapsInto(open: DiffLine, candidate: DiffLine): boolean {
  if (open.sign === ' ' || candidate.sign !== open.sign) return false;
  const previous = open.continuations.at(-1) ?? open.cells;
  const firstWord = rowText(candidate.cells, candidate.start).split(/\s/)[0] ?? '';
  const full = visibleWidth(rowText(previous, open.start)) + 1 + visibleWidth(firstWord) > contentWidth(candidate.cells, candidate.start);
  return full && (candidate.field.length !== open.field.length || Number(candidate.field) !== Number(open.field) + 1);
}

export function restyleDiff(lines: string[], theme: Theme, highlight?: Highlight): string[] {
  const heads: (DiffLine | undefined)[] = [];
  const continuations = new Map<number, Continuation>();
  const sequence: (DiffLine | undefined)[] = [];
  let open: DiffLine | undefined;
  for (const [index, raw] of lines.entries()) {
    const recognized = recognize(raw, theme);
    const head = recognized && open && wrapsInto(open, recognized) ? undefined : recognized;
    heads.push(head);
    if (head) {
      open = head;
      sequence.push(head);
      continue;
    }
    const cells = open && continues(raw, open, theme);
    if (open && cells) {
      const first = cells.findIndex((cell) => cell.text.trim());
      const previous = open.continuations.at(-1);
      const separator = previous && filledByLongWord(previous, open.start) ? '' : ' ';
      continuations.set(index, { head: open, cells, offset: open.content.length + separator.length - (first - open.start) });
      open.content += `${separator}${textOf(cells).trim()}`;
      open.continuations.push(cells);
      continue;
    }
    open = undefined;
    sequence.push(undefined);
  }
  const highlights = new Map<DiffLine, Set<number>>();
  for (let i = 0; i < sequence.length; i++) {
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (sequence[i]?.sign === '-') {
      const line = sequence[i++];
      if (line) removed.push(line);
    }
    while (removed.length && sequence[i]?.sign === '+') {
      const line = sequence[i++];
      if (line) added.push(line);
    }
    if (removed.length > 1 && removed.length === added.length)
      removed.forEach((line, index) => {
        const partner = added[index];
        if (!partner) return;
        const [old, next] = changedWords(line.content, partner.content);
        highlights.set(line, old);
        highlights.set(partner, next);
      });
    if (removed.length) i--;
  }
  const mode = theme.getColorMode();
  const fg = foregroundAnsi(CLAUDE.diffText, mode);
  const tokens = new Map(sequence.flatMap((line) => (line && line.sign !== '-' ? [[line, tokenColors(line.content, theme, highlight)] as const] : [])));
  const paint = (line: DiffLine, cells: Cell[], contentFrom: number, offset: number) => {
    const { start, sign } = line;
    const bg = sign === '-' ? backgroundAnsi(CLAUDE.removedLine, mode) : backgroundAnsi(CLAUDE.addedLine, mode);
    const strong = sign === '-' ? backgroundAnsi(CLAUDE.removedWord, mode) : backgroundAnsi(CLAUDE.addedWord, mode);
    const stop = cells.length - start;
    const textEnd = cells.findLastIndex((cell) => cell.text.trim()) + 1;
    for (let i = start; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const inside = i < stop;
      const content = i >= contentFrom && i < textEnd;
      if (sign !== ' ' && inside) cell.bg = cell.inverse || (content && highlights.get(line)?.has(offset)) ? strong : bg;
      cell.inverse = false;
      if (i >= contentFrom) {
        if (inside) cell.fg = (content ? tokens.get(line)?.[offset] : undefined) ?? fg;
        offset += cell.text.length;
      } else if (sign === ' ') {
        cell.fg = fg;
        cell.dim = true;
      }
    }
  };
  return lines.map((raw, index) => {
    const continuation = continuations.get(index);
    if (continuation) {
      paint(continuation.head, continuation.cells, continuation.head.start, continuation.offset);
      return serialize(continuation.cells);
    }
    const line = heads[index];
    if (!line) return raw;
    const { cells, start, end } = line;
    paint(line, cells, end, 0);
    const first = cells[start];
    if (first) cells.splice(start, end - start, ...cells.slice(start + 1, end), first);
    return serialize(cells);
  });
}
