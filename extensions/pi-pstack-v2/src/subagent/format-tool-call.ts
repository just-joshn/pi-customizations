import * as os from 'node:os';

import { formatReadLineRange } from '@earendil-works/pi-coding-agent';
import { clip } from './format.ts';

export type ThemeFg = (color: 'muted' | 'toolOutput' | 'accent' | 'warning' | 'dim', text: string) => string;
type ToolArgs = Record<string, unknown>;
type ToolCallFormatter = (args: ToolArgs, fg: ThemeFg) => string;

const BASH_PREVIEW_CHARS = 60;
const DEFAULT_PREVIEW_CHARS = 50;

const shortenPath = (p: string): string => {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
};

const argText = (args: ToolArgs, keys: string[], fallback: string): string => {
  const hit = keys.map((key) => args[key]).find((value) => typeof value === 'string' && value.length > 0);
  return typeof hit === 'string' ? hit : fallback;
};

const formatBash: ToolCallFormatter = (args, fg) => fg('muted', '$ ') + fg('toolOutput', clip(argText(args, ['command'], '...'), BASH_PREVIEW_CHARS));

const formatRead: ToolCallFormatter = (args, fg) => {
  const filePath = shortenPath(argText(args, ['file_path', 'path'], '...'));
  const lineRange = formatReadLineRange(args['offset'], args['limit']);
  return fg('muted', 'read ') + fg('accent', filePath) + (lineRange ? fg('warning', lineRange) : '');
};

const formatWrite: ToolCallFormatter = (args, fg) => {
  const filePath = shortenPath(argText(args, ['file_path', 'path'], '...'));
  const lines = argText(args, ['content'], '').split('\n').length;
  return fg('muted', 'write ') + fg('accent', filePath) + (lines > 1 ? fg('dim', ` (${lines} lines)`) : '');
};

const formatEdit: ToolCallFormatter = (args, fg) => fg('muted', 'edit ') + fg('accent', shortenPath(argText(args, ['file_path', 'path'], '...')));

const formatLs: ToolCallFormatter = (args, fg) => fg('muted', 'ls ') + fg('accent', shortenPath(argText(args, ['path'], '.')));

const formatFind: ToolCallFormatter = (args, fg) => fg('muted', 'find ') + fg('accent', argText(args, ['pattern'], '*')) + fg('dim', ` in ${shortenPath(argText(args, ['path'], '.'))}`);

const formatGrep: ToolCallFormatter = (args, fg) => fg('muted', 'grep ') + fg('accent', `/${argText(args, ['pattern'], '')}/`) + fg('dim', ` in ${shortenPath(argText(args, ['path'], '.'))}`);

const FORMATTERS = new Map<string, ToolCallFormatter>([
  ['bash', formatBash],
  ['read', formatRead],
  ['write', formatWrite],
  ['edit', formatEdit],
  ['ls', formatLs],
  ['find', formatFind],
  ['grep', formatGrep],
]);

export function formatToolCall(toolName: string, args: ToolArgs, fg: ThemeFg): string {
  const formatter = FORMATTERS.get(toolName);
  if (formatter) return formatter(args, fg);
  return fg('accent', toolName) + fg('dim', ` ${clip(JSON.stringify(args), DEFAULT_PREVIEW_CHARS)}`);
}
