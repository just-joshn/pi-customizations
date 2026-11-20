import type { Theme } from '@earendil-works/pi-coding-agent';
import { type Component, stripTerminalSequences, Text, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { cell } from '../cell.ts';
import { ROW_INSET, type Tone } from './view.ts';

export interface Panel extends Component {
  showChild(child: Component, tone: Tone): void;
  showText(text: string, tone: Tone): void;
}
interface PanelContent {
  readonly child: Component;
  readonly frame: ((text: string) => string) | undefined;
}
interface PanelCache {
  readonly width: number;
  readonly source: readonly string[];
  readonly lines: string[];
}
const SGR_PARAMS = /^[\d;]*$/;
const MIN_FRAMED_WIDTH = 3;

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a === b || (a.length === b.length && a.every((line, i) => line === b[i]));
}
// Skips color codes in place. `stripTerminalSequences` copies every line, so it only settles other escapes.
function isBlank(line: string | undefined): boolean {
  const text = line ?? '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\x1b') {
      const end = text.indexOf('m', i);
      if (text[i + 1] !== '[' || end === -1 || !SGR_PARAMS.test(text.slice(i + 2, end))) return stripTerminalSequences(text).trim() === '';
      i = end;
    } else if (text[i]?.trim()) {
      return false;
    }
  }
  return true;
}
function trimBlankEdges(source: readonly string[]): readonly string[] {
  let start = 0;
  let end = source.length;
  while (start < end && isBlank(source[start])) start++;
  while (end > start && isBlank(source[end - 1])) end--;
  return source.slice(start, end);
}

export function createPanel(theme: Theme, pad: () => number): Panel {
  const backgrounds: Record<Tone, (text: string) => string> = { ok: (text) => theme.bg('toolPendingBg', text), error: (text) => theme.bg('toolErrorBg', text) };
  const content = cell<PanelContent>({ child: new Text('', 0, 0), frame: undefined });
  const cache = cell<PanelCache | undefined>(undefined);
  return {
    showChild(child, tone) {
      if (content.read().frame !== backgrounds[tone]) cache.write(undefined);
      content.write({ child, frame: backgrounds[tone] });
    },
    showText(text, tone) {
      content.write({ child: new Text(text, 1, 0, backgrounds[tone]), frame: undefined });
      cache.write(undefined);
    },
    render(width) {
      const { child, frame } = content.read();
      const indent = Math.min(pad() + ROW_INSET, Math.max(0, width - 1));
      const boxWidth = Math.max(1, width - indent - pad());
      const source = child.render(frame ? Math.max(1, boxWidth - 2) : boxWidth);
      const cached = cache.read();
      if (cached?.width === width && sameLines(cached.source, source)) return cached.lines;
      const prefix = ' '.repeat(indent);
      const lines = trimBlankEdges(source).map((line) => {
        const framed = frame ? frame(` ${line}${' '.repeat(Math.max(0, boxWidth - 1 - visibleWidth(line)))}`) : line;
        return boxWidth < MIN_FRAMED_WIDTH ? truncateToWidth(prefix + framed, width, '') : prefix + framed;
      });
      cache.write({ width, source, lines });
      return lines;
    },
    invalidate() {
      cache.write(undefined);
      content.read().child.invalidate();
    },
  };
}
