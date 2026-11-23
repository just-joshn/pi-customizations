import { existsSync } from 'node:fs';

import { type ExtensionAPI, type ExtensionFactory, isToolCallEventType, type ToolCallEvent } from '@earendil-works/pi-coding-agent';
import { READONLY_SUBAGENT_ERROR } from './types.ts';

export const READONLY_BLOCKED_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'delete', 'powershell']);
const MCP_TOOL_PREFIX = 'mcp__';
const DEV_NULL = '/dev/null';
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const SANDBOX_PROFILE = '(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))';

const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\bnpm\s+(install|uninstall|update|ci|publish|link)\b/i,
  /\byarn\s+(add|remove|install|publish)\b/i,
  /\bpnpm\s+(add|remove|install|publish)\b/i,
  /\bbun\s+(add|remove|install|publish)\b/i,
  /\bpip\s+(install|uninstall)\b/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|cherry-pick|revert|stash|clean|branch\s+-[dDmM]|tag\s+-d)\b/i,
  /\bgit\s+reflog\s+(?:expire|delete)\b/i,
  /\bgit\s+grep\b.*(?:\s-O|--open-files-in-pager(?:=|\s|$))/,
  /\bsed\b.*(?:\s-i\b|\s--in-place\b)/i,
  /\bsed\b.*(?:\/[wWeE]\b|\/[wW]\S|s([^\\\s])(?:\\[\s\S]|.)*?\1(?:\\[\s\S]|.)*?\1[^\s'"\\]*[wWeE]|['"]\s*(?:[\d$,]*)[wWeE]\s|['";]\s*[\d$,]*[wW](?:\s|\/)|(?:^|\s)\d+[wW](?:\s|\/|$)|\b[wW]\s+\S|\s[wW]\S)/,
  /\b(?:sed|awk)\b.*(?:\s-f\b|\s--file\b)/,
  /\bawk\b.*>/,
  /\buniq\b(?:\s+--?\S+)*\s+\S+\s+\S+/,
  /\bdate\b.*(?:\s-s\b|\s--set(?:=|\s|$))/,
  /\bperl\s+-i/i,
  /\byq\b.*\s(?:-i|--inplace)(?:=|\s|$)/i,
  /\bfind\b.*\s-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprint0|fprintf)\b/i,
  /\bfd\b.*\s(?:-x|-X|--exec|--exec-batch)(?:=|\s|$)/,
  /\brg\b.*\s--pre(?:=|\s)/i,
  /\bawk\b.*\b(?:system|getline)\b/i,
  /\bawk\b.*\s-i\s+inplace\b/i,
  /^\s*env\s+\S/i,
  /\bsort\b.*\s(?:--compress-program(?:=|\s|$))/i,
  /\bsort\b.*\s(?:-o\S*|--output(?:=|\s|$))/i,
  /\btree\b.*\s(?:-o\S*|--output(?:=|\s|$))/i,
  /\bgit\b.*\s--output(?:=|\s)/i,
];

const SAFE_READONLY_PREFIXES: readonly RegExp[] = [
  /^\s*(cat|head|tail|less|more|wc|nl|file|stat|ls|ll|la|tree|pwd|which|whereis|type|realpath|readlink|basename|dirname|env|printenv|echo|printf|uname|whoami|id)\b/,
  /^\s*date(?:\s+(?:-[uR]|--utc|--universal|-d\s+(?:'[^']*'|"[^"]*"|\S+)|--date(?:=|\s)(?:'[^']*'|"[^"]*"|\S+)|\+\S+|'\+(?:[^'\\]|\\.)*'|"\+(?:[^"\\]|\\.)*"))*\s*$/,
  /^\s*hostname(?:\s+--?[A-Za-z0-9][-A-Za-z0-9]*)*\s*$/,
  /^\s*(find|fd|rg|ripgrep|grep|egrep|fgrep|ag|ack|awk|sed|cut|sort|uniq|tr|jq|yq|diff|cmp|comm|md5|sha256sum|shasum)\b/,
  /^\s*git\s+(status|log|diff|show|rev-parse|describe|blame|ls-files|ls-tree|shortlog|reflog|grep|config\s+--get|config\s+--list)\b/,
  /^\s*git\s+branch(?:\s+(?:-[arv]+|--list|--show-current))?\s*$/,
  /^\s*git\s+tag(?:\s+-l(?:\s+\S+)?)?\s*$/,
  /^\s*git\s+remote(?:\s+(?:-v|show\s+\S+))?\s*$/,
];

function isShellBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s<>|&;)]/.test(char);
}

