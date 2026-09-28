/**
 * Custom editor: a `CustomEditor` subclass that swaps the empty-content line
 * for a dim placeholder and appends an `esc to stop` hint while the agent is
 * running.
 *
 * The border color follows the reference recording: success green while idle
 * and `borderAccent` while running. Pi's own `borderColor` wins in bash mode,
 * where Pi sets it from the `!` prefix, so a bash command keeps Pi's color.
 * The base class owns everything else. This class never overrides
 * `handleInput` and never overrides `renderTopBorder`. The placeholder line
 * keeps `CURSOR_MARKER` so Pi can still place the hardware reference.
 */

import type { ExtensionContext, KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent';
import { CustomEditor } from '@earendil-works/pi-coding-agent';
import type { EditorComponent, EditorTheme, TUI } from '@earendil-works/pi-tui';
import { CURSOR_MARKER, stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { padToWidth } from '../format/width.ts';
import type { PresentationStore } from '../state/presentation-store.ts';

const IDLE_PLACEHOLDER = '→ Ask, build, or change anything';
const RUNNING_PLACEHOLDER = '→ Add a follow-up';
const STOP_HINT = 'esc to stop';

export function createEditorFactory(ctx: ExtensionContext, store: PresentationStore): (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent {
  const appTheme = ctx.ui.theme;
  return (tui, theme, keybindings) => new SkinStyleEditor(tui, theme, keybindings, store, appTheme);
}

export class SkinStyleEditor extends CustomEditor {
  private readonly store: PresentationStore;
  private readonly appTheme: Theme;
  private readonly idleBorderColor: (text: string) => string;
  private readonly runningBorderColor: (text: string) => string;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, store: PresentationStore, appTheme: Theme) {
    super(tui, theme, keybindings, { embedWorkingStatus: true });
    this.store = store;
    this.appTheme = appTheme;
    this.idleBorderColor = (text) => this.appTheme.fg('success', text);
    this.runningBorderColor = (text) => this.appTheme.fg('borderAccent', text);
  }

  render(width: number): string[] {
    const snapshot = this.store.getSnapshot();
    const running = snapshot.phase.kind === 'running';
    if (!this.getText().trimStart().startsWith('!')) {
      this.borderColor = running ? this.runningBorderColor : this.idleBorderColor;
    }
    const lines = super.render(width);
    if (this.getText().length === 0 && lines.length >= 2) {
      lines[1] = this.placeholderLine(width, lines[1] ?? '', running);
    }
    return lines;
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    const base = super.renderBottomBorder(width, hiddenLineCount);
    if (this.store.getSnapshot().phase.kind !== 'running') return base;
    const label = this.appTheme.fg('dim', STOP_HINT);
    const budget = visibleWidth(label) + 1;
    if (width <= budget + 1) return base;
    const trimmed = truncateToWidth(base, width - budget, '');
    // Pi centers its own hidden-line label, so a rule tail means the cut took no
    // label. Anything else leaves Pi's border untouched and skips the hint.
    if (!stripTerminalSequences(trimmed).endsWith('─')) return base;
    const line = `${trimmed} ${label}`;
    return visibleWidth(line) <= width ? line : base;
  }

  private placeholderLine(width: number, original: string, running: boolean): string {
    const paddingX = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
    const contentWidth = Math.max(1, width - paddingX * 2);
    const marker = original.includes(CURSOR_MARKER) ? CURSOR_MARKER : '';
    const text = this.appTheme.fg('dim', running ? RUNNING_PLACEHOLDER : IDLE_PLACEHOLDER);
    return padToWidth(`${' '.repeat(paddingX)}${marker}${truncateToWidth(text, contentWidth, '')}`, width);
  }
}
