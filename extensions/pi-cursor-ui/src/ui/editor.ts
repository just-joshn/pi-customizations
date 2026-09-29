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
 * The reference puts a dim `→` at column 2 and the input text at column 4, and
 * keeps both while the user types. Pi positions the text at its `paddingX` and
 * subtracts the same value for mouse hits and the hardware cursor, so the glyph
 * lives inside that padding: `PADDING_X` is 4 and the leading padding of the
 * first input row is repainted as `  → `. Narrow terminals make Pi clamp the
 * padding, and the prefix shrinks with it, so the text column always equals
 * whatever Pi will subtract.
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
const PROMPT_GLYPH = '→';

/** Columns taken before the input text, so Pi's column arithmetic matches the text. */
const PADDING_X = 4;
/** Pi clamps the padding below this width, so a narrower pane falls back to Pi's own editor. */
const MIN_BAR_WIDTH = 5;
const MARGIN = 1;
const TOP_BLOCK = '▄';
const BOTTOM_BLOCK = '▀';

export function createEditorFactory(ctx: ExtensionContext, store: PresentationStore, syncWorkingIndicator: () => void): (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent {
  const appTheme = ctx.ui.theme;
  return (tui, theme, keybindings) => new CursorStyleEditor(tui, theme, keybindings, store, appTheme, syncWorkingIndicator);
}

export class CursorStyleEditor extends CustomEditor {
  private readonly store: PresentationStore;
  private readonly appTheme: Theme;
  private readonly syncWorkingIndicator: () => void;
  /** True only while `render` is running, so the two rule rows can recognise themselves. */
  private drawingBar = false;
  private hintInRow = false;
  private topBarLine: string | undefined;
  private bottomBarLine: string | undefined;
  /** Set by the top band, which Pi hands the number of input rows hidden above it. */
  private hiddenAbove = false;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, store: PresentationStore, appTheme: Theme, syncWorkingIndicator: () => void) {
    super(tui, theme, keybindings, { embedWorkingStatus: true, paddingX: PADDING_X });
    this.store = store;
    this.appTheme = appTheme;
    this.syncWorkingIndicator = syncWorkingIndicator;
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
    // The frames carry baked theme colors and Pi renders them verbatim, so this
    // editor, which paints the band they sit in, re-derives them before drawing.
    // Pi detaches this editor while a modal is open, then repaints it on close.
    this.syncWorkingIndicator();
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
    this.hiddenAbove = false;
    const lines = super.render(width);
    const topIndex = this.topBarLine === undefined ? -1 : lines.indexOf(this.topBarLine);
    const bottomIndex = this.bottomBarLine === undefined ? -1 : lines.lastIndexOf(this.bottomBarLine);
    this.drawingBar = false;

    const firstInput = topIndex === -1 ? -1 : topIndex + 1;
    for (let index = 0; index < lines.length; index += 1) {
      if (index === topIndex || index === bottomIndex) continue;
      if (index === firstInput && !this.hiddenAbove) {
        lines[index] = text.length === 0 ? this.promptRow(width, lines[index] ?? '', running) : this.decorateInputRow(width, lines[index] ?? '');
      }
      lines[index] = this.rightMargin(width, lines[index] ?? '');
    }
    return lines;
  }

  /** A band row. Pi hands over a rule, so the rule glyphs become half blocks in place. */
  protected renderTopBorder(width: number, hiddenLineCount: number): string {
    this.hiddenAbove = hiddenLineCount > 0;
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

  /** The padding Pi itself will use for this width, which is what its mouse and cursor maths subtract. */
  private effectivePaddingX(width: number): number {
    return Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
  }

  /**
   * Exactly `effectivePaddingX(width)` columns, with the glyph as close to the
   * reference's column 2 as the width allows.
   */
  private promptPrefix(width: number): string {
    const padding = this.effectivePaddingX(width);
    if (padding <= 0) return '';
    const glyph = this.appTheme.fg('dim', PROMPT_GLYPH);
    if (padding === 1) return glyph;
    if (padding === 2) return `${glyph} `;
    if (padding === 3) return ` ${glyph} `;
    return `  ${glyph}${' '.repeat(padding - 3)}`;
  }

  /** Repaint the leading padding of the first input row so the glyph replaces the indent. */
  private decorateInputRow(width: number, row: string): string {
    const padding = this.effectivePaddingX(width);
    if (padding <= 0) return row;
    const leading = ' '.repeat(padding);
    if (!row.startsWith(leading)) return row;
    return `${this.promptPrefix(width)}${row.slice(padding)}`;
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
    const budget = Math.max(0, width - this.effectivePaddingX(width) - MARGIN * 2);
    return `${this.promptPrefix(width)}${marker}${fitLeftRight(text, hint, budget)}`;
  }

  /** The reference leaves one column of margin on each side of the band. */
  private rightMargin(width: number, line: string): string {
    return padToWidth(truncateToWidth(line, Math.max(0, width - MARGIN), ''), width);
  }
}
