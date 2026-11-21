import { CustomEditor, type KeybindingsManager, type Theme } from '@earendil-works/pi-coding-agent';
import { type EditorTheme, type TUI, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { cell } from './cell.ts';
import { memoLast } from './memo.ts';
import { gutterAt } from './text.ts';

type Indicator = NonNullable<Parameters<CustomEditor['setWorkingStatusIndicator']>[0]>;
export type EditorStatus = { readonly kind: 'ready' } | { readonly kind: 'working' } | { readonly kind: 'pi'; readonly indicator: Indicator };
const READY: EditorStatus = { kind: 'ready' };
const WORKING: EditorStatus = { kind: 'working' };
export const PROMPT_INSET = 3;
const BORDER_LABEL_RESERVE = 5;

export function editorStatus(indicator: Indicator | undefined): EditorStatus {
  if (!indicator) return READY;
  return indicator.kind === 'working' ? WORKING : { kind: 'pi', indicator };
}

type Border = (text: string) => string;

interface EditorConfig {
  readonly theme: () => Theme;
  readonly gutter: number;
}

abstract class RuleEditor extends CustomEditor {
  protected abstract readonly config: EditorConfig;
  private readonly snoopStatus = cell<EditorStatus>(READY);
  private readonly topRule = memoLast((width: number, hidden: number, border: Border, theme: Theme, status: EditorStatus, piLabel: string) => {
    const left = hidden > 0 ? `${theme.fg('dim', `↑ ${hidden}`)} ` : '';
    return this.rule(width, left, ` ${statusLabel(status, theme, piLabel)}`, border);
  });
  private readonly bottomRule = memoLast((width: number, hidden: number, border: Border, theme: Theme) => this.rule(width, '', hidden > 0 ? ` ${theme.fg('dim', `↓ ${hidden}`)}` : '', border));
  private readonly prompt = memoLast((theme: Theme) => `${' '.repeat(this.config.gutter)}${theme.fg('accent', '›')}${' '.repeat(Math.max(0, PROMPT_INSET - 1))}`);
  override setPaddingX(_padding: number): void {
    super.setPaddingX(this.config.gutter + PROMPT_INSET);
  }
  override setWorkingStatusIndicator(indicator: Indicator | undefined): void {
    this.snoopStatus.write(editorStatus(indicator));
    super.setWorkingStatusIndicator(indicator);
  }
  protected override renderTopBorder(width: number, hidden: number): string {
    const theme = this.config.theme();
    const status = this.snoopStatus.read();
    const piLabel = status.kind === 'pi' ? status.indicator.renderInBorder(Math.max(1, width - BORDER_LABEL_RESERVE)) : '';
    return this.topRule.get(width, hidden, this.borderColor, theme, status, piLabel);
  }
  protected override renderBottomBorder(width: number, hidden: number): string {
    return this.bottomRule.get(width, hidden, this.borderColor, this.config.theme());
  }
  private rule(width: number, left: string, right: string, border: Border): string {
    const g = gutterAt(this.config.gutter, width);
    const inner = width - 2 * g;
    const labels = visibleWidth(left) + visibleWidth(right);
    const [start, end, fill] = labels < inner ? [left, right, inner - labels] : ['', '', inner];
    const line = ' '.repeat(g) + start + border('─'.repeat(Math.max(0, fill))) + end + ' '.repeat(g);
    return visibleWidth(line) <= width ? line : truncateToWidth(line, width, '');
  }
  override render(width: number): string[] {
    const lines = super.render(width);
    const inset = this.config.gutter + PROMPT_INSET;
    const first = lines[1];
    if (first === undefined || gutterAt(inset, width) < inset) return lines;
    return lines.with(1, this.prompt.get(this.config.theme()) + first.slice(inset));
  }
  override invalidate(): void {
    super.invalidate();
    this.topRule.reset();
    this.bottomRule.reset();
    this.prompt.reset();
  }
}

/** Builds a RuleEditor bound to `theme` and `gutter`. The config rides in a subclass field so no instance field is assigned. */
export function createRuleEditor(tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager, theme: () => Theme, gutter: number): CustomEditor {
  const config: EditorConfig = { theme, gutter };
  class ConfiguredEditor extends RuleEditor {
    protected override readonly config = config;
    constructor() {
      super(tui, editorTheme, keybindings, { embedWorkingStatus: true, paddingX: gutter + PROMPT_INSET });
    }
  }
  return new ConfiguredEditor();
}

function statusLabel(status: EditorStatus, theme: Theme, piLabel: string): string {
  switch (status.kind) {
    case 'ready':
      return theme.fg('muted', 'ready');
    case 'working':
      return `${theme.fg('accent', '●')} ${theme.fg('muted', 'working')}`;
    case 'pi':
      return piLabel;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
