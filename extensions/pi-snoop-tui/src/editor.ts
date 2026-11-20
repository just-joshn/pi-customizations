import { CustomEditor, type KeybindingsManager, type Theme } from '@earendil-works/pi-coding-agent';
import { type EditorTheme, type TUI, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { cell } from './cell.ts';
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

interface RuleCache {
  readonly width: number;
  readonly hidden: number;
  readonly border: (text: string) => string;
  readonly theme: Theme;
  readonly status: EditorStatus | undefined;
  readonly piLabel: string;
  readonly line: string;
}

interface EditorConfig {
  readonly theme: () => Theme;
  readonly gutter: number;
}

abstract class RuleEditor extends CustomEditor {
  protected abstract readonly config: EditorConfig;
  private readonly snoopStatus = cell<EditorStatus>(READY);
  private readonly topRule = cell<RuleCache | undefined>(undefined);
  private readonly bottomRule = cell<RuleCache | undefined>(undefined);
  private readonly prompt = cell<{ theme: Theme; text: string } | undefined>(undefined);
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
    const cached = this.topRule.read();
    if (cached && cached.width === width && cached.hidden === hidden && cached.border === this.borderColor && cached.theme === theme && cached.status === status && cached.piLabel === piLabel) return cached.line;
    const left = hidden > 0 ? `${theme.fg('dim', `↑ ${hidden}`)} ` : '';
    const line = this.rule(width, left, ` ${statusLabel(status, theme, piLabel)}`);
    this.topRule.write({ width, hidden, border: this.borderColor, theme, status, piLabel, line });
    return line;
  }
  protected override renderBottomBorder(width: number, hidden: number): string {
    const theme = this.config.theme();
    const cached = this.bottomRule.read();
    if (cached && cached.width === width && cached.hidden === hidden && cached.border === this.borderColor && cached.theme === theme) return cached.line;
    const line = this.rule(width, '', hidden > 0 ? ` ${theme.fg('dim', `↓ ${hidden}`)}` : '');
    this.bottomRule.write({ width, hidden, border: this.borderColor, theme, status: undefined, piLabel: '', line });
    return line;
  }
  private rule(width: number, left: string, right: string): string {
    const g = gutterAt(this.config.gutter, width);
    const inner = width - 2 * g;
    const labels = visibleWidth(left) + visibleWidth(right);
    const [start, end, fill] = labels < inner ? [left, right, inner - labels] : ['', '', inner];
    const line = ' '.repeat(g) + start + this.borderColor('─'.repeat(Math.max(0, fill))) + end + ' '.repeat(g);
    return visibleWidth(line) <= width ? line : truncateToWidth(line, width, '');
  }
  override render(width: number): string[] {
    const lines = super.render(width);
    const inset = this.config.gutter + PROMPT_INSET;
    const first = lines[1];
    if (first === undefined || gutterAt(inset, width) < inset) return lines;
    return lines.with(1, this.promptText(this.config.theme()) + first.slice(inset));
  }
  private promptText(theme: Theme): string {
    const cached = this.prompt.read();
    if (cached?.theme === theme) return cached.text;
    const text = `${' '.repeat(this.config.gutter)}${theme.fg('accent', '›')}${' '.repeat(PROMPT_INSET - 1)}`;
    this.prompt.write({ theme, text });
    return text;
  }
  override invalidate(): void {
    super.invalidate();
    this.topRule.write(undefined);
    this.bottomRule.write(undefined);
    this.prompt.write(undefined);
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
