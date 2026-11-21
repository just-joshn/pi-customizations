import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Theme } from '@earendil-works/pi-coding-agent';
import type { Component, Text } from '@earendil-works/pi-tui';
import {
  COLLAPSED_ITEM_COUNT,
  containerOf,
  diagnosticLines,
  failedOrMuted,
  type GroupLayout,
  type IconKind,
  outputComponents,
  renderDisplayItems,
  renderGroupBody,
  renderGroupExpanded,
  resultKind,
  spacer,
  statusIcon,
  text,
  usageLine,
} from './render-shared.ts';
import { aggregateUsage, getDisplayItems, getFinalOutput, isActiveResult, isFailedResult } from './results.ts';
import { isSubagentDetails, type SingleResult } from './types.ts';

const EXPAND_HINT = '(Ctrl+O to expand)';

const fallbackText = (result: AgentToolResult<unknown>): Text => {
  const first = result.content[0];
  return text(first?.type === 'text' ? first.text : '(no output)');
};

function singleHeader(theme: Theme, r: SingleResult): string {
  const base = `${statusIcon(theme, resultKind(r))} ${theme.fg('toolTitle', theme.bold(r.agent))}${theme.fg('muted', ` (${r.agentSource})`)}`;
  if (isActiveResult(r)) return `${base} ${theme.fg('warning', `[${r.status}]`)}`;
  if (isFailedResult(r)) return `${base} ${theme.fg('error', `[${r.stopReason ?? r.status}]`)}`;
  return base;
}

function renderSingleExpanded(theme: Theme, r: SingleResult): Component {
  const noOutput = getDisplayItems(r.messages).length === 0 && !getFinalOutput(r.messages);
  const usage = usageLine(theme, r.usage, r.model);
  return containerOf([
    text(singleHeader(theme, r)),
    ...diagnosticLines(theme, r),
    spacer(),
    text(theme.fg('muted', '─── Task ───')),
    text(theme.fg('dim', r.task)),
    spacer(),
    text(theme.fg('muted', '─── Output ───')),
    ...(noOutput ? [text(theme.fg('muted', '(no output)'))] : outputComponents(theme, r)),
    ...(usage ? [spacer(), text(usage)] : []),
  ]);
}

function singleCollapsedBody(theme: Theme, r: SingleResult): string {
  const items = getDisplayItems(r.messages);
  if (isFailedResult(r) && r.errorMessage) return `\n${theme.fg('error', `Error: ${r.errorMessage}`)}`;
  if (items.length === 0) return `\n${theme.fg('muted', '(no output)')}`;
  const hint = items.length > COLLAPSED_ITEM_COUNT ? `\n${theme.fg('muted', EXPAND_HINT)}` : '';
  return `\n${renderDisplayItems(theme, false, items, COLLAPSED_ITEM_COUNT)}${hint}`;
}

function renderSingle(theme: Theme, r: SingleResult, expanded: boolean): Component {
  if (expanded) return renderSingleExpanded(theme, r);
  const usage = usageLine(theme, r.usage, r.model);
  return text(singleHeader(theme, r) + singleCollapsedBody(theme, r) + (usage ? `\n${usage}` : ''));
}

type GroupMode = 'chain' | 'parallel';

const GROUP_UNITS: Record<GroupMode, string> = { chain: 'steps', parallel: 'tasks' };

/** A worker that has not finished reads as what it is doing, not as having no output. */
function groupSummary(theme: Theme, r: SingleResult): string {
  if (r.status === 'pending') return theme.fg('muted', '(pending...)');
  if (r.status === 'running') return theme.fg('muted', '(running...)');
  return failedOrMuted(theme, r, '(no output)');
}

interface GroupCounts {
  done: number;
  failed: number;
  running: number;
  pending: number;
  isRunning: boolean;
}

function countGroup(results: SingleResult[]): GroupCounts {
  const count = (status: SingleResult['status']): number => results.filter((r) => r.status === status).length;
  const running = count('running');
  const pending = count('pending');
  return { done: count('completed'), failed: results.filter(isFailedResult).length, running, pending, isRunning: running + pending > 0 };
}

/** A chain with a failed step failed. A parallel call with one only partly did. */
function groupIcon(mode: GroupMode, counts: GroupCounts): IconKind {
  if (counts.isRunning) return 'active';
  if (counts.failed === 0) return 'done';
  return mode === 'chain' ? 'failed' : 'partial';
}

function groupStatusText(mode: GroupMode, counts: GroupCounts, total: number): string {
  if (mode === 'chain') return `${counts.done}/${total} steps`;
  if (counts.isRunning) return `${counts.done + counts.failed}/${total} done, ${counts.running} running, ${counts.pending} pending`;
  return `${counts.done}/${total} ${GROUP_UNITS[mode]}`;
}

/** The chain and the parallel call differ in their title, their icons and how each worker's heading starts, and in nothing else. */
function groupLayout(theme: Theme, mode: GroupMode, results: SingleResult[]): { layout: GroupLayout; counts: GroupCounts } {
  const counts = countGroup(results);
  const status = groupStatusText(mode, counts, results.length);
  const layout: GroupLayout = {
    header: `${statusIcon(theme, groupIcon(mode, counts))} ${theme.fg('toolTitle', theme.bold(`${mode} `))}${theme.fg('accent', status)}`,
    heading: (r, icon) => `${theme.fg('muted', mode === 'chain' ? `─── Step ${r.step}: ` : '─── ') + theme.fg('accent', r.agent)} ${icon}`,
    collapsedSummary: (r) => groupSummary(theme, r),
  };
  return { layout, counts };
}

function renderGroup(theme: Theme, mode: GroupMode, results: SingleResult[], expanded: boolean): Component {
  const { layout, counts } = groupLayout(theme, mode, results);
  const total = aggregateUsage(results);
  if (expanded && !counts.isRunning) return renderGroupExpanded(theme, layout, results, total);
  const totalLine = counts.isRunning ? '' : usageLine(theme, total, undefined, 'Total: ');
  const hint = expanded ? '' : `\n${theme.fg('muted', EXPAND_HINT)}`;
  return text(`${renderGroupBody(theme, layout, results, expanded)}${totalLine ? `\n\n${totalLine}` : ''}${hint}`);
}

export function renderSubagentResult(result: AgentToolResult<unknown>, expanded: boolean, theme: Theme): Component {
  const { details } = result;
  if (!isSubagentDetails(details) || details.results.length === 0) return fallbackText(result);
  const [first] = details.results;
  if (details.mode === 'single' && details.results.length === 1 && first) return renderSingle(theme, first, expanded);
  if (details.mode === 'chain' || details.mode === 'parallel') return renderGroup(theme, details.mode, details.results, expanded);
  return fallbackText(result);
}
