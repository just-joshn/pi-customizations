import { basename } from 'node:path';

import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from '@earendil-works/pi-coding-agent';
import { type Component, type TUI, visibleWidth } from '@earendil-works/pi-tui';
import { memoLast } from './memo.ts';
import { fitPlain, gutterAt, gutterOf, sanitizeLine } from './text.ts';

type ThemeColor = Parameters<Theme['fg']>[0];
type ThinkingLevel = ReturnType<ExtensionAPI['getThinkingLevel']>;
export interface FooterSnapshot {
  readonly workspace: string;
  readonly model: string | undefined;
  readonly thinking: ThinkingLevel | undefined;
  readonly ctxPercent: number | null;
}
const CTX_ERROR_PERCENT = 90;
const CTX_WARNING_PERCENT = 70;
type SegmentId = 'workspace' | 'branch' | 'statuses' | 'model' | 'thinking' | 'ctx';
/** How one segment sits in the row. Segments with the highest `dropOrder` give way first, shrinking to `shrinkTo` columns, or vanishing when they cannot shrink. */
interface SegmentSpec {
  readonly id: SegmentId;
  readonly side: 'left' | 'right';
  readonly dropOrder: number;
  readonly shrinkTo?: number;
  readonly separatorBefore: string;
  readonly tone: (snapshot: FooterSnapshot | undefined) => ThemeColor;
}
interface Segment extends SegmentSpec {
  readonly text: string;
}
const DOT_SEPARATOR = ' · ';
const SEGMENT_ORDER: readonly SegmentSpec[] = [
  { id: 'workspace', side: 'left', dropOrder: 0, shrinkTo: 0, separatorBefore: DOT_SEPARATOR, tone: () => 'text' },
  { id: 'branch', side: 'left', dropOrder: 4, separatorBefore: DOT_SEPARATOR, tone: () => 'muted' },
  { id: 'statuses', side: 'right', dropOrder: 3, shrinkTo: 8, separatorBefore: DOT_SEPARATOR, tone: () => 'muted' },
  { id: 'model', side: 'right', dropOrder: 2, shrinkTo: 8, separatorBefore: DOT_SEPARATOR, tone: () => 'muted' },
  { id: 'thinking', side: 'right', dropOrder: 5, separatorBefore: DOT_SEPARATOR, tone: () => 'muted' },
  { id: 'ctx', side: 'right', dropOrder: 1, separatorBefore: '   ', tone: (snapshot) => ctxColor(snapshot?.ctxPercent) },
];
export default function footer(pi: ExtensionAPI): void {
  let snapshot: FooterSnapshot | undefined;
  let mounted: TUI | undefined;
  const refresh = (ctx: ExtensionContext): void => {
    const next = readSnapshot(ctx, pi.getThinkingLevel());
    if (snapshot && sameSnapshot(snapshot, next)) return;
    snapshot = Object.freeze(next);
    mounted?.requestRender();
  };
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return;
    refresh(ctx);
    const gutter = gutterOf(pi);
    ctx.ui.setFooter((tui, theme, data) => {
      mounted = tui;
      const release = (): void => {
        if (mounted === tui) mounted = undefined;
      };
      return snoopFooter(theme, data, () => snapshot, release, gutter);
    });
  });
  const onChange = (_event: unknown, ctx: ExtensionContext): void => {
    if (ctx.hasUI) refresh(ctx);
  };
  pi.on('model_select', onChange);
  pi.on('thinking_level_select', onChange);
  pi.on('turn_end', onChange);
  pi.on('agent_end', onChange);
  pi.on('session_compact', onChange);
  pi.on('session_tree', onChange);
}
function readSnapshot(ctx: Pick<ExtensionContext, 'cwd' | 'model' | 'getContextUsage'>, thinking: ThinkingLevel): FooterSnapshot {
  return { workspace: basename(ctx.cwd) || ctx.cwd, model: ctx.model?.id, thinking: ctx.model?.reasoning ? thinking : undefined, ctxPercent: ctx.getContextUsage()?.percent ?? null };
}
function sameSnapshot(a: FooterSnapshot, b: FooterSnapshot): boolean {
  return a.workspace === b.workspace && a.model === b.model && a.thinking === b.thinking && a.ctxPercent === b.ctxPercent;
}
function joinSide(segments: readonly Segment[], side: Segment['side'], render: (segment: Segment) => string, separator: (text: string) => string = (text) => text): string {
  return segments
    .filter((segment) => segment.side === side)
    .map((segment, index) => (index ? separator(segment.separatorBefore) : '') + render(segment))
    .join('');
}
function rowWidth(segments: readonly Segment[]): number {
  const left = joinSide(segments, 'left', (s) => s.text);
  const right = joinSide(segments, 'right', (s) => s.text);
  return visibleWidth(left) + visibleWidth(right) + (left && right ? 2 : 0);
}
function shrinkOnce(fitted: readonly Segment[], target: number): readonly Segment[] {
  const next = fitted.reduce((a, b) => (b.dropOrder > a.dropOrder ? b : a));
  const size = visibleWidth(next.text);
  const min = next.shrinkTo;
  if (min === undefined || size <= min) return fitted.filter((s) => s !== next);
  const text = fitPlain(next.text, Math.max(min, size - (rowWidth(fitted) - target)));
  return fitted.map((s) => (s === next ? { ...s, text } : s));
}
function fitSegments(segments: readonly Segment[], width: number): readonly Segment[] {
  const target = Math.max(0, width);
  let fitted: readonly Segment[] = segments.filter((s) => s.text).map((s) => ({ ...s, text: sanitizeLine(s.text) }));
  while (rowWidth(fitted) > target) fitted = shrinkOnce(fitted, target);
  return fitted;
}
function statusText(statuses: ReadonlyMap<string, string>): string {
  return [...statuses.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => sanitizeLine(text).trim())
    .filter(Boolean)
    .join(' · ');
}
function ctxColor(percent: number | null | undefined): 'dim' | 'error' | 'warning' | 'accent' {
  if (percent == null) return 'dim';
  if (percent > CTX_ERROR_PERCENT) return 'error';
  return percent > CTX_WARNING_PERCENT ? 'warning' : 'accent';
}
function segmentTexts(snapshot: FooterSnapshot | undefined, branch: string | null, statuses: string): Record<SegmentId, string> {
  return {
    workspace: snapshot?.workspace ?? '',
    branch: branch ?? '',
    statuses,
    model: snapshot?.model ?? '',
    thinking: snapshot?.thinking ?? '',
    ctx: snapshot?.ctxPercent == null ? 'ctx ?' : `ctx ${Math.round(snapshot.ctxPercent)}%`,
  };
}
function footerLine(theme: Theme, snapshot: FooterSnapshot | undefined, branch: string | null, statuses: string, width: number, gutter: number): string {
  const texts = segmentTexts(snapshot, branch, statuses);
  const g = gutterAt(gutter, width);
  const inner = width - 2 * g;
  const fitted = fitSegments(
    SEGMENT_ORDER.map((s) => ({ ...s, text: texts[s.id] })),
    inner,
  );
  const style = (s: Segment): string => theme.fg(s.tone(snapshot), s.text);
  const separator = (text: string): string => theme.fg('dim', text);
  const left = joinSide(fitted, 'left', style, separator);
  const right = joinSide(fitted, 'right', style, separator);
  const gap = left && right ? Math.max(2, inner - visibleWidth(left) - visibleWidth(right)) : 0;
  return ' '.repeat(g) + left + ' '.repeat(gap) + right;
}
export function snoopFooter(theme: Theme, data: ReadonlyFooterDataProvider, read: () => FooterSnapshot | undefined, onDispose: () => void, gutter: number): Component & { dispose(): void } {
  const lines = memoLast((width: number, snapshot: FooterSnapshot | undefined, branch: string | null, statuses: string) => [footerLine(theme, snapshot, branch, statuses, width, gutter)]);
  return {
    render: (width: number): string[] => lines.get(width, read(), data.getGitBranch(), statusText(data.getExtensionStatuses())),
    invalidate: lines.reset,
    dispose(): void {
      lines.reset();
      onDispose();
    },
  };
}
