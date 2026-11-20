import { basename } from 'node:path';

import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from '@earendil-works/pi-coding-agent';
import { type Component, type TUI, visibleWidth } from '@earendil-works/pi-tui';
import { cell } from './cell.ts';
import { fitPlain, gutterAt, gutterOf, sanitizeLine } from './text.ts';

type ThinkingLevel = ReturnType<ExtensionAPI['getThinkingLevel']>;
export interface FooterSnapshot {
  readonly workspace: string;
  readonly model: string | undefined;
  readonly thinking: ThinkingLevel | undefined;
  readonly ctxPercent: number | null;
}
const CTX_ERROR_PERCENT = 90;
const CTX_WARNING_PERCENT = 70;
export const SEGMENT_ORDER = [
  { id: 'workspace', side: 'left', priority: 0, minWidth: 6 },
  { id: 'branch', side: 'left', priority: 4 },
  { id: 'statuses', side: 'right', priority: 3, minWidth: 8 },
  { id: 'model', side: 'right', priority: 2, minWidth: 8 },
  { id: 'thinking', side: 'right', priority: 5 },
  { id: 'ctx', side: 'right', priority: 1 },
] as const;
export type SegmentId = (typeof SEGMENT_ORDER)[number]['id'];
export interface Segment {
  readonly id: SegmentId;
  readonly side: 'left' | 'right';
  readonly priority: number;
  readonly text: string;
  readonly minWidth?: number;
}
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
export function readSnapshot(ctx: Pick<ExtensionContext, 'cwd' | 'model' | 'getContextUsage'>, thinking: ThinkingLevel): FooterSnapshot {
  return { workspace: basename(ctx.cwd) || ctx.cwd, model: ctx.model?.id, thinking: ctx.model?.reasoning ? thinking : undefined, ctxPercent: ctx.getContextUsage()?.percent ?? null };
}
export function sameSnapshot(a: FooterSnapshot, b: FooterSnapshot): boolean {
  return a.workspace === b.workspace && a.model === b.model && a.thinking === b.thinking && a.ctxPercent === b.ctxPercent;
}
function joinSide(segments: readonly Segment[], side: Segment['side'], render: (segment: Segment) => string, separator: (text: string) => string = (text) => text): string {
  return segments
    .filter((segment) => segment.side === side)
    .map((segment, index) => (index ? separator(segment.id === 'ctx' ? '   ' : ' · ') : '') + render(segment))
    .join('');
}
function rowWidth(segments: readonly Segment[]): number {
  const left = joinSide(segments, 'left', (s) => s.text);
  const right = joinSide(segments, 'right', (s) => s.text);
  return visibleWidth(left) + visibleWidth(right) + (left && right ? 2 : 0);
}
function shrinkOnce(fitted: readonly Segment[], target: number): readonly Segment[] {
  const lowest = fitted.reduce((a, b) => (a.priority > b.priority || (a.priority === b.priority && a.side === 'right') ? a : b));
  const size = visibleWidth(lowest.text);
  const min = lowest.priority === 0 ? 0 : lowest.minWidth;
  if (min === undefined || size <= min) return fitted.filter((s) => s !== lowest);
  const text = fitPlain(lowest.text, Math.max(min, size - (rowWidth(fitted) - target)));
  return fitted.map((s) => (s === lowest ? { ...s, text } : s));
}
export function fitSegments(segments: readonly Segment[], width: number): readonly Segment[] {
  const target = Math.max(0, width);
  let fitted: readonly Segment[] = segments.filter((s) => s.text).map((s) => ({ ...s, text: sanitizeLine(s.text) }));
  while (rowWidth(fitted) > target) fitted = shrinkOnce(fitted, target);
  return fitted;
}
export function statusText(statuses: ReadonlyMap<string, string>): string {
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
  const style = (s: Segment): string => theme.fg(s.id === 'workspace' ? 'text' : s.id !== 'ctx' ? 'muted' : ctxColor(snapshot?.ctxPercent), s.text);
  const separator = (text: string): string => theme.fg('dim', text);
  const left = joinSide(fitted, 'left', style, separator);
  const right = joinSide(fitted, 'right', style, separator);
  const gap = left && right ? Math.max(2, inner - visibleWidth(left) - visibleWidth(right)) : 0;
  return ' '.repeat(g) + left + ' '.repeat(gap) + right;
}
export function snoopFooter(theme: Theme, data: ReadonlyFooterDataProvider, read: () => FooterSnapshot | undefined, onDispose: () => void, gutter: number): Component & { dispose(): void } {
  const cache = cell<{ width: number; snapshot: FooterSnapshot | undefined; branch: string | null; statuses: string; line: string } | undefined>(undefined);
  return {
    render(width: number): string[] {
      const snapshot = read();
      const branch = data.getGitBranch();
      const statuses = statusText(data.getExtensionStatuses());
      const cached = cache.read();
      if (cached?.width === width && cached.snapshot === snapshot && cached.branch === branch && cached.statuses === statuses) return [cached.line];
      const line = footerLine(theme, snapshot, branch, statuses, width, gutter);
      cache.write({ width, snapshot, branch, statuses, line });
      return [line];
    },
    invalidate(): void {
      cache.write(undefined);
    },
    dispose(): void {
      cache.write(undefined);
      onDispose();
    },
  };
}
