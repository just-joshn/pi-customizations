import type { Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import type { ToolResultLike, ToolRowContext } from './render-shell.ts';
import { callRow, currentHome, displayArg, displayPath, textToolResult } from './render-shell.ts';

const MISSING = '...';

export function renderFindCall(args: unknown, theme: Theme, context: ToolRowContext): Component {
  const pattern = displayArg(args, 'pattern');
  const target = `"${pattern ?? MISSING}"`;
  const path = displayArg(args, 'path');
  const suffix = path === undefined || path.length === 0 ? '' : theme.fg('dim', ` in ${displayPath(path, currentHome())}`);
  return callRow(theme, context, 'Find', target, suffix);
}

export function renderFindResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  return textToolResult(result, options, theme, context);
}
