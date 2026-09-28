import type { Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import type { ToolResultLike, ToolRowContext } from './render-shell.ts';
import { callRow, currentHome, displayArg, displayPath, textToolResult } from './render-shell.ts';

const MISSING = '...';

/**
 * Line count for a file body. A single trailing newline does not start a new
 * line, so a one-line file written with a trailing newline counts as one.
 */
function countLines(content: string): number {
  if (content === '') return 0;
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

export function renderWriteCall(args: unknown, theme: Theme, context: ToolRowContext): Component {
  const path = displayArg(args, 'path');
  const target = path === undefined ? MISSING : displayPath(path, currentHome());
  const content = displayArg(args, 'content');
  const count = content === undefined ? undefined : countLines(content);
  const suffix = count === undefined ? '' : theme.fg('dim', ` (${count} ${count === 1 ? 'line' : 'lines'})`);
  return callRow(theme, context, 'Write', target, suffix);
}

export function renderWriteResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  return textToolResult(result, options, theme, context);
}
