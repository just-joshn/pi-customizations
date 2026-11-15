import { replaceControlCharacters, stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

export interface LineSlice {
  readonly lines: readonly string[];
  readonly hidden: number;
}

export function countLines(text: string): number {
  let count = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) count++;
  return count + Number(text.length > 0 && !text.endsWith('\n'));
}

export function headLines(text: string, max: number): LineSlice {
  const lines: string[] = [];
  let start = 0;
  while (start < text.length && lines.length < max) {
    const end = text.indexOf('\n', start);
    lines.push(text.slice(start, end === -1 ? text.length : end).replace(/\r$/, ''));
    start = end === -1 ? text.length : end + 1;
  }
  return { lines, hidden: countLines(text) - lines.length };
}

export function tailLines(text: string, max: number): LineSlice {
  const lines: string[] = [];
  let end = text.endsWith('\n') ? text.length - 1 : text.length;
  while (end > 0 && lines.length < max) {
    const start = text.lastIndexOf('\n', end - 1);
    lines.push(text.slice(start + 1, end).replace(/\r$/, ''));
    end = start;
  }
  if (end === 0 && lines.length < max && text.startsWith('\n')) lines.push('');
  return { lines: lines.reverse(), hidden: countLines(text) - lines.length };
}

export function sanitizeLine(line: string): string {
  return replaceControlCharacters(stripTerminalSequences(line.replace(/\t/g, '  ').replace(/[\r\n]/g, ' ')));
}

export function fitPlain(text: string, width: number): string {
  if (width <= 0) return '';
  return visibleWidth(text) <= width ? text : truncateToWidth(text, width, '…');
}

export function fitPath(path: string, width: number): string {
  if (visibleWidth(path) <= width) return path;
  const parts = path.split('/');
  const base = parts.pop() ?? '';
  let fitted = `…/${base}`;
  if (visibleWidth(fitted) > width) return fitPlain(base, width);
  let prefix = '';
  for (const part of parts) {
    const next = `${prefix}${part}/`;
    if (visibleWidth(next + fitted) > width) break;
    prefix = next;
  }
  fitted = prefix + fitted;
  return fitted;
}
