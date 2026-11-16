import { CustomEditor, type KeybindingsManager, type Theme } from '@earendil-works/pi-coding-agent';
import { type EditorTheme, type TUI, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { gutterAt } from './text.ts';

type Indicator = NonNullable<Parameters<CustomEditor['setWorkingStatusIndicator']>[0]>;
export type EditorStatus = { readonly kind: 'ready' } | { readonly kind: 'working' } | { readonly kind: 'pi'; readonly indicator: Indicator };
const READY: EditorStatus = { kind: 'ready' };
const WORKING: EditorStatus = { kind: 'working' };
export const PROMPT_INSET = 3;

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

export class RuleEditor extends CustomEditor {
  private snoopStatus: EditorStatus = READY;
  private topRule: RuleCache | undefined;
  private bottomRule: RuleCache | undefined;
  private prompt: { theme: Theme; text: string } | undefined;
  private readonly snoopTheme: () => Theme;
  private readonly gutter: number;
  constructor(tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager, theme: () => Theme, gutter: number) {
    super(tui, editorTheme, keybindings, { embedWorkingStatus: true, paddingX: gutter + PROMPT_INSET });
    this.snoopTheme = theme;
    this.gutter = gutter;
  }
  override setPaddingX(_padding: number): void {
    super.setPaddingX(this.gutter + PROMPT_INSET);
  }
  override setWorkingStatusIndicator(indicator: Indicator | undefined): void {
    this.snoopStatus = editorStatus(indicator);
    super.setWorkingStatusIndicator(indicator);
  }
  protected override renderTopBorder(width: number, hidden: number): string {
    const theme = this.snoopTheme();
    const status = this.snoopStatus;
    const piLabel = status.kind === 'pi' ? status.indicator.renderInBorder(Math.max(1, width - 5)) : '';
    const cached = this.topRule;
    if (cached && cached.width === width && cached.hidden === hidden && cached.border === this.borderColor && cached.theme === theme && cached.status === status && cached.piLabel === piLabel) return cached.line;
    const left = hidden > 0 ? `${theme.fg('dim', `↑ ${hidden}`)} ` : '';
    const line = this.rule(width, left, ` ${statusLabel(status, theme, piLabel)}`);
    this.topRule = { width, hidden, border: this.borderColor, theme, status, piLabel, line };
    return line;
  }
  protected override renderBottomBorder(width: number, hidden: number): string {
    const theme = this.snoopTheme();
    const cached = this.bottomRule;
    if (cached && cached.width === width && cached.hidden === hidden && cached.border === this.borderColor && cached.theme === theme) return cached.line;
    const line = this.rule(width, '', hidden > 0 ? ` ${theme.fg('dim', `↓ ${hidden}`)}` : '');
    this.bottomRule = { width, hidden, border: this.borderColor, theme, status: undefined, piLabel: '', line };
    return line;
  }
  private rule(width: number, left: string, right: string): string {
    const g = gutterAt(this.gutter, width);
    const inner = width - 2 * g;
    const labels = visibleWidth(left) + visibleWidth(right);
    const [start, end, fill] = labels < inner ? [left, right, inner - labels] : ['', '', inner];
    const line = ' '.repeat(g) + start + this.borderColor('─'.repeat(Math.max(0, fill))) + end + ' '.repeat(g);
    return visibleWidth(line) <= width ? line : truncateToWidth(line, width, '');
  }
  override render(width: number): string[] {
    const lines = super.render(width);
    const inset = this.gutter + PROMPT_INSET;
    const first = lines[1];
    if (first === undefined || gutterAt(inset, width) < inset) return lines;
    const theme = this.snoopTheme();
    if (this.prompt?.theme !== theme) this.prompt = { theme, text: `${' '.repeat(this.gutter)}${theme.fg('accent', '›')}${' '.repeat(PROMPT_INSET - 1)}` };
    lines[1] = this.prompt.text + first.slice(inset);
    return lines;
  }
  override invalidate(): void {
    super.invalidate();
    this.topRule = undefined;
    this.bottomRule = undefined;
    this.prompt = undefined;
  }
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
