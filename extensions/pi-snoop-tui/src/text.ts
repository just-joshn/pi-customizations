import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { replaceControlCharacters, stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

const PATH_SEPARATOR = '/';

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
  let lines: readonly string[] = [];
  let start = 0;
  while (start < text.length && lines.length < max) {
    const end = text.indexOf('\n', start);
    lines = [...lines, text.slice(start, end === -1 ? text.length : end).replace(/\r$/, '')];
    start = end === -1 ? text.length : end + 1;
  }
  return { lines, hidden: countLines(text) - lines.length };
}

export function tailLines(text: string, max: number): LineSlice {
  let lines: readonly string[] = [];
  let end = text.endsWith('\n') ? text.length - 1 : text.length;
  while (end > 0 && lines.length < max) {
    const start = text.lastIndexOf('\n', end - 1);
    lines = [...lines, text.slice(start + 1, end).replace(/\r$/, '')];
    end = start;
  }
  if (end === 0 && lines.length < max && text.startsWith('\n')) lines = [...lines, ''];
  return { lines: lines.toReversed(), hidden: countLines(text) - lines.length };
}

export function sanitizeLine(line: string): string {
  return replaceControlCharacters(stripTerminalSequences(line.replace(/\t/g, '  ').replace(/[\r\n]/g, ' ')));
}

export function gutterOf(pi: Pick<ExtensionAPI, 'getSettings'>): number {
  return pi.getSettings().outputPad ?? 1;
}

export function gutterAt(gutter: number, width: number): number {
  return Math.min(gutter, Math.max(0, Math.floor((width - 1) / 2)));
}

export function fitPlain(text: string, width: number): string {
  if (width <= 0) return '';
  return visibleWidth(text) <= width ? text : truncateToWidth(text, width, '…');
}

export function fitPath(path: string, width: number): string {
  if (visibleWidth(path) <= width) return path;
  const parts = path.split(PATH_SEPARATOR);
  const base = parts.at(-1) ?? '';
  const fallback = `…/${base}`;
  if (visibleWidth(fallback) > width) return fitPlain(base, width);
  let prefix = '';
  for (const part of parts.slice(0, -1)) {
    const next = `${prefix}${part}/`;
    if (visibleWidth(next + fallback) > width) break;
    prefix = next;
  }
  return prefix + fallback;
}
