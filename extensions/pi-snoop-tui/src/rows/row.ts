import type { AgentToolResult, Theme, ToolRenderers, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { type Cell, cell } from '../cell.ts';
import { sanitizeLine } from '../text.ts';
import { createRowBody, createRowHeader } from './components.ts';
import { createPanel, type Panel } from './panel.ts';
import type { ResultSummary, ToolSpec } from './specs.ts';
import { type BodyView, derivePhase, type RowView, sameBody, type ToolRenderContext } from './view.ts';

const ROW_STATE = Symbol('snoop.rowState');
interface SummaryMemo {
  readonly content: AgentToolResult<unknown>['content'];
  readonly details: unknown;
  readonly args: unknown;
  readonly isPartial: boolean;
  readonly isError: boolean;
  readonly value: ResultSummary;
}
interface RowState {
  readonly [ROW_STATE]: true;
  readonly view: Cell<RowView>;
  readonly summary: Cell<SummaryMemo | undefined>;
  readonly native: Record<string, unknown>;
  readonly nativeResult: Cell<Component | undefined>;
  readonly panel: Cell<Panel | undefined>;
  readonly header: Component;
  readonly body: Component;
}

function parseArgs(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
}
function createRowState(spec: ToolSpec, theme: Theme, ctx: ToolRenderContext): RowState {
  const view = cell(Object.freeze<RowView>({ phase: derivePhase(ctx), verb: spec.verb, target: spec.target(parseArgs(ctx.args), ctx.cwd), meta: undefined, body: { kind: 'none' }, pad: ctx.outputPad }));
  const panel = cell<Panel | undefined>(undefined);
  return {
    [ROW_STATE]: true,
    view,
    summary: cell<SummaryMemo | undefined>(undefined),
    native: {},
    nativeResult: cell<Component | undefined>(undefined),
    panel,
    header: createRowHeader(view.read, theme),
    body: createRowBody(view.read, theme, () => panel.read()?.invalidate()),
  };
}
function isRowState(value: unknown): value is RowState {
  return typeof value === 'object' && value !== null && ROW_STATE in value;
}
function rowState(ctx: ToolRenderContext, spec: ToolSpec, theme: Theme): RowState {
  const existing = ctx.state.snoop;
  if (isRowState(existing)) return existing;
  const created = createRowState(spec, theme, ctx);
  ctx.state.snoop = created;
  return created;
}

function expandedBody(state: RowState, native: ToolRenderers, result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, ctx: ToolRenderContext): BodyView {
  const tone = ctx.isError ? 'error' : 'ok';
  const panel = state.panel.read() ?? createPanel(theme, () => state.view.read().pad);
  state.panel.write(panel);
  if (native.renderResult) {
    // Native call renderers start timers and edit previews. Only delegate result detail.
    const nativeResult = native.renderResult(result, options, theme, { ...ctx, state: state.native, lastComponent: state.nativeResult.read(), outputPad: 0 });
    state.nativeResult.write(nativeResult);
    panel.showChild(nativeResult, tone);
  } else {
    panel.showText(plainDetail(theme, ctx.args, result), tone);
  }
  return { kind: 'panel', panel, tone };
}
function resultBody(state: RowState, native: ToolRenderers, summary: ResultSummary, result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, ctx: ToolRenderContext): BodyView {
  if (options.expanded) return expandedBody(state, native, result, options, theme, ctx);
  if (!summary.preview) return { kind: 'none' };
  return { kind: 'preview', preview: summary.preview, hint: summary.preview.hidden > 0 ? ctx.keyText('app.tools.expand') : undefined };
}

export function compactRenderers(spec: ToolSpec, native: ToolRenderers): ToolRenderers {
  return {
    renderShell: 'self',
    renderCall(args, theme, ctx) {
      const state = rowState(ctx, spec, theme);
      commit(state, { ...state.view.read(), phase: derivePhase(ctx), target: spec.target(parseArgs(args), ctx.cwd), pad: ctx.outputPad });
      return state.header;
    },
    renderResult(result, options, theme, ctx) {
      const state = rowState(ctx, spec, theme);
      const summary = summarizeOnce(state, spec, result, options, ctx);
      const body = resultBody(state, native, summary, result, options, theme, ctx);
      commit(state, { ...state.view.read(), phase: derivePhase(ctx), meta: summary.meta, body });
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
function commit(state: RowState, next: RowView): void {
  const prev = state.view.read();
  if (prev.phase === next.phase && prev.verb === next.verb && prev.pad === next.pad && prev.target.text === next.target.text && prev.target.kind === next.target.kind && prev.meta === next.meta && sameBody(prev.body, next.body)) return;
  if (prev.pad !== next.pad) state.panel.read()?.invalidate();
  state.view.write(Object.freeze(next));
}
function summarizeOnce(state: RowState, spec: ToolSpec, result: AgentToolResult<unknown>, options: ToolRenderResultOptions, ctx: ToolRenderContext): ResultSummary {
  const memo = state.summary.read();
  if (memo && memo.content === result.content && memo.details === result.details && memo.args === ctx.args && memo.isPartial === options.isPartial && memo.isError === ctx.isError) return memo.value;
  const text = result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  const images = result.content.filter((c) => c.type === 'image').length;
  const value = spec.summarize({ args: parseArgs(ctx.args), text, images, details: result.details, isError: ctx.isError, isPartial: options.isPartial });
  state.summary.write({ content: result.content, details: result.details, args: ctx.args, isPartial: options.isPartial, isError: ctx.isError, value });
  return value;
}
