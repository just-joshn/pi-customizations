import { existsSync, mkdirSync, realpathSync } from 'node:fs';

import { type ExtensionAPI, type ExtensionFactory, isToolCallEventType, type ToolCallEvent } from '@earendil-works/pi-coding-agent';
import { READONLY_SUBAGENT_ERROR } from './types.ts';

export const READONLY_BLOCKED_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'delete', 'powershell']);
const MCP_TOOL_PREFIX = 'mcp__';
const DEV_NULL = '/dev/null';
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const SANDBOX_SHELL = '/bin/ksh';
const READONLY_TEMP_ROOT = '/tmp/pi-subagents-readonly';

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
  /\bgit\b.*\s--(?:ext-diff|textconv)\b/,
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
  /\bawk\b.*\|/,
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

const DISABLED_GIT_HELPER = '/usr/bin/false';
const GIT_NO_HELPER_FLAGS = '--no-ext-diff --no-textconv';
const GIT_DIFF_COMMANDS = ['diff', 'log', 'show', 'blame'] as const;

const READONLY_GIT_CONFIG: readonly (readonly [string, string])[] = [
  ['core.fsmonitor', 'false'],
  ['diff.external', ''],
  ['core.pager', 'cat'],
  ['credential.helper', ''],
];

function isGitWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_.-]/.test(char);
}

function startsWord(command: string, index: number, word: string): boolean {
  return command.startsWith(word, index) && !isGitWordChar(command[index + word.length]);
}

function gitDiffCommandEnd(command: string, index: number): number | undefined {
  if (isGitWordChar(command[index - 1]) || !startsWord(command, index, 'git')) {
    return undefined;
  }
  const subIndex = skipWhitespace(command, index + 'git'.length);
  const subcommand = GIT_DIFF_COMMANDS.find((name) => startsWord(command, subIndex, name));
  return subcommand === undefined ? undefined : subIndex + subcommand.length;
}

/** Disables diff drivers and textconv for git diff, log, show, and blame, including pipeline segments. Quoted text is left unchanged. */
function hardenReadOnlyGitCommand(command: string): string {
  let quote: "'" | '"' | undefined;
  let hardened = '';
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? '';
    if (char === '\\' && quote !== "'") {
      hardened += char + (command[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (quote !== undefined) {
      hardened += char;
      quote = char === quote ? undefined : quote;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hardened += char;
      continue;
    }
    const end = gitDiffCommandEnd(command, index);
    if (end !== undefined) {
      hardened += `${command.slice(index, end)} ${GIT_NO_HELPER_FLAGS}`;
      index = end - 1;
      continue;
    }
    hardened += char;
  }
  return hardened;
}

const FILTER_DISABLE_SHELL = `_pi_empty=$(git -c core.fsmonitor=false hash-object -t tree --stdin </dev/null 2>/dev/null || true); case $_pi_empty in [0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) export GIT_ATTR_SOURCE=$_pi_empty ;; esac; _pi_n=${READONLY_GIT_CONFIG.length}; _pi_drivers=$(git -c core.fsmonitor=false config --get-regexp '^filter\..*\.(clean|smudge|process)$' 2>/dev/null | sed 's/[[:space:]].*//; s/\.[^.]*$//' | sort -u || true); for _pi_driver in $_pi_drivers; do case $_pi_driver in filter.[A-Za-z0-9._-]*) ;; *) continue ;; esac; export "GIT_CONFIG_KEY_\${_pi_n}=\${_pi_driver}.clean"; export "GIT_CONFIG_VALUE_\${_pi_n}=/bin/cat"; _pi_n=$((_pi_n + 1)); export "GIT_CONFIG_KEY_\${_pi_n}=\${_pi_driver}.smudge"; export "GIT_CONFIG_VALUE_\${_pi_n}=/bin/cat"; _pi_n=$((_pi_n + 1)); export "GIT_CONFIG_KEY_\${_pi_n}=\${_pi_driver}.process"; export "GIT_CONFIG_VALUE_\${_pi_n}="; _pi_n=$((_pi_n + 1)); export "GIT_CONFIG_KEY_\${_pi_n}=\${_pi_driver}.required"; export "GIT_CONFIG_VALUE_\${_pi_n}=false"; _pi_n=$((_pi_n + 1)); done`;

function gitSafetyPrelude(): string {
  const configExports = READONLY_GIT_CONFIG.map(([key, value], index) => `export GIT_CONFIG_KEY_${index}=${key}; export GIT_CONFIG_VALUE_${index}='${value}'`).join('; ');
  const blocked = ['GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_ASKPASS', 'SSH_ASKPASS'].map((key) => `export ${key}=${DISABLED_GIT_HELPER}`).join('; ');
  return `_pi_apply_git_safety() { export GIT_CONFIG_COUNT=${READONLY_GIT_CONFIG.length}; ${configExports}; export GIT_EXTERNAL_DIFF=; ${blocked}; export GIT_TERMINAL_PROMPT=0; ${FILTER_DISABLE_SHELL}; export GIT_CONFIG_COUNT=$_pi_n; }\n_pi_apply_git_safety; `;
}

function readonlyProfileAssignment(): string {
  return `_pi_profile="(version 1)(allow default)(deny file-write*)(allow file-write* (literal \\"${DEV_NULL}\\"))(allow file-write* (subpath \\"$_pi_tmp\\"))"`;
}

function readonlySandboxInvocation(command: string, tempRoot: string): string {
  const template = shellQuote(`${tempRoot}/tmp.XXXXXX`);
  const quoted = shellQuote(command);
  const run = `TMPDIR="$_pi_tmp" ${SANDBOX_EXEC} -p "$_pi_profile" ${SANDBOX_SHELL} -c ${quoted}`;
  return `${gitSafetyPrelude()}_pi_tmp=$(mktemp -d ${template}) || exit 1; ${readonlyProfileAssignment()}; _pi_status=0; ${run} || _pi_status=$?; rm -rf "$_pi_tmp"; exit $_pi_status`;
}

/** Wraps a command in a macOS sandbox that denies filesystem writes except /dev/null and that command's temp directory. Git helper neutralization runs on every platform. */
export function sandboxReadOnlyCommand(command: string): string {
  const hardened = hardenReadOnlyGitCommand(command);
  if (process.platform === 'darwin' && existsSync(SANDBOX_EXEC)) {
    mkdirSync(READONLY_TEMP_ROOT, { recursive: true });
    return readonlySandboxInvocation(hardened, realpathSync(READONLY_TEMP_ROOT));
  }
  return `${gitSafetyPrelude()}${hardened}`;
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
