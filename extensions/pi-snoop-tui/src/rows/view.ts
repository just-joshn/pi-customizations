import type { ToolRenderers } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { visibleWidth } from '@earendil-works/pi-tui';
import { fitPath, fitPlain, type LineSlice, sanitizeLine } from '../text.ts';

export type ToolRenderContext = Parameters<NonNullable<ToolRenderers['renderCall']>>[2];
export type RowPhase = 'pending' | 'running' | 'done' | 'failed';
export type Tone = 'ok' | 'error';
export interface Preview extends LineSlice {
  readonly tone: 'output' | 'error';
  readonly from: 'head' | 'tail';
}
export interface TargetText {
  readonly text: string;
  readonly kind: 'path' | 'plain';
}
export interface Panel extends Component {
  showChild(child: Component, tone: Tone): void;
  showText(text: string, tone: Tone): void;
}
export type BodyView = { readonly kind: 'none' } | { readonly kind: 'preview'; readonly preview: Preview; readonly hint: string | undefined } | { readonly kind: 'panel'; readonly panel: Panel; readonly tone: Tone };
export interface RowView {
  readonly phase: RowPhase;
  readonly verb: string;
  readonly target: TargetText;
  readonly meta: string | undefined;
  readonly body: BodyView;
  readonly pad: number;
}
/** Columns taken by the marker and its gap, and the indent of body lines under the header. */
export const ROW_INSET = 3;
/** Columns the verb takes before the target starts. */
export const VERB_COLUMN = 8;
const META_MIN_ROOM = 10;

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
  const available = Math.max(0, width - ROW_INSET);
  const verb = fitPlain(`${view.verb.padEnd(VERB_COLUMN)}  `, available);
  const rest = available - visibleWidth(verb);
  const metaText = sanitizeLine(view.meta ?? '');
  const meta = visibleWidth(metaText) + META_MIN_ROOM <= rest ? metaText : '';
  const target = (view.target.kind === 'path' ? fitPath : fitPlain)(sanitizeLine(view.target.text), rest - (meta ? visibleWidth(meta) + 2 : 0));
  return { verb, target, meta, gap: meta ? rest - visibleWidth(target) - visibleWidth(meta) : 0 };
}
function sameBody(a: BodyView, b: BodyView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'none' && b.kind === 'none') return true;
  if (a.kind === 'preview' && b.kind === 'preview') return a.preview === b.preview && a.hint === b.hint;
  return a.kind === 'panel' && b.kind === 'panel' && a.panel === b.panel && a.tone === b.tone;
}
export function sameView(a: RowView, b: RowView): boolean {
  return a.phase === b.phase && a.verb === b.verb && a.pad === b.pad && a.target.text === b.target.text && a.target.kind === b.target.kind && a.meta === b.meta && sameBody(a.body, b.body);
}
