import type { AgentToolResult, Theme, ToolRenderers, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { type Cell, cell } from '../cell.ts';
import { type Memo, memoLast } from '../memo.ts';
import { sanitizeLine } from '../text.ts';
import { createRowBody, createRowHeader } from './components.ts';
import { createPanel } from './panel.ts';
import type { ResultSummary, ToolSpec } from './specs.ts';
import { type BodyView, derivePhase, type Panel, type RowView, sameView, type ToolRenderContext } from './view.ts';

const ROW_STATE = Symbol('snoop.rowState');
type Content = AgentToolResult<unknown>['content'];
type SummaryArgs = [content: Content, details: unknown, args: unknown, isPartial: boolean, isError: boolean];
interface RowState {
  readonly [ROW_STATE]: true;
  readonly view: Cell<RowView>;
  /** The theme of the latest render call, so a theme swap restyles rows that already exist. */
  readonly theme: Cell<Theme>;
  readonly summary: Memo<SummaryArgs, ResultSummary>;
  readonly native: Record<string, unknown>;
  readonly nativeResult: Cell<Component | undefined>;
  readonly header: Component;
  readonly body: Component;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
function parseArgs(args: unknown): Record<string, unknown> {
  return isRecord(args) ? args : {};
}
function textOf(content: Content): string {
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}
function createRowState(spec: ToolSpec, theme: Theme, ctx: ToolRenderContext): RowState {
  const view = cell(Object.freeze<RowView>({ phase: derivePhase(ctx), verb: spec.verb, target: spec.target(parseArgs(ctx.args), ctx.cwd), meta: undefined, body: { kind: 'none' }, pad: ctx.outputPad }));
  const live = cell(theme);
  return {
    [ROW_STATE]: true,
    view,
    theme: live,
    summary: memoLast((content, details, args, isPartial, isError) => spec.summarize({ args: parseArgs(args), text: textOf(content), images: content.filter((c) => c.type === 'image').length, details, isError, isPartial })),
    native: {},
    nativeResult: cell<Component | undefined>(undefined),
    header: createRowHeader(view.read, live.read),
    body: createRowBody(view.read, live.read),
  };
}
function isRowState(value: unknown): value is RowState {
  return typeof value === 'object' && value !== null && ROW_STATE in value;
}
function rowState(ctx: ToolRenderContext, spec: ToolSpec, theme: Theme): RowState {
  const bag: unknown = ctx.state;
  const existing: unknown = isRecord(bag) ? Reflect.get(bag, 'snoop') : undefined;
  if (isRowState(existing)) {
    existing.theme.write(theme);
    return existing;
  }
  const created = createRowState(spec, theme, ctx);
  if (isRecord(bag)) Reflect.set(bag, 'snoop', created);
  return created;
}

function openPanel(state: RowState): Panel {
  const { body } = state.view.read();
  return body.kind === 'panel' ? body.panel : createPanel(state.theme.read, () => state.view.read().pad);
}
function expandedBody(state: RowState, native: ToolRenderers, result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, ctx: ToolRenderContext): BodyView {
  const tone = ctx.isError ? 'error' : 'ok';
  const panel = openPanel(state);
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
      const summary = state.summary.get(result.content, result.details, ctx.args, options.isPartial, ctx.isError);
      const body = resultBody(state, native, summary, result, options, theme, ctx);
      commit(state, { ...state.view.read(), phase: derivePhase(ctx), meta: summary.meta, body });
      return state.body;
    },
  };
}
function plainDetail(theme: Theme, args: unknown, result: AgentToolResult<unknown>): string {
  const output = textOf(result.content).split('\n').map(sanitizeLine).join('\n');
  const json = sanitizeLine(JSON.stringify(args) ?? '');
  return [json && theme.fg('dim', json), output && theme.fg('toolOutput', output)].filter(Boolean).join('\n\n');
}
function commit(state: RowState, next: RowView): void {
  if (!sameView(state.view.read(), next)) state.view.write(Object.freeze(next));
}
