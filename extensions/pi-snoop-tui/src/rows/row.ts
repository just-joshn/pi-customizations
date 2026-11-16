import type { AgentToolResult, Theme, ToolRenderers, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import { Box, type Component, Text, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { fitPath, fitPlain, sanitizeLine } from '../text.ts';
import { type Preview, type ResultSummary, type TargetText, type ToolSpec, VERB_COLUMN } from './specs.ts';

type ToolRenderContext = Parameters<NonNullable<ToolRenderers['renderCall']>>[2];
export type RowPhase = 'pending' | 'running' | 'done' | 'failed';
type Tone = 'ok' | 'error';
export type BodyView = { readonly kind: 'none' } | { readonly kind: 'preview'; readonly preview: Preview; readonly hint: string | undefined } | { readonly kind: 'panel'; readonly panel: Component; readonly tone: Tone };
export interface RowView {
  readonly phase: RowPhase;
  readonly verb: string;
  readonly target: TargetText;
  readonly meta: string | undefined;
  readonly body: BodyView;
  readonly pad: number;
}
interface SummaryMemo {
  content: AgentToolResult<unknown>['content'];
  details: unknown;
  args: unknown;
  isPartial: boolean;
  isError: boolean;
  value: ResultSummary;
}
class RowState {
  view: RowView;
  summary: SummaryMemo | undefined;
  readonly native: Record<string, unknown> = {};
  nativeResult: Component | undefined;
  panel: Panel | undefined;
  readonly header: RowHeader;
  readonly body: RowBody;
  constructor(spec: ToolSpec, theme: Theme, ctx: ToolRenderContext) {
    this.view = Object.freeze<RowView>({ phase: derivePhase(ctx), verb: spec.verb, target: spec.target(parseArgs(ctx.args), ctx.cwd), meta: undefined, body: { kind: 'none' }, pad: ctx.outputPad });
    this.header = new RowHeader(this, theme);
    this.body = new RowBody(this, theme);
  }
}
function parseArgs(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
}
function rowState(ctx: ToolRenderContext, spec: ToolSpec, theme: Theme): RowState {
  if (!(ctx.state.snoop instanceof RowState)) ctx.state.snoop = new RowState(spec, theme, ctx);
  return ctx.state.snoop;
}

export function compactRenderers(spec: ToolSpec, native: ToolRenderers): ToolRenderers {
  return {
    renderShell: 'self',
    renderCall(args, theme, ctx) {
      const state = rowState(ctx, spec, theme);
      commit(state, { ...state.view, phase: derivePhase(ctx), target: spec.target(parseArgs(args), ctx.cwd), pad: ctx.outputPad });
      return state.header;
    },
    renderResult(result, options, theme, ctx) {
      const state = rowState(ctx, spec, theme);
      const summary = summarizeOnce(state, spec, result, options, ctx);
      let body: BodyView = { kind: 'none' };
      if (options.expanded) {
        const tone = ctx.isError ? 'error' : 'ok';
        state.panel ??= new Panel(theme, () => state.view.pad);
        if (native.renderResult) {
          // Native call renderers start timers and edit previews. Only delegate result detail.
          state.nativeResult = native.renderResult(result, options, theme, { ...ctx, state: state.native, lastComponent: state.nativeResult, outputPad: 0 });
          state.panel.set(state.nativeResult, tone);
        } else {
          state.panel.setText(plainDetail(theme, ctx.args, result), tone);
        }
        body = { kind: 'panel', panel: state.panel, tone };
      } else if (summary.preview) {
        body = { kind: 'preview', preview: summary.preview, hint: summary.preview.hidden > 0 ? ctx.keyText('app.tools.expand') : undefined };
      }
      commit(state, { ...state.view, phase: derivePhase(ctx), meta: summary.meta, body });
      return state.body;
    },
  };
}
function plainDetail(theme: Theme, args: unknown, result: AgentToolResult<unknown>): string {
  const output = result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .split('\n')
    .map(sanitizeLine)
    .join('\n');
  const json = sanitizeLine(JSON.stringify(args) ?? '');
  return [json && theme.fg('dim', json), output && theme.fg('toolOutput', output)].filter(Boolean).join('\n\n');
}
export function derivePhase(ctx: Pick<ToolRenderContext, 'executionStarted' | 'isPartial' | 'isError'>): RowPhase {
  if (!ctx.isPartial) return ctx.isError ? 'failed' : 'done';
  return ctx.executionStarted ? 'running' : 'pending';
}
export interface HeaderLayout {
  readonly verb: string;
  readonly target: string;
  readonly gap: number;
  readonly meta: string;
}
export function layoutHeader(view: Pick<RowView, 'verb' | 'target' | 'meta'>, width: number): HeaderLayout {
  const available = Math.max(0, width - 3);
  const verb = fitPlain(`${view.verb.padEnd(VERB_COLUMN)}  `, available);
  const rest = available - visibleWidth(verb);
  const metaText = sanitizeLine(view.meta ?? '');
  const meta = visibleWidth(metaText) + 10 <= rest ? metaText : '';
  const target = (view.target.kind === 'path' ? fitPath : fitPlain)(sanitizeLine(view.target.text), rest - (meta ? visibleWidth(meta) + 2 : 0));
  return { verb, target, meta, gap: meta ? rest - visibleWidth(target) - visibleWidth(meta) : 0 };
}
function sameBody(a: BodyView, b: BodyView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'none' && b.kind === 'none') return true;
  if (a.kind === 'preview' && b.kind === 'preview') return a.preview === b.preview && a.hint === b.hint;
  return a.kind === 'panel' && b.kind === 'panel' && a.panel === b.panel && a.tone === b.tone;
}
function commit(state: RowState, next: RowView): void {
  const prev = state.view;
  if (prev.phase === next.phase && prev.verb === next.verb && prev.pad === next.pad && prev.target.text === next.target.text && prev.target.kind === next.target.kind && prev.meta === next.meta && sameBody(prev.body, next.body)) return;
  if (prev.pad !== next.pad) state.panel?.invalidate();
  state.view = Object.freeze(next);
}
function summarizeOnce(state: RowState, spec: ToolSpec, result: AgentToolResult<unknown>, options: ToolRenderResultOptions, ctx: ToolRenderContext): ResultSummary {
  const memo = state.summary;
  if (memo && memo.content === result.content && memo.details === result.details && memo.args === ctx.args && memo.isPartial === options.isPartial && memo.isError === ctx.isError) return memo.value;
  const text = result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  const images = result.content.filter((c) => c.type === 'image').length;
  const value = spec.summarize({ args: parseArgs(ctx.args), text, images, details: result.details, isError: ctx.isError, isPartial: options.isPartial });
  state.summary = { content: result.content, details: result.details, args: ctx.args, isPartial: options.isPartial, isError: ctx.isError, value };
  return value;
}
const MARKERS = {
  pending: ['dim', '·'],
  running: ['accent', '•'],
  done: ['success', '✓'],
  failed: ['error', '✗'],
} as const;
class RowHeader implements Component {
  private cache: { width: number; view: RowView; lines: string[] } | undefined;
  private readonly state: RowState;
  private readonly theme: Theme;
  constructor(state: RowState, theme: Theme) {
    this.state = state;
    this.theme = theme;
  }
  render(width: number): string[] {
    const view = this.state.view;
    if (this.cache?.width === width && this.cache.view === view) return this.cache.lines;
    const pad = Math.min(view.pad, Math.max(0, width - 1));
    const layout = layoutHeader(view, width - 2 * pad);
    const [color, marker] = MARKERS[view.phase];
    const line =
      ' '.repeat(pad) +
      this.theme.fg(color, marker) +
      '  ' +
      this.theme.fg(view.phase === 'pending' ? 'dim' : 'toolTitle', layout.verb) +
      this.theme.fg(view.phase === 'pending' ? 'dim' : 'text', layout.target) +
      ' '.repeat(layout.gap) +
      this.theme.fg('dim', layout.meta);
    const lines = [width < pad + 3 ? truncateToWidth(line, width, '') : line];
    this.cache = { width, view, lines };
    return lines;
  }
  invalidate(): void {
    this.cache = undefined;
  }
}
class RowBody implements Component {
  private cache: { width: number; view: RowView; lines: string[] } | undefined;
  private readonly state: RowState;
  private readonly theme: Theme;
  constructor(state: RowState, theme: Theme) {
    this.state = state;
    this.theme = theme;
  }
  render(width: number): string[] {
    const view = this.state.view;
    const body = view.body;
    switch (body.kind) {
      case 'none':
        return [];
      case 'panel':
        return body.panel.render(width);
      case 'preview': {
        if (this.cache?.width === width && this.cache.view === view) return this.cache.lines;
        const indent = Math.min(view.pad + 3, Math.max(0, width - 1));
        const line = (text: string, tone: 'error' | 'toolOutput' | 'dim') => ' '.repeat(indent) + this.theme.fg(tone, fitPlain(sanitizeLine(text), width - indent));
        const lines = body.preview.lines.map((text) => line(text, body.preview.tone === 'error' ? 'error' : 'toolOutput'));
        if (body.hint) {
          const from = body.preview.from;
          switch (from) {
            case 'head':
              lines.push(line(`… ${body.preview.hidden} more · ${body.hint}`, 'dim'));
              break;
            case 'tail':
              lines.unshift(line(`… ${body.preview.hidden} earlier · ${body.hint}`, 'dim'));
              break;
            default: {
              const unreachable: never = from;
              return unreachable;
            }
          }
        }
        this.cache = { width, view, lines };
        return lines;
      }
      default: {
        const unreachable: never = body;
        return unreachable;
      }
    }
  }
  invalidate(): void {
    this.cache = undefined;
    this.state.panel?.invalidate();
  }
}
class Panel implements Component {
  private cache: { width: number; source: readonly string[]; lines: string[] } | undefined;
  private readonly box = new Box(1, 0);
  private child: Component = this.box;
  private readonly theme: Theme;
  private readonly pad: () => number;
  constructor(theme: Theme, pad: () => number) {
    this.theme = theme;
    this.pad = pad;
  }
  set(child: Component, tone: Tone): void {
    this.box.clear();
    this.box.addChild(child);
    this.box.setBgFn(this.background(tone));
    this.child = this.box;
  }
  setText(text: string, tone: Tone): void {
    this.child = new Text(text, 1, 0, this.background(tone));
  }
  private background(tone: Tone): (text: string) => string {
    return (text) => this.theme.bg(tone === 'error' ? 'toolErrorBg' : 'toolPendingBg', text);
  }
  render(width: number): string[] {
    const indent = Math.min(this.pad() + 3, Math.max(0, width - 1));
    const boxWidth = Math.max(1, width - indent - this.pad());
    const source = this.child.render(boxWidth);
    if (this.cache?.width === width && this.cache.source === source) return this.cache.lines;
    const prefix = ' '.repeat(indent);
    let start = 0;
    let end = source.length;
    while (start < end && isBlank(source[start])) start++;
    while (end > start && isBlank(source[end - 1])) end--;
    const lines = source.slice(start, end).map((line) => (boxWidth < 3 ? truncateToWidth(prefix + line, width, '') : prefix + line));
    this.cache = { width, source, lines };
    return lines;
  }
  invalidate(): void {
    this.cache = undefined;
    this.child.invalidate();
  }
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: a blank panel line holds only spaces and SGR color codes
const BLANK_LINE = /^(?:\s|\x1b\[[0-9;:]*m)*$/;
function isBlank(line: string | undefined): boolean {
  return BLANK_LINE.test(line ?? '');
}
