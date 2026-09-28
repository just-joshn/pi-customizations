import type { Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import type { ToolResultLike, ToolRowContext } from './render-shell.ts';
import { argString, callRow, currentHome, displayPath, textToolResult } from './render-shell.ts';

export function renderLsCall(args: unknown, theme: Theme, context: ToolRowContext): Component {
  const path = argString(args, 'path');
  const target = path === undefined || path.length === 0 ? '.' : displayPath(path, currentHome());
  return callRow(theme, context, 'List', target);
}

export function renderLsResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  return textToolResult(result, options, theme, context);
}
