import { type ExtensionAPI, type ExtensionFactory, isToolCallEventType, type ToolCallEvent } from '@earendil-works/pi-coding-agent';
import { READONLY_SUBAGENT_ERROR } from './types.ts';

const READONLY_BLOCKED_TOOLS = new Set(['write', 'edit', 'delete']);
const MCP_TOOL_PREFIX = 'mcp__';

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
  /(^|[^<])>(?!&)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|publish|link)\b/i,
  /\byarn\s+(add|remove|install|publish)\b/i,
  /\bpnpm\s+(add|remove|install|publish)\b/i,
  /\bbun\s+(add|remove|install|publish)\b/i,
  /\bpip\s+(install|uninstall)\b/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|cherry-pick|revert|stash|clean|branch\s+-[dDmM]|tag\s+-d)\b/i,
  /\bsed\s+-i/i,
  /\bsed\b.*(?:\/[wWeE]\b|\/[wW]\S|s([^\\\s]).*?\1.*?\1[wW]\S|['"]\s*(?:[\d$,]*)[wWeE]\s|\b[wW]\s+\S)/,
  /\bperl\s+-i/i,
  /\byq\b.*\s(?:-i|--inplace)(?:=|\s|$)/i,
  /\bfind\b.*\s-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprint0|fprintf)\b/i,
  /\bfd\b.*\s(?:-x|-X|--exec|--exec-batch)(?:=|\s|$)/,
  /\brg\b.*\s--pre(?:=|\s)/i,
  /\bawk\b.*\b(?:system|getline)\b/i,
  /\bawk\b.*\s-i\s+inplace\b/i,
  /^\s*env\s+\S/i,
  /\bsort\b.*\s(?:-o\S*|--output(?:=|\s|$))/i,
  /\bgit\b.*\s--output(?:=|\s)/i,
];

const SAFE_READONLY_PREFIXES: readonly RegExp[] = [
  /^\s*(cat|head|tail|less|more|wc|nl|file|stat|ls|ll|la|tree|pwd|which|whereis|type|realpath|readlink|basename|dirname|env|printenv|echo|printf|date|uname|whoami|id|hostname)\b/,
  /^\s*(find|fd|rg|ripgrep|grep|egrep|fgrep|ag|ack|awk|sed|cut|sort|uniq|tr|jq|yq|diff|cmp|comm|md5|sha256sum|shasum)\b/,
  /^\s*git\s+(status|log|diff|show|branch|tag|remote|rev-parse|describe|blame|ls-files|ls-tree|shortlog|reflog|config\s+--get|config\s+--list)\b/,
];

const SUBSHELL_OR_CHAIN_PATTERN = /(?:[\r\n]|;|&&|\|\||`|\$\(|<\()/;

function isSingleReadOnlySegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) {
    return false;
  }
  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }
  return SAFE_READONLY_PREFIXES.some((pattern) => pattern.test(trimmed));
}

export function isSafeReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || SUBSHELL_OR_CHAIN_PATTERN.test(trimmed)) {
    return false;
  }
  return trimmed.split('|').every(isSingleReadOnlySegment);
}

export function evaluateReadonlySubagentGuard(event: ToolCallEvent): { block: true; reason: string } | undefined {
  if (READONLY_BLOCKED_TOOLS.has(event.toolName) || event.toolName.startsWith(MCP_TOOL_PREFIX)) {
    return { block: true, reason: READONLY_SUBAGENT_ERROR };
  }
  if (isToolCallEventType('bash', event) && !isSafeReadOnlyCommand(event.input.command)) {
    return { block: true, reason: READONLY_SUBAGENT_ERROR };
  }
  return undefined;
}

export function createReadonlySubagentExtension(): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    pi.on('tool_call', async (event) => evaluateReadonlySubagentGuard(event));
  };
}
