import { hasUnquotedRedirect, hasUnquotedShellExpansion, splitReadOnlyPipeline } from './readonly-shell.ts';

interface DenialRule {
  readonly label: string;
  readonly reason: string;
  readonly pattern: RegExp;
  readonly dangerousGitOption?: true;
}

interface AllowRule {
  readonly label: string;
  readonly reason: string;
  readonly pattern: RegExp;
}

export const READONLY_DENIAL_RULES: readonly DenialRule[] = [
  { label: 'rm', reason: 'removes files', pattern: /\brm\b/i },
  { label: 'rmdir', reason: 'removes directories', pattern: /\brmdir\b/i },
  { label: 'mv', reason: 'moves files', pattern: /\bmv\b/i },
  { label: 'cp', reason: 'copies files', pattern: /\bcp\b/i },
  { label: 'mkdir', reason: 'creates directories', pattern: /\bmkdir\b/i },
  { label: 'touch', reason: 'creates or updates files', pattern: /\btouch\b/i },
  { label: 'chmod', reason: 'changes permissions', pattern: /\bchmod\b/i },
  { label: 'chown', reason: 'changes ownership', pattern: /\bchown\b/i },
  { label: 'ln', reason: 'creates links', pattern: /\bln\b/i },
  { label: 'tee', reason: 'writes stdin to a file', pattern: /\btee\b/i },
  { label: 'truncate', reason: 'truncates files', pattern: /\btruncate\b/i },
  { label: 'dd', reason: 'writes raw data', pattern: /\bdd\b/i },
  { label: 'sudo', reason: 'escalates privileges', pattern: /\bsudo\b/i },
  { label: 'su', reason: 'switches user', pattern: /\bsu\b/i },
  { label: 'kill', reason: 'signals processes', pattern: /\bkill\b/i },
  { label: 'pkill', reason: 'signals processes by name', pattern: /\bpkill\b/i },
  { label: 'killall', reason: 'signals processes by name', pattern: /\bkillall\b/i },
  { label: 'npm-mutate', reason: 'changes npm packages', pattern: /\bnpm\s+(install|uninstall|update|ci|publish|link)\b/i },
  { label: 'yarn-mutate', reason: 'changes yarn packages', pattern: /\byarn\s+(add|remove|install|publish)\b/i },
  { label: 'pnpm-mutate', reason: 'changes pnpm packages', pattern: /\bpnpm\s+(add|remove|install|publish)\b/i },
  { label: 'bun-mutate', reason: 'changes bun packages', pattern: /\bbun\s+(add|remove|install|publish)\b/i },
  { label: 'pip-mutate', reason: 'changes Python packages', pattern: /\bpip\s+(install|uninstall)\b/i },
  { label: 'git-mutate', reason: 'changes the git repository', pattern: /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|cherry-pick|revert|stash|clean|branch\s+-[dDmM]|tag\s+-d)\b/i },
  { label: 'git-reflog-mutate', reason: 'expires or deletes reflog entries', pattern: /\bgit\s+reflog\s+(?:expire|delete)\b/i },
  { label: 'git-grep-pager', reason: 'git grep can launch a pager', pattern: /\bgit\s+grep\b.*(?:\s-[A-Za-z]*O|\s--(?:op|ope|open(?:-[a-z]*)*)(?:=|\s|$))/, dangerousGitOption: true },
  { label: 'git-ext-diff', reason: 'git can run an external diff or textconv', pattern: /\bgit\b.*\s--(?:ext-diff|textconv)\b/, dangerousGitOption: true },
  { label: 'sed-in-place', reason: 'sed edits files in place', pattern: /\bsed\b.*(?:\s-i\b|\s--in-place\b)/i },
  {
    label: 'sed-write',
    reason: 'sed can write to a file',
    pattern: /\bsed\b.*(?:\/[wWeE]\b|\/[wW]\S|s([^\\\s])(?:\\[\s\S]|.)*?\1(?:\\[\s\S]|.)*?\1[^\s'"\\]*[wWeE]|['"]\s*(?:[\d$,]*)[wWeE]\s|['";]\s*[\d$,]*[wW](?:\s|\/)|(?:^|\s)\d+[wW](?:\s|\/|$)|\b[wW]\s+\S|\s[wW]\S)/,
  },
  { label: 'script-file', reason: 'sed or awk can load a script file', pattern: /\b(?:sed|awk)\b.*(?:\s-f\b|\s--file\b)/ },
  { label: 'awk-redirect', reason: 'awk can redirect output to a file', pattern: /\bawk\b.*>/ },
  { label: 'uniq-output', reason: 'uniq can write a second output file', pattern: /\buniq\b(?:\s+--?\S+)*\s+\S+\s+\S+/ },
  { label: 'date-set', reason: 'date can set the system clock', pattern: /\bdate\b.*(?:\s-s\b|\s--set(?:=|\s|$))/ },
  { label: 'perl-in-place', reason: 'perl edits files in place', pattern: /\bperl\s+-i/i },
  { label: 'yq-in-place', reason: 'yq edits files in place', pattern: /\byq\b.*\s(?:-i|--inplace)(?:=|\s|$)/i },
  { label: 'yq-system', reason: 'yq can enable system operators', pattern: /\byq\b.*--security-enable(?:-[a-z-]*)?/i },
  { label: 'find-mutate', reason: 'find can delete or execute', pattern: /\bfind\b.*\s-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprint0|fprintf)\b/i },
  { label: 'fd-exec', reason: 'fd can execute a command', pattern: /\bfd\b.*\s(?:-x|-X|--exec|--exec-batch)(?:=|\s|$)/ },
  { label: 'rg-pre', reason: 'ripgrep can run a preprocessor', pattern: /\brg\b.*\s--pre(?:=|\s)/i },
  { label: 'awk-system', reason: 'awk can run system or getline', pattern: /\bawk\b.*\b(?:system|getline)\b/i },
  { label: 'awk-inplace', reason: 'awk can edit files in place', pattern: /\bawk\b.*\s-i\s+inplace\b/i },
  { label: 'awk-pipe', reason: 'awk can pipe to a command', pattern: /\bawk\b.*\|/ },
  { label: 'env-assign', reason: 'env can set variables before a command', pattern: /^\s*env\s+\S/i },
  { label: 'sort-compress', reason: 'sort can run a compress program', pattern: /\bsort\b.*\s--co(?:[a-z-]*)(?:=|\s|$)/i },
  { label: 'sort-output', reason: 'sort can write an output file', pattern: /\bsort\b.*\s(?:-o\S*|--o(?:[a-z]*)(?:=|\s|$))/i },
  { label: 'tree-output', reason: 'tree can write an output file', pattern: /\btree\b.*\s(?:-o\S*|--output(?:=|\s|$))/i },
  { label: 'git-output', reason: 'git can write an output file', pattern: /\bgit\b.*\s--output(?:=|\s)/i, dangerousGitOption: true },
  { label: 'git-help', reason: 'git help can run a viewer', pattern: /\bgit\b[^|;&\n]*\s--help\b/i, dangerousGitOption: true },
  { label: 'git-remote-show', reason: 'git remote show can contact a remote', pattern: /\bgit\s+remote\s+show\b/i, dangerousGitOption: true },
];

