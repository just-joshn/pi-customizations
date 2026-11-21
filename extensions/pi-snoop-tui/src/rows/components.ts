import type { Theme } from '@earendil-works/pi-coding-agent';
import { type Component, truncateToWidth } from '@earendil-works/pi-tui';
import { memoLast } from '../memo.ts';
import { fitPlain, sanitizeLine } from '../text.ts';
import { layoutHeader, type Preview, ROW_INSET, type RowView } from './view.ts';

const MARKERS = {
  pending: ['dim', '·'],
  running: ['accent', '•'],
  done: ['success', '✓'],
  failed: ['error', '✗'],
} as const;

function headerLines(width: number, current: RowView, theme: Theme): string[] {
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
  return [width < pad + ROW_INSET ? truncateToWidth(line, width, '') : line];
}

export function createRowHeader(view: () => RowView, theme: () => Theme): Component {
  const lines = memoLast(headerLines);
  return {
    render: (width) => lines.get(width, view(), theme()),
    invalidate: lines.reset,
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

export function createRowBody(view: () => RowView, theme: () => Theme): Component {
  const lines = memoLast((width: number, pad: number, preview: Preview, hint: string | undefined, current: Theme) => previewLines(current, preview, hint, Math.min(pad + ROW_INSET, Math.max(0, width - 1)), width));
  return {
    render(width) {
      const { body, pad } = view();
      if (body.kind === 'none') return [];
      if (body.kind === 'panel') return body.panel.render(width);
      return lines.get(width, pad, body.preview, body.hint, theme());
    },
    invalidate() {
      lines.reset();
      const { body } = view();
      if (body.kind === 'panel') body.panel.invalidate();
    },
  };
}
