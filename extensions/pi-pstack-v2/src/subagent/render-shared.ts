import { getMarkdownTheme, type Theme } from '@earendil-works/pi-coding-agent';
import { type Component, Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui';
import { formatUsageStats } from './format.ts';
import { formatToolCall } from './format-tool-call.ts';
import { getDisplayItems, getFailureSummary, getFinalOutput, isActiveResult, isFailedResult } from './results.ts';
import type { DisplayItem, SingleResult, UsageStats } from './types.ts';

export const COLLAPSED_ITEM_COUNT = 10;
const COLLAPSED_GROUP_ITEM_COUNT = 5;
const PREVIEW_TEXT_LINES = 3;

export const text = (value: string): Text => new Text(value, 0, 0);
export const spacer = (): Spacer => new Spacer(1);
export const containerOf = (children: Component[]): Container => {
  const container = new Container();
  for (const child of children) container.addChild(child);
  return container;
};

export type IconKind = 'active' | 'done' | 'partial' | 'failed';

const ICONS: Record<IconKind, { color: 'warning' | 'success' | 'error'; glyph: string }> = {
  active: { color: 'warning', glyph: '⏳' },
  done: { color: 'success', glyph: '✓' },
  partial: { color: 'warning', glyph: '◐' },
  failed: { color: 'error', glyph: '✗' },
};

export const statusIcon = (theme: Theme, kind: IconKind): string => theme.fg(ICONS[kind].color, ICONS[kind].glyph);

/** The icon kind of one worker. */
export function resultKind(result: SingleResult): IconKind {
  if (isActiveResult(result)) return 'active';
  return isFailedResult(result) ? 'failed' : 'done';
}

const toolCallLine = (theme: Theme, item: Extract<DisplayItem, { type: 'toolCall' }>): string => theme.fg('muted', '→ ') + formatToolCall(item.name, item.args, theme.fg.bind(theme));

export function renderDisplayItems(theme: Theme, expanded: boolean, items: DisplayItem[], limit?: number): string {
  const toShow = limit ? items.slice(-limit) : items;
  const skipped = limit && items.length > limit ? items.length - limit : 0;
  const header = skipped > 0 ? theme.fg('muted', `... ${skipped} earlier items\n`) : '';
  const body = toShow.map((item) => {
    if (item.type === 'toolCall') return `${toolCallLine(theme, item)}\n`;
    const preview = expanded ? item.text : item.text.split('\n').slice(0, PREVIEW_TEXT_LINES).join('\n');
    return `${theme.fg('toolOutput', preview)}\n`;
  });
  return (header + body.join('')).trimEnd();
}

/** Error, signal and stderr lines for a finished child. */
export function diagnosticLines(theme: Theme, r: SingleResult): Component[] {
  return [
    ...(isFailedResult(r) && r.errorMessage ? [text(theme.fg('error', `Error: ${r.errorMessage}`))] : []),
    ...(r.terminationSignal ? [text(theme.fg('error', `Signal: ${r.terminationSignal}`))] : []),
    ...(r.stderr.trim() ? [text(theme.fg('error', `stderr: ${r.stderr.trim()}`))] : []),
  ];
}

/** Tool calls followed by the final output as markdown. */
export function outputComponents(theme: Theme, r: SingleResult): Component[] {
  const finalOutput = getFinalOutput(r.messages);
  const calls = getDisplayItems(r.messages).flatMap((item) => (item.type === 'toolCall' ? [text(toolCallLine(theme, item))] : []));
  const markdown = finalOutput ? [spacer(), new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme())] : [];
  return [...calls, ...markdown];
}

export function usageLine(theme: Theme, usage: UsageStats, model?: string, prefix = ''): string {
  const stats = formatUsageStats(usage, model);
  return stats ? theme.fg('dim', `${prefix}${stats}`) : '';
}

export interface GroupLayout {
  /** Header line, e.g. "✓ chain 2/2 steps". */
  header: string;
  heading: (r: SingleResult, icon: string) => string;
  collapsedSummary: (r: SingleResult) => string;
}

export function renderGroupExpanded(theme: Theme, layout: GroupLayout, results: SingleResult[], total: UsageStats): Container {
  const children = results.flatMap((r) => {
    const usage = usageLine(theme, r.usage, r.model);
    return [spacer(), text(layout.heading(r, statusIcon(theme, resultKind(r)))), text(theme.fg('muted', 'Task: ') + theme.fg('dim', r.task)), ...diagnosticLines(theme, r), ...outputComponents(theme, r), ...(usage ? [text(usage)] : [])];
  });
  const totalText = usageLine(theme, total, undefined, 'Total: ');
  return containerOf([text(layout.header), ...children, ...(totalText ? [spacer(), text(totalText)] : [])]);
}

export function renderGroupBody(theme: Theme, layout: GroupLayout, results: SingleResult[], expanded: boolean): string {
  const rows = results.map((r) => {
    const items = getDisplayItems(r.messages);
    const body = items.length === 0 ? layout.collapsedSummary(r) : renderDisplayItems(theme, expanded, items, COLLAPSED_GROUP_ITEM_COUNT);
    return `\n\n${layout.heading(r, statusIcon(theme, resultKind(r)))}\n${body}`;
  });
  return layout.header + rows.join('');
}

export const failedOrMuted = (theme: Theme, r: SingleResult, fallback: string): string => (isFailedResult(r) ? theme.fg('error', getFailureSummary(r)) : theme.fg('muted', fallback));
