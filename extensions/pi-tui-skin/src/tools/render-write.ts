import type { Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import type { ToolResultLike, ToolRowContext } from './render-shell.ts';
import { argString, callRow, currentHome, displayPath, textToolResult } from './render-shell.ts';

const MISSING = '...';

export function renderWriteCall(args: unknown, theme: Theme, context: ToolRowContext): Component {
  const path = argString(args, 'path');
  const target = path === undefined ? MISSING : displayPath(path, currentHome());
  const content = argString(args, 'content');
  const suffix = content === undefined ? '' : theme.fg('dim', ` (${content.split('\n').length} lines)`);
  return callRow(theme, context, 'Write', target, suffix);
}

export function renderWriteResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  return textToolResult(result, options, theme, context);
}
