import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Theme } from '@earendil-works/pi-coding-agent';
import type { Component, Text } from '@earendil-works/pi-tui';
import { COLLAPSED_ITEM_COUNT, containerOf, diagnosticLines, failedOrMuted, type GroupLayout, outputComponents, renderDisplayItems, renderGroupBody, renderGroupExpanded, resultIcon, spacer, text, usageLine } from './render-shared.ts';
import { aggregateUsage, getDisplayItems, getFinalOutput, isActiveResult, isFailedResult } from './results.ts';
import { isSubagentDetails, type SingleResult } from './types.ts';

const EXPAND_HINT = '(Ctrl+O to expand)';

const fallbackText = (result: AgentToolResult<unknown>): Text => {
  const first = result.content[0];
  return text(first?.type === 'text' ? first.text : '(no output)');
};

function singleHeader(theme: Theme, r: SingleResult): string {
  const base = `${resultIcon(theme, r)} ${theme.fg('toolTitle', theme.bold(r.agent))}${theme.fg('muted', ` (${r.agentSource})`)}`;
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

function chainIcon(theme: Theme, results: SingleResult[], successCount: number): string {
  if (results.some(isActiveResult)) return theme.fg('warning', '⏳');
  return successCount === results.length ? theme.fg('success', '✓') : theme.fg('error', '✗');
}

function renderChain(theme: Theme, results: SingleResult[], expanded: boolean): Component {
  const successCount = results.filter((r) => r.status === 'completed').length;
  const icon = chainIcon(theme, results, successCount);
  const layout: GroupLayout = {
    header: `${icon} ${theme.fg('toolTitle', theme.bold('chain '))}${theme.fg('accent', `${successCount}/${results.length} steps`)}`,
    heading: (r, rIcon) => `${theme.fg('muted', `─── Step ${r.step}: `) + theme.fg('accent', r.agent)} ${rIcon}`,
    collapsedSummary: (r) => failedOrMuted(theme, r, '(no output)'),
  };
  const total = aggregateUsage(results);
  if (expanded) return renderGroupExpanded(theme, layout, results, total);
  const totalLine = usageLine(theme, total, undefined, 'Total: ');
  return text(`${renderGroupBody(theme, layout, results, false)}${totalLine ? `\n\n${totalLine}` : ''}\n${theme.fg('muted', EXPAND_HINT)}`);
}

function parallelIcon(theme: Theme, running: boolean, failCount: number): string {
  if (running) return theme.fg('warning', '⏳');
  return failCount > 0 ? theme.fg('warning', '◐') : theme.fg('success', '✓');
}

function parallelSummary(theme: Theme, r: SingleResult): string {
  if (r.status === 'pending') return theme.fg('muted', '(pending...)');
  if (r.status === 'running') return theme.fg('muted', '(running...)');
  return failedOrMuted(theme, r, '(no output)');
}

function renderParallel(theme: Theme, results: SingleResult[], expanded: boolean): Component {
  const running = results.filter((r) => r.status === 'running').length;
  const pending = results.filter((r) => r.status === 'pending').length;
  const successCount = results.filter((r) => r.status === 'completed').length;
  const failCount = results.filter(isFailedResult).length;
  const isRunning = running > 0 || pending > 0;
  const status = isRunning ? `${successCount + failCount}/${results.length} done, ${running} running, ${pending} pending` : `${successCount}/${results.length} tasks`;
  const layout: GroupLayout = {
    header: `${parallelIcon(theme, isRunning, failCount)} ${theme.fg('toolTitle', theme.bold('parallel '))}${theme.fg('accent', status)}`,
    heading: (r, rIcon) => `${theme.fg('muted', '─── ') + theme.fg('accent', r.agent)} ${rIcon}`,
    collapsedSummary: (r) => parallelSummary(theme, r),
  };
  const total = aggregateUsage(results);
  if (expanded && !isRunning) return renderGroupExpanded(theme, layout, results, total);
  const totalLine = isRunning ? '' : usageLine(theme, total, undefined, 'Total: ');
  const hint = expanded ? '' : `\n${theme.fg('muted', EXPAND_HINT)}`;
  return text(`${renderGroupBody(theme, layout, results, expanded)}${totalLine ? `\n\n${totalLine}` : ''}${hint}`);
}

export function renderSubagentResult(result: AgentToolResult<unknown>, expanded: boolean, theme: Theme): Component {
  const { details } = result;
  if (!isSubagentDetails(details) || details.results.length === 0) return fallbackText(result);
  const [first] = details.results;
  if (details.mode === 'single' && details.results.length === 1 && first) return renderSingle(theme, first, expanded);
  if (details.mode === 'chain') return renderChain(theme, details.results, expanded);
  if (details.mode === 'parallel') return renderParallel(theme, details.results, expanded);
  return fallbackText(result);
}
