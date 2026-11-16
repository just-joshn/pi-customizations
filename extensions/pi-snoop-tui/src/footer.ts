import { basename } from 'node:path';

import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from '@earendil-works/pi-coding-agent';
import { type Component, type TUI, visibleWidth } from '@earendil-works/pi-tui';
import { fitPlain, gutterAt, gutterOf, sanitizeLine } from './text.ts';

type ThinkingLevel = ReturnType<ExtensionAPI['getThinkingLevel']>;
export interface FooterSnapshot {
  readonly workspace: string;
  readonly model: string | undefined;
  readonly thinking: ThinkingLevel | undefined;
  readonly ctxPercent: number | null;
}
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
      return new SnoopFooter(
        theme,
        data,
        () => snapshot,
        () => {
          if (mounted === tui) mounted = undefined;
        },
        gutter,
      );
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
export function fitSegments(segments: readonly Segment[], width: number): readonly Segment[] {
  const fitted = segments.filter((s) => s.text).map((s) => ({ ...s, text: sanitizeLine(s.text) }));
  while (rowWidth(fitted) > Math.max(0, width)) {
    const lowest = fitted.reduce((a, b) => (a.priority > b.priority || (a.priority === b.priority && a.side === 'right') ? a : b));
    const size = visibleWidth(lowest.text);
    const min = lowest.priority === 0 ? 0 : lowest.minWidth;
    if (min !== undefined && size > min) {
      lowest.text = fitPlain(lowest.text, Math.max(min, size - (rowWidth(fitted) - Math.max(0, width))));
    } else {
      fitted.splice(fitted.indexOf(lowest), 1);
    }
  }
  return fitted;
}
export function statusText(statuses: ReadonlyMap<string, string>): string {
  return [...statuses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => sanitizeLine(text).trim())
    .filter(Boolean)
    .join(' · ');
}
export class SnoopFooter implements Component {
  private cache: { width: number; snapshot: FooterSnapshot | undefined; branch: string | null; statuses: string; line: string } | undefined;
  private readonly theme: Theme;
  private readonly data: ReadonlyFooterDataProvider;
  private readonly read: () => FooterSnapshot | undefined;
  private readonly onDispose: () => void;
  private readonly gutter: number;
  constructor(theme: Theme, data: ReadonlyFooterDataProvider, read: () => FooterSnapshot | undefined, onDispose: () => void, gutter: number) {
    this.theme = theme;
    this.data = data;
    this.read = read;
    this.onDispose = onDispose;
    this.gutter = gutter;
  }
  render(width: number): string[] {
    const snapshot = this.read();
    const branch = this.data.getGitBranch();
    const statuses = statusText(this.data.getExtensionStatuses());
    if (this.cache?.width === width && this.cache.snapshot === snapshot && this.cache.branch === branch && this.cache.statuses === statuses) return [this.cache.line];
    const texts: Record<SegmentId, string> = {
      workspace: snapshot?.workspace ?? '',
      branch: branch ?? '',
      statuses,
      model: snapshot?.model ?? '',
      thinking: snapshot?.thinking ?? '',
      ctx: snapshot?.ctxPercent == null ? 'ctx ?' : `ctx ${Math.round(snapshot.ctxPercent)}%`,
    };
    const g = gutterAt(this.gutter, width);
    const inner = width - 2 * g;
    const fitted = fitSegments(
      SEGMENT_ORDER.map((s) => ({ ...s, text: texts[s.id] })),
      inner,
    );
    const style = (s: Segment): string => {
      const percent = snapshot?.ctxPercent;
      const color = s.id === 'workspace' ? 'text' : s.id !== 'ctx' ? 'muted' : percent == null ? 'dim' : percent > 90 ? 'error' : percent > 70 ? 'warning' : 'accent';
      return this.theme.fg(color, s.text);
    };
    const separator = (text: string): string => this.theme.fg('dim', text);
    const left = joinSide(fitted, 'left', style, separator);
    const right = joinSide(fitted, 'right', style, separator);
    const gap = left && right ? Math.max(2, inner - visibleWidth(left) - visibleWidth(right)) : 0;
    const line = ' '.repeat(g) + left + ' '.repeat(gap) + right;
    this.cache = { width, snapshot, branch, statuses, line };
    return [line];
  }
  invalidate(): void {
    this.cache = undefined;
  }
  dispose(): void {
    this.cache = undefined;
    this.onDispose();
  }
}
