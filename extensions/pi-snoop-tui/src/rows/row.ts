import type { AgentToolResult, Theme, ToolRenderers, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import { Box, type Component, Text, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { fitPath, fitPlain, sanitizeLine } from '../text.ts';
import { type Preview, type ResultSummary, type TargetText, type ToolSpec, VERB_COLUMN } from './specs.ts';

type ToolRenderContext = Parameters<NonNullable<ToolRenderers['renderCall']>>[2];
export type RowPhase = 'pending' | 'running' | 'done' | 'failed';
export type BodyView = { readonly kind: 'none' } | { readonly kind: 'preview'; readonly preview: Preview; readonly hint: string | undefined } | { readonly kind: 'native'; readonly panel: Component; readonly tone: 'ok' | 'error' };
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
        // Native call renderers start timers and edit previews. Only delegate result detail.
        state.nativeResult =
          native.renderResult?.(result, options, theme, { ...ctx, state: state.native, lastComponent: state.nativeResult, outputPad: 0 }) ??
          new Text(
            result.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n'),
            0,
            0,
          );
        const tone = ctx.isError ? 'error' : 'ok';
        state.panel ??= new Panel(theme, () => state.view.pad);
        state.panel.set(state.nativeResult, tone);
        body = { kind: 'native', panel: state.panel, tone };
      } else if (summary.preview) {
        body = { kind: 'preview', preview: summary.preview, hint: summary.preview.hidden > 0 ? ctx.keyText('app.tools.expand') : undefined };
      }
      commit(state, { ...state.view, phase: derivePhase(ctx), meta: summary.meta, body });
      return state.body;
    },
  };
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
  const verb = fitPlain(view.verb.padEnd(VERB_COLUMN + 2), available);
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
  return a.kind === 'native' && b.kind === 'native' && a.panel === b.panel && a.tone === b.tone;
}
function commit(state: RowState, next: RowView): void {
  const prev = state.view;
  if (prev.phase === next.phase && prev.verb === next.verb && prev.pad === next.pad && prev.target.text === next.target.text && prev.target.kind === next.target.kind && prev.meta === next.meta && sameBody(prev.body, next.body)) return;
  state.view = Object.freeze(next);
}
function summarizeOnce(state: RowState, spec: ToolSpec, result: AgentToolResult<unknown>, options: ToolRenderResultOptions, ctx: ToolRenderContext): ResultSummary {
  const memo = state.summary;
  if (memo && memo.content === result.content && memo.details === result.details && memo.args === ctx.args && memo.isPartial === options.isPartial && memo.isError === ctx.isError) return memo.value;
  const text = result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  const value = spec.summarize({ args: parseArgs(ctx.args), text, details: result.details, isError: ctx.isError, isPartial: options.isPartial });
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
    const layout = layoutHeader(view, width - pad);
    const [color, marker] = MARKERS[view.phase];
    const line =
      ' '.repeat(pad) +
      this.theme.fg(color, marker) +
      '  ' +
      this.theme.fg(view.phase === 'pending' ? 'dim' : 'toolTitle', layout.verb) +
      this.theme.fg(view.phase === 'pending' ? 'dim' : 'text', layout.target) +
      ' '.repeat(layout.gap) +
      this.theme.fg('dim', layout.meta);
    const lines = [truncateToWidth(line, width, '')];
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
      case 'native':
        return body.panel.render(width);
      case 'preview': {
        if (this.cache?.width === width && this.cache.view === view) return this.cache.lines;
        const indent = Math.min(view.pad + 3, Math.max(0, width - 1));
        const line = (text: string, tone: 'error' | 'toolOutput' | 'dim') => ' '.repeat(indent) + this.theme.fg(tone, fitPlain(sanitizeLine(text), width - indent));
        const lines = body.preview.lines.map((text) => line(text, body.preview.tone === 'error' ? 'error' : 'toolOutput'));
        if (body.hint) lines.push(line(`… ${body.preview.hidden} more · ${body.hint}`, 'dim'));
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
  private readonly box = new Box(1, 0);
  private readonly theme: Theme;
  private readonly pad: () => number;
  constructor(theme: Theme, pad: () => number) {
    this.theme = theme;
    this.pad = pad;
  }
  set(child: Component, tone: 'ok' | 'error'): void {
    this.box.clear();
    this.box.addChild(child);
    this.box.setBgFn((text) => this.theme.bg(tone === 'error' ? 'toolErrorBg' : 'toolPendingBg', text));
  }
  render(width: number): string[] {
    const indent = Math.min(this.pad() + 3, Math.max(0, width - 1));
    return this.box.render(Math.max(1, width - indent - this.pad())).map((line) => truncateToWidth(' '.repeat(indent) + line, width, ''));
  }
  invalidate(): void {
    this.box.invalidate();
  }
}