export const READONLY_ALLOW_RULES: readonly AllowRule[] = [
  { label: 'file-inspection', reason: 'reads files and process identity', pattern: /^\s*(cat|head|tail|wc|nl|file|stat|ls|ll|la|tree|pwd|which|whereis|type|realpath|readlink|basename|dirname|env|printenv|echo|printf|uname|whoami|id)\b/ },
  {
    label: 'date',
    reason: 'prints the date without setting the clock',
    pattern: /^\s*date(?:\s+(?:-[uR]|--utc|--universal|-d\s+(?:'[^']*'|"[^"]*"|\S+)|--date(?:=|\s)(?:'[^']*'|"[^"]*"|\S+)|\+\S+|'\+(?:[^'\\]|\\.)*'|"\+(?:[^"\\]|\\.)*"))*\s*$/,
  },
  { label: 'hostname', reason: 'prints the hostname', pattern: /^\s*hostname(?:\s+--?[A-Za-z0-9][-A-Za-z0-9]*)*\s*$/ },
  { label: 'text-processing', reason: 'filters or searches text', pattern: /^\s*(find|fd|rg|ripgrep|grep|egrep|fgrep|awk|sed|cut|sort|uniq|tr|jq|yq|diff|cmp|comm|md5|sha256sum|shasum)\b/ },
  { label: 'git-inspection', reason: 'inspects repository state', pattern: /^\s*git\s+(status|log|diff|show|rev-parse|describe|blame|ls-files|ls-tree|shortlog|reflog|grep|config\s+--get|config\s+--list)\b/ },
  { label: 'git-branch', reason: 'lists branches', pattern: /^\s*git\s+branch(?:\s+(?:-[arv]+|--list|--show-current))?\s*$/ },
  { label: 'git-tag', reason: 'lists tags', pattern: /^\s*git\s+tag(?:\s+-l(?:\s+\S+)?)?\s*$/ },
  { label: 'git-remote', reason: 'lists remotes', pattern: /^\s*git\s+remote(?:\s+(?:-v|show\s+\S+))?\s*$/ },
];

const DESTRUCTIVE_PATTERNS: readonly RegExp[] = READONLY_DENIAL_RULES.map((rule) => rule.pattern);
const DANGEROUS_GIT_OPTION_PATTERNS: readonly RegExp[] = READONLY_DENIAL_RULES.flatMap((rule) => (rule.dangerousGitOption === true ? [rule.pattern] : []));
const SAFE_READONLY_PREFIXES: readonly RegExp[] = READONLY_ALLOW_RULES.map((rule) => rule.pattern);

function normalizeCommandText(command: string): string {
  return command
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\x([0-9a-fA-F]{1,2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1')
    .replace(/["']/g, '');
}

export function hasDangerousGitOption(command: string): boolean {
  const normalized = normalizeCommandText(command);
  return DANGEROUS_GIT_OPTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isSingleReadOnlySegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = normalizeCommandText(trimmed);
  if (hasUnquotedRedirect(trimmed) || hasDangerousGitOption(trimmed) || hasUnquotedShellExpansion(trimmed) || DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(trimmed) || pattern.test(normalized))) {
    return false;
  }
  return SAFE_READONLY_PREFIXES.some((pattern) => pattern.test(trimmed));
}

export function matchesNormalizedDenial(command: string): boolean {
  const normalized = normalizeCommandText(command);
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isSafeReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  const segments = trimmed.length === 0 ? undefined : splitReadOnlyPipeline(trimmed);
  return segments !== undefined && segments.every(isSingleReadOnlySegment);
}
