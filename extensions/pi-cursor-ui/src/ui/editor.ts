/**
 * Custom editor: the installed Cursor Agent CLI's prompt bar, drawn on Pi's
 * editor.
 *
 * The reference draws a filled band, not a box. A row of `▄` sits above the
 * input and a row of `▀` below, spanning `columns - 2` with one column of margin
 * each side, and there are no side bars. Pi themes a foreground role but exposes
 * no composer surface background, so the two bands carry the fill and the input
 * row stays on the terminal background.
 *
 * A dim `→` and a space precede the input text, putting the text at column 2.
 * Pi's mouse and cursor arithmetic subtract `paddingX` from the column, so the
 * padding is 2 and the glyph lives in the padding rather than outside it.
 */

import type { ExtensionContext, KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent';
import { CustomEditor } from '@earendil-works/pi-coding-agent';
import type { EditorComponent, EditorTheme, TUI } from '@earendil-works/pi-tui';
import { CURSOR_MARKER, truncateToWidth } from '@earendil-works/pi-tui';
import { fitLeftRight, padToWidth } from '../format/width.ts';
import type { PresentationStore } from '../state/presentation-store.ts';

const IDLE_PLACEHOLDER = 'Plan, search, build anything';
const RUNNING_PLACEHOLDER = 'Add a follow-up';
const STOP_HINT = 'esc to stop';

/** Columns taken before the input text, so Pi's column arithmetic matches the text. */
const PADDING_X = 2;
const MARGIN = 1;
const TOP_BLOCK = '▄';
const BOTTOM_BLOCK = '▀';
const MIN_BAR_WIDTH = PADDING_X + MARGIN + 2;

export function createEditorFactory(ctx: ExtensionContext, store: PresentationStore): (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent {
  const appTheme = ctx.ui.theme;
  return (tui, theme, keybindings) => new CursorStyleEditor(tui, theme, keybindings, store, appTheme);
}

export class CursorStyleEditor extends CustomEditor {
  private readonly store: PresentationStore;
  private readonly appTheme: Theme;
  /** True only while `render` is running, so the two rule rows can recognise themselves. */
  private drawingBar = false;
  private hintInRow = false;
  private topBarLine: string | undefined;
  private bottomBarLine: string | undefined;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, store: PresentationStore, appTheme: Theme) {
    super(tui, theme, keybindings, { embedWorkingStatus: true, paddingX: PADDING_X });
    this.store = store;
    this.appTheme = appTheme;
    // Pi paints both band rows through this, so the fill needs no second path.
    this.borderColor = (text) => this.appTheme.fg('borderMuted', text);
  }

  /**
   * Pi re-applies the `editorPaddingX` setting to whichever editor is mounted,
   * which would overwrite the column the glyph needs. The setting is kept as
   * extra indent on top of it, so Pi's column arithmetic still matches where the
   * text actually starts.
   */
  override setPaddingX(padding: number): void {
    super.setPaddingX(PADDING_X + (Number.isFinite(padding) ? Math.max(0, Math.floor(padding)) : 0));
  }

  render(width: number): string[] {
    const text = this.getText();
    const running = this.store.getSnapshot().phase.kind === 'running';
    // Pi repaints this in the bash accent once the text starts with `!`, and
    // that accent is what the reference gives its own prefix. Every other state
    // restores the fill, because Pi may have set the accent on an earlier render.
    if (!text.trimStart().startsWith('!')) {
      this.borderColor = (line) => this.appTheme.fg('borderMuted', line);
    }

    if (width < MIN_BAR_WIDTH) return super.render(width);

    this.drawingBar = true;
    // The reference shows its right placeholder only while the input is empty.
    this.hintInRow = running && text.length === 0;
    this.topBarLine = undefined;
    this.bottomBarLine = undefined;
    const lines = super.render(width);
    const topIndex = this.topBarLine === undefined ? -1 : lines.indexOf(this.topBarLine);
    const bottomIndex = this.bottomBarLine === undefined ? -1 : lines.lastIndexOf(this.bottomBarLine);
    this.drawingBar = false;

    if (lines.length >= 2 && text.length === 0) {
      lines[1] = this.promptRow(width, lines[1] ?? '', running);
    }
    for (let index = 0; index < lines.length; index += 1) {
      if (index === topIndex || index === bottomIndex) continue;
      lines[index] = this.rightMargin(width, lines[index] ?? '');
    }
    return lines;
  }

  /** A band row. Pi hands over a rule, so the rule glyphs become half blocks in place. */
  protected renderTopBorder(width: number, hiddenLineCount: number): string {
    if (!this.drawingBar) return super.renderTopBorder(width, hiddenLineCount);
    this.topBarLine = this.band(super.renderTopBorder(this.bandWidth(width), hiddenLineCount), TOP_BLOCK, width);
    return this.topBarLine;
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    if (!this.drawingBar) return super.renderBottomBorder(width, hiddenLineCount);
    this.bottomBarLine = this.band(super.renderBottomBorder(this.bandWidth(width), hiddenLineCount), BOTTOM_BLOCK, width);
    return this.bottomBarLine;
  }

  private bandWidth(width: number): number {
    return Math.max(0, width - MARGIN * 2);
  }

  private band(rule: string, glyph: string, width: number): string {
    const available = this.bandWidth(width);
    const body = truncateToWidth(rule.replaceAll('─', glyph), available, '');
    return padToWidth(`${' '.repeat(MARGIN)}${body}${' '.repeat(MARGIN)}`, Math.max(0, width));
  }

  /**
   * Build the empty-input row: the dim `→` glyph, then the placeholder, with the
   * stop hint flush right. Pi's content rows carry `paddingX` leading spaces, so
   * this one does too and the cursor marker lands on the real text column.
   */
  private promptRow(width: number, original: string, running: boolean): string {
    const marker = original.includes(CURSOR_MARKER) ? CURSOR_MARKER : '';
    const text = this.appTheme.fg('dim', running ? RUNNING_PLACEHOLDER : IDLE_PLACEHOLDER);
    const hint = this.hintInRow ? this.appTheme.fg('dim', STOP_HINT) : '';
    const budget = Math.max(0, width - PADDING_X - MARGIN * 2 - 2);
    return `${' '.repeat(PADDING_X)}${this.appTheme.fg('dim', '→')} ${marker}${fitLeftRight(text, hint, budget)}`;
  }

  /** The reference leaves one column of margin on each side of the band. */
  private rightMargin(width: number, line: string): string {
    return padToWidth(truncateToWidth(line, Math.max(0, width - MARGIN), ''), width);
  }
}
