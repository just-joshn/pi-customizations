import type { Theme } from '@earendil-works/pi-coding-agent';
import { type Component, truncateToWidth } from '@earendil-works/pi-tui';
import { cell } from '../cell.ts';
import { fitPlain, sanitizeLine } from '../text.ts';
import type { Preview } from './specs.ts';
import { layoutHeader, ROW_INSET, type RowView } from './view.ts';

interface LinesCache {
  readonly width: number;
  readonly view: RowView;
  readonly lines: string[];
}
const MARKERS = {
  pending: ['dim', '·'],
  running: ['accent', '•'],
  done: ['success', '✓'],
  failed: ['error', '✗'],
} as const;

export function createRowHeader(view: () => RowView, theme: Theme): Component {
  const cache = cell<LinesCache | undefined>(undefined);
  return {
    render(width) {
      const current = view();
      const cached = cache.read();
      if (cached?.width === width && cached.view === current) return cached.lines;
      const pad = Math.min(current.pad, Math.max(0, width - 1));
      const layout = layoutHeader(current, width - 2 * pad);
      const [color, marker] = MARKERS[current.phase];
      const line =
        ' '.repeat(pad) +
        theme.fg(color, marker) +
        '  ' +
        theme.fg(current.phase === 'pending' ? 'dim' : 'toolTitle', layout.verb) +
        theme.fg(current.phase === 'pending' ? 'dim' : 'text', layout.target) +
        ' '.repeat(layout.gap) +
        theme.fg('dim', layout.meta);
      const lines = [width < pad + ROW_INSET ? truncateToWidth(line, width, '') : line];
      cache.write({ width, view: current, lines });
      return lines;
    },
    invalidate() {
      cache.write(undefined);
    },
  };
}

function previewLines(theme: Theme, preview: Preview, hint: string | undefined, indent: number, width: number): string[] {
  const line = (text: string, tone: 'error' | 'toolOutput' | 'dim'): string => ' '.repeat(indent) + theme.fg(tone, fitPlain(sanitizeLine(text), width - indent));
  const lines = preview.lines.map((text) => line(text, preview.tone === 'error' ? 'error' : 'toolOutput'));
  if (!hint) return lines;
  switch (preview.from) {
    case 'head':
      return [...lines, line(`… ${preview.hidden} more · ${hint}`, 'dim')];
    case 'tail':
      return [line(`… ${preview.hidden} earlier · ${hint}`, 'dim'), ...lines];
    default: {
      const unreachable: never = preview.from;
      return unreachable;
    }
  }
}

export function createRowBody(view: () => RowView, theme: Theme, invalidatePanel: () => void): Component {
  const cache = cell<LinesCache | undefined>(undefined);
  return {
    render(width) {
      const current = view();
      const body = current.body;
      if (body.kind === 'none') return [];
      if (body.kind === 'panel') return body.panel.render(width);
      const cached = cache.read();
      if (cached?.width === width && cached.view === current) return cached.lines;
      const indent = Math.min(current.pad + ROW_INSET, Math.max(0, width - 1));
      const lines = previewLines(theme, body.preview, body.hint, indent, width);
      cache.write({ width, view: current, lines });
      return lines;
    },
    invalidate() {
      cache.write(undefined);
      invalidatePanel();
    },
  };
}
