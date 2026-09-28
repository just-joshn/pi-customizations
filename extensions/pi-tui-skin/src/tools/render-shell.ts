/**
 * Shared row primitives plus the two shell tools (`bash`, `powershell`).
 *
 * Every renderer builds its component eagerly and returns it. The component's
 * `render(width)` runs later without any try/catch in pi-tui, so a throw there
 * would crash Pi. No parsing or formatting may be deferred into it.
 *
 * Single-line rows use `TruncatedText`, which takes the first line, truncates
 * with an ellipsis, and pads to the full width. `Text` renders an empty string
 * as zero lines, which is how a result row disappears.
 */

import type { Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { stripTerminalSequences, Text, TruncatedText } from '@earendil-works/pi-tui';
import { shortenHomePath } from '../format/path.ts';

const ROW_MARKER = '◇';
const MISSING = '...';
const TAB_WIDTH = 3;

/**
 * Drop the characters that let tool output drive the terminal or break the width
 * measurement: control characters except tab and newline, DEL, and the
 * interlinear annotation marks that crash string-width. Mirrors Pi's own output
 * sanitizing, spelled as a filter so no control character sits in a regex.
 */
function stripControlChars(text: string): string {
  return Array.from(text)
    .filter((char) => {
      const code = char.codePointAt(0);
      if (code === undefined) return false;
      if (code === 0x09 || code === 0x0a) return true;
      if (code <= 0x1f || code === 0x7f) return false;
      return !(code >= 0xfff9 && code <= 0xfffb);
    })
    .join('');
}

/**
 * Normalize untrusted tool output. Pi's own renderers strip terminal sequences,
 * drop carriage returns, and widen tabs before display. Skipping that lets file
 * content or command output drive the terminal, and a carriage return from
 * progress output overwrites the row it was meant to annotate.
 */
function normalizeOutputText(text: string): string {
  return stripControlChars(stripTerminalSequences(text)).replace(/\t/g, ' '.repeat(TAB_WIDTH));
}

/** The renderer context fields these rows read. The real `ToolRenderContext` is not exported from the package root. */
export interface ToolRowContext {
  readonly executionStarted: boolean;
  readonly isPartial: boolean;
  readonly isError: boolean;
}

/** One entry of `result.content`. Values arrive untrusted, so every field is `unknown`. */
export interface ToolContentPart {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly data?: unknown;
  readonly mimeType?: unknown;
}

export interface ToolResultLike {
  readonly content: readonly ToolContentPart[];
  readonly details?: unknown;
}

/** Read a string field from untrusted arguments. Never throws. */
function readArgString(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Read a string field from untrusted arguments, normalized so a carriage return
 * or an escape sequence in a path, pattern, command, or diff cannot drive the
 * terminal. This is the boundary for display text from tool arguments.
 */
export function displayArg(source: unknown, key: string): string | undefined {
  const value = readArgString(source, key);
  return value === undefined ? undefined : normalizeOutputText(value);
}

/** Read a finite number field from untrusted arguments. */
export function argNumber(source: unknown, key: string): number | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The home directory to shorten against, or undefined. */
export function currentHome(): string | undefined {
  const home = process.env.HOME;
  return typeof home === 'string' && home.length > 0 ? home : undefined;
}

/** Shorten a leading home directory for display. */
export function displayPath(path: string, home: string | undefined): string {
  return home === undefined ? path : shortenHomePath(path, home);
}

function callMarker(theme: Theme, context: ToolRowContext): string {
  if (context.isError) return theme.fg('error', ROW_MARKER);
  if (!context.executionStarted || context.isPartial) return theme.fg('dim', ROW_MARKER);
  return theme.fg('success', ROW_MARKER);
}

/**
 * Build the one-line call row `◇ <Verb> <target><suffix>`.
 *
 * `suffix` is appended directly to the target so each renderer controls its own
 * spacing and color, for example `path` + `:4-13`, or `pattern` + ` in src`.
 */
export function callRow(theme: Theme, context: ToolRowContext, verb: string, target: string, suffix = ''): Component {
  const marker = callMarker(theme, context);
  const label = theme.bold(theme.fg('toolTitle', verb));
  const labelTarget = theme.fg('accent', target);
  return new TruncatedText(`${marker} ${label} ${labelTarget}${suffix}`, 0, 0);
}

/** A result that contributes no lines. `Text` renders an empty string as zero lines. */
export function emptyResult(): Component {
  return new Text('', 0, 0);
}

/** Every text content part, normalized for display, in order. */
function textParts(result: ToolResultLike): string[] {
  const texts: string[] = [];
  if (!Array.isArray(result.content)) return texts;
  for (const part of result.content) {
    if (part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
      texts.push(normalizeOutputText(part.text));
    }
  }
  return texts;
}

function firstText(result: ToolResultLike): string | undefined {
  return textParts(result)[0];
}

/** One truncated, error-colored line built from the first text part. */
export function errorResult(result: ToolResultLike, theme: Theme): Component {
  const first = firstText(result);
  const firstLine = first === undefined ? '' : (first.split('\n')[0] ?? '');
  const line = firstLine.length === 0 ? 'Error' : firstLine;
  const text = line.startsWith('Error') ? line : `Error: ${line}`;
  return new TruncatedText(theme.fg('error', text), 0, 0);
}

/** A display line and the theme role that colors it. */
type ResultLine = { text: string; role: 'toolOutput' | 'dim' };

/**
 * The expanded body for a text-result tool: every text line in `toolOutput`,
 * trailing blank lines trimmed, and one dim `[image]` line per image part.
 */
export function expandedResult(result: ToolResultLike, theme: Theme): Component {
  if (!Array.isArray(result.content)) return new Text('', 0, 0);
  const lines: ResultLine[] = [];
  for (const part of result.content) {
    if (part === null || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      for (const line of normalizeOutputText(part.text).split('\n')) lines.push({ text: line, role: 'toolOutput' });
    } else if (part.type === 'image') {
      lines.push({ text: '[image]', role: 'dim' });
    }
  }
  let end = lines.length;
  while (end > 0 && lines[end - 1]?.text === '') end--;
  return new Text(
    lines
      .slice(0, end)
      .map((line) => theme.fg(line.role, line.text))
      .join('\n'),
    0,
    0,
  );
}

/** One error line when collapsed, the full body when expanded. */
export function textToolResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  if (options.isPartial) return emptyResult();
  if (options.expanded) return expandedResult(result, theme);
  if (context.isError) return errorResult(result, theme);
  return emptyResult();
}

function shellCall(verb: string, args: unknown, theme: Theme, context: ToolRowContext): Component {
  const command = displayArg(args, 'command');
  const firstLine = command === undefined ? MISSING : (command.split('\n')[0] ?? MISSING);
  const timeout = argNumber(args, 'timeout');
  const suffix = timeout === undefined ? '' : theme.fg('dim', ` (timeout ${timeout}s)`);
  return callRow(theme, context, verb, firstLine === '' ? MISSING : firstLine, suffix);
}

export function renderBashCall(args: unknown, theme: Theme, context: ToolRowContext): Component {
  return shellCall('Bash', args, theme, context);
}

export function renderPowerShellCall(args: unknown, theme: Theme, context: ToolRowContext): Component {
  return shellCall('PowerShell', args, theme, context);
}

export function renderBashResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  return textToolResult(result, options, theme, context);
}

export function renderPowerShellResult(result: ToolResultLike, options: ToolRenderResultOptions, theme: Theme, context: ToolRowContext): Component {
  return textToolResult(result, options, theme, context);
}
