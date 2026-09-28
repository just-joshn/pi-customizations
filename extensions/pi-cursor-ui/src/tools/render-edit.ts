import type { Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { Text } from '@earendil-works/pi-tui';
import type { ToolResultLike, ToolRowContext } from './render-shell.ts';
import { callRow, currentHome, displayArg, displayPath, emptyResult, errorResult, expandedResult } from './render-shell.ts';

const MISSING = '...';

function diffLine(theme: Theme, line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return theme.fg('toolDiffContext', line);
  if (line.startsWith('+')) return theme.fg('toolDiffAdded', line);
  if (line.startsWith('-')) return theme.fg('toolDiffRemoved', line);
  return theme.fg('toolDiffContext', line);
}

function diffResult(diff: string, theme: Theme): Component {
  const lines = diff.split('\n').map((line) => diffLine(theme, line));
  return new Text(lines.join('\n'), 0, 0);
}

export function renderEditCall(args: unknown, theme: Theme, context: ToolRowContext): Component {
  const path = displayArg(args, 'path');
  const target = path === undefined ? MISSING : displayPath(path, currentHome());
  return callRow(theme, context, 'Edit', target);
}

export function renderEditResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  if (options.isPartial) return emptyResult();
  if (context.isError) return errorResult(result, theme);
  if (!options.expanded) return emptyResult();

  const diff = displayArg(result.details, 'diff');
  if (diff !== undefined) return diffResult(diff, theme);
  return expandedResult(result, theme);
}