function skipWhitespace(command: string, start: number): number {
  let index = start;
  while (command[index] === ' ' || command[index] === '\t') {
    index += 1;
  }
  return index;
}

function isDevNullTarget(command: string, start: number): boolean {
  const index = skipWhitespace(command, start);
  const end = index + DEV_NULL.length;
  return command.startsWith(DEV_NULL, index) && isShellBoundary(command[end]);
}

function isFdDuplicate(command: string, start: number): boolean {
  const destination = command[skipWhitespace(command, start)] ?? '';
  return destination === '' || destination === '-' || /\d/.test(destination);
}

function isAllowedWriteRedirect(command: string, index: number): boolean {
  if (command[index + 1] === '&') {
    return isFdDuplicate(command, index + 2);
  }
  const target = command[index + 1] === '>' ? index + 2 : index + 1;
  return isDevNullTarget(command, target);
}

/** True when the command contains a redirect that writes a file. Quoted redirects, fd duplicates, /dev/null, and read redirection stay allowed. */
function hasUnquotedRedirect(command: string): boolean {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? '';
    if (char === '\\' && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote !== undefined) {
      quote = char === quote ? undefined : quote;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if ((char === '<' && command[index + 1] === '>') || (char === '>' && !isAllowedWriteRedirect(command, index))) {
      return true;
    }
  }
  return false;
}

function isSingleReadOnlySegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) {
    return false;
  }
  if (hasUnquotedRedirect(trimmed) || DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }
  return SAFE_READONLY_PREFIXES.some((pattern) => pattern.test(trimmed));
}

function isUnsafeDoubleQuoted(command: string, index: number): boolean {
  const char = command[index] ?? '';
  return char === '`' || char === ';' || (char === '$' && command[index + 1] === '(');
}

function isLoneAmpersand(command: string, index: number): boolean {
  const previous = command[index - 1];
  return previous !== '>' && previous !== '|' && command[index + 1] !== '>';
}

function isUnsafeOutsideQuotes(command: string, index: number): boolean {
  const char = command[index] ?? '';
  const next = command[index + 1] ?? '';
  if (char === '\n' || char === '\r' || char === ';' || char === '`') {
    return true;
  }
  if ((char === '$' && next === '(') || (char === '<' && next === '(') || (char === '|' && next === '|')) {
    return true;
  }
  return char === '&' && (next === '&' || isLoneAmpersand(command, index));
}

function splitReadOnlyPipeline(command: string): readonly string[] | undefined {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? '';
    if (char === '\\' && quote !== "'") {
      current += char + (command[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (quote === '"' && isUnsafeDoubleQuoted(command, index)) {
      return undefined;
    }
    if (quote === undefined && (char === "'" || char === '"')) {
      quote = char;
      current += char;
      continue;
    }
    if (quote !== undefined) {
      quote = char === quote ? undefined : quote;
      current += char;
      continue;
    }
    if (isUnsafeOutsideQuotes(command, index)) {
      return undefined;
    }
    if (char === '|') {
      segments.push(current);
      current = '';
      if (command[index + 1] === '&') {
        index += 1;
      }
      continue;
    }
    current += char;
  }
  if (quote !== undefined) {
    return undefined;
  }
  segments.push(current);
  return segments;
}

export function isSafeReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  const segments = trimmed.length === 0 ? undefined : splitReadOnlyPipeline(trimmed);
  return segments !== undefined && segments.every(isSingleReadOnlySegment);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Wraps a command in a macOS sandbox that denies filesystem writes except /dev/null. Other platforms return the command unchanged. */
export function sandboxReadOnlyCommand(command: string): string {
  if (process.platform !== 'darwin' || !existsSync(SANDBOX_EXEC)) {
    return command;
  }
  return `${SANDBOX_EXEC} -p ${shellQuote(SANDBOX_PROFILE)} /bin/sh -c ${shellQuote(command)}`;
}

export function evaluateReadonlySubagentGuard(event: ToolCallEvent): { block: true; reason: string } | undefined {
  if (READONLY_BLOCKED_TOOLS.has(event.toolName) || event.toolName.startsWith(MCP_TOOL_PREFIX)) {
    return { block: true, reason: READONLY_SUBAGENT_ERROR };
  }
  if (!isToolCallEventType('bash', event)) {
    return undefined;
  }
  if (!isSafeReadOnlyCommand(event.input.command)) {
    return { block: true, reason: READONLY_SUBAGENT_ERROR };
  }
  event.input.command = sandboxReadOnlyCommand(event.input.command);
  return undefined;
}

export function createReadonlySubagentExtension(): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    pi.on('tool_call', async (event) => evaluateReadonlySubagentGuard(event));
  };
}
