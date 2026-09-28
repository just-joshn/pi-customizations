import type { Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import type { ToolResultLike, ToolRowContext } from './render-shell.ts';
import { argNumber, callRow, currentHome, displayArg, displayPath, textToolResult } from './render-shell.ts';

const MISSING = '...';

export function renderReadCall(args: unknown, theme: Theme, context: ToolRowContext): Component {
  const path = displayArg(args, 'path');
  const target = path === undefined ? MISSING : displayPath(path, currentHome());
  const offset = argNumber(args, 'offset');
  const limit = argNumber(args, 'limit');

  let suffix = '';
  if (offset !== undefined) {
    suffix += theme.fg('warning', `:${offset}`);
    if (limit !== undefined) suffix += theme.fg('warning', `-${offset + limit - 1}`);
  }

  return callRow(theme, context, 'Read', target, suffix);
}

export function renderReadResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  return textToolResult(result, options, theme, context);
}
