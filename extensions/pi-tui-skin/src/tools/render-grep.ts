import type { Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import type { ToolResultLike, ToolRowContext } from './render-shell.ts';
import { callRow, currentHome, displayArg, displayPath, textToolResult } from './render-shell.ts';

const MISSING = '...';

export function renderGrepCall(args: unknown, theme: Theme, context: ToolRowContext): Component {
  const pattern = displayArg(args, 'pattern');
  const target = `"${pattern ?? MISSING}"`;
  const path = displayArg(args, 'path');
  const showPath = path !== undefined && path.length > 0 && path !== '.';
  const suffix = showPath ? theme.fg('dim', ` in ${displayPath(path, currentHome())}`) : '';
  return callRow(theme, context, 'Search', target, suffix);
}

export function renderGrepResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  return textToolResult(result, options, theme, context);
}
