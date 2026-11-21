import { ZERO } from './types.ts';

const SHELL_CHAIN_SPLIT = /(?:&&|\|\||[;|\n])+/;

const DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
  /\$\(/,
  /<\(/,
  /`/,
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /\bxargs\b/i,
  /\bfind\b[^;|\n]*\s-(?:delete|exec|execdir|ok|okdir|fls|fprint0?|fprintf)\b/i,
  /\bsort\b[^;|\n]*\s-o\b/i,
  /--output(?:=|\s)/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|uninstall|update|ci|link|publish|upgrade)\b/i,
  /\bpip3?\s+(?:install|uninstall)\b/i,
  /\b(?:apt(?:-get)?|brew)\s+(?:install|remove|purge|update|upgrade)\b/i,
  /\bgit\s+(?:add|commit|push|pull|merge|rebase|reset|checkout|switch|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone|clean)\b/i,
  /\b(?:sudo|su|kill|pkill|killall|reboot|shutdown)\b/i,
  /\b(?:systemctl|service)\s+.*\b(?:start|stop|restart|enable|disable)\b/i,
  /\b(?:vim?|nano|emacs|code|subl)\b/i,
  /\bawk\b[^;|\n]*\b(?:system|getline)\b/i,
  /\bsed\b[^;|\n]*(?:\bw|\d+w|\/w)\s+\S/i,
  /\bsed\s+-i/i,
];

const SAFE_READ_ONLY_PATTERNS: readonly RegExp[] = [
  /^\s*(?:cat|head|tail|less|more|grep|rg|find|fd|ls|eza|bat|pwd|echo|printf|wc|sort|uniq|diff|file|stat|du|df|tree|which|whereis|type|printenv|uname|whoami|id|date|cal|uptime|ps|jq|awk)\b/,
  /^\s*git\s+(?:status|log|diff|show|branch|remote|rev-parse|describe|ls-files|ls-tree|config\s+--get)\b/i,
  /^\s*(?:npm|pnpm|yarn|bun)\s+(?:list|ls|view|info|search|outdated|audit|why)\b/i,
  /^\s*(?:node|bun|python3?|tsc)\s+(?:--version|-v)\b/i,
  /^\s*env\s*$/,
  /^\s*sed\s+-n\b/i,
];

function isSafeSegment(segment: string): boolean {
  return SAFE_READ_ONLY_PATTERNS.some((pattern) => pattern.test(segment));
}

export function isSafeReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === ZERO) {
    return false;
  }
  if (DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }
  const segments = trimmed
    .split(SHELL_CHAIN_SPLIT)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > ZERO);
  return segments.length > ZERO && segments.every(isSafeSegment);
}
