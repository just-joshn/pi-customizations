import type { Theme } from '@earendil-works/pi-coding-agent';
import { type Component, stripTerminalSequences, Text, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { cell } from '../cell.ts';
import { memoLast } from '../memo.ts';
import { type Panel, ROW_INSET, type Tone } from './view.ts';

interface PanelContent {
  readonly child: Component;
  readonly tone: Tone;
  readonly framed: boolean;
}
/** Everything a panel's lines depend on. The memo reuses them only while all of it is unchanged. */
type Layout = readonly [width: number, indent: number, boxWidth: number, theme: Theme, frame: Tone | undefined, source: readonly string[]];
const SOURCE = 5;
const BACKGROUNDS = { ok: 'toolPendingBg', error: 'toolErrorBg' } as const satisfies Record<Tone, string>;
const MIN_FRAMED_WIDTH = 3;

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a === b || (a.length === b.length && a.every((line, i) => line === b[i]));
}
function sameLayout(a: Layout, b: Layout): boolean {
  return a.every((value, i) => (i === SOURCE ? sameLines(a[SOURCE], b[SOURCE]) : Object.is(value, b[i])));
}
function isBlank(line: string): boolean {
  return stripTerminalSequences(line).trim() === '';
}
function trimBlankEdges(source: readonly string[]): readonly string[] {
  const start = source.findIndex((line) => !isBlank(line));
  return start === -1 ? [] : source.slice(start, source.findLastIndex((line) => !isBlank(line)) + 1);
}
function layoutLines(...[width, indent, boxWidth, theme, frame, source]: Layout): string[] {
  const prefix = ' '.repeat(indent);
  return trimBlankEdges(source).map((line) => {
    const framed = frame ? theme.bg(BACKGROUNDS[frame], ` ${line}${' '.repeat(Math.max(0, boxWidth - 1 - visibleWidth(line)))}`) : line;
    return boxWidth < MIN_FRAMED_WIDTH ? truncateToWidth(prefix + framed, width, '') : prefix + framed;
  });
}

export function createPanel(theme: () => Theme, pad: () => number): Panel {
  const background = (tone: Tone) => (text: string) => theme().bg(BACKGROUNDS[tone], text);
  const content = cell<PanelContent>({ child: new Text('', 0, 0), tone: 'ok', framed: false });
  const lines = memoLast(layoutLines, sameLayout);
  return {
    showChild(child, tone) {
      content.write({ child, tone, framed: true });
    },
    showText(text, tone) {
      content.write({ child: new Text(text, 1, 0, background(tone)), tone, framed: false });
    },
    render(width) {
      const { child, tone, framed } = content.read();
      const indent = Math.min(pad() + ROW_INSET, Math.max(0, width - 1));
      const boxWidth = Math.max(1, width - indent - pad());
      const source = child.render(framed ? Math.max(1, boxWidth - 2) : boxWidth);
      return lines.get(width, indent, boxWidth, theme(), framed ? tone : undefined, source);
    },
    invalidate() {
      lines.reset();
      content.read().child.invalidate();
    },
  };
}
