import { skipWhitespace } from './readonly-shell.ts';

const DISABLED_GIT_HELPER = '/usr/bin/false';
const GIT_NO_HELPER_FLAGS = '--no-ext-diff --no-textconv';
const GIT_DIFF_COMMANDS = ['diff', 'log', 'show', 'blame', 'reflog'] as const;
const BLOCKED_GIT_ENV = ['GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_ASKPASS', 'SSH_ASKPASS'] as const;

const READONLY_GIT_CONFIG: readonly (readonly [string, string])[] = [
  ['core.fsmonitor', 'false'],
  ['diff.external', ''],
  ['core.pager', 'cat'],
  ['credential.helper', ''],
  ['core.attributesFile', '/dev/null'],
  ['protocol.ext.allow', 'never'],
  ['log.showSignature', 'false'],
  ['gpg.program', DISABLED_GIT_HELPER],
  ['gpg.openpgp.program', DISABLED_GIT_HELPER],
  ['gpg.x509.program', DISABLED_GIT_HELPER],
  ['gpg.ssh.program', DISABLED_GIT_HELPER],
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
export function hardenReadOnlyGitCommand(command: string): string {
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

const FILTER_BINDINGS: readonly (readonly [string, string])[] = [
  ['clean', '/bin/cat'],
  ['smudge', '/bin/cat'],
  ['process', ''],
  ['required', 'false'],
];

// Runtime shell text. Filter discovery depends on these patterns byte for byte.
const FILTER_KEY_REGEXP = '^filter..*.(clean|smudge|process)$';
const FILTER_KEY_TRIM = 's/[[:space:]].*//; s/.[^.]*$//';

function shellJoin(statements: readonly string[]): string {
  return statements.join('; ');
}

function attributeSourceProbe(): string {
  const emptyTree = '_pi_empty=$(git -c core.fsmonitor=false hash-object -t tree --stdin </dev/null 2>/dev/null || true)';
  const publishSource = 'case $_pi_empty in [0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) export GIT_ATTR_SOURCE=$_pi_empty ;; esac';
  return shellJoin([emptyTree, publishSource]);
}

function discoveredFilterDrivers(configCount: number): string {
  const count = `_pi_n=${configCount}`;
  const query = `_pi_drivers=$(git -c core.fsmonitor=false config --get-regexp '${FILTER_KEY_REGEXP}' 2>/dev/null | sed '${FILTER_KEY_TRIM}' | sort -u || true)`;
  return shellJoin([count, query]);
}

function filterBinding(suffix: string, value: string): readonly string[] {
  const key = `export "GIT_CONFIG_KEY_\${_pi_n}=\${_pi_driver}.${suffix}"`;
  const configValue = `export "GIT_CONFIG_VALUE_\${_pi_n}=${value}"`;
  const increment = '_pi_n=$((_pi_n + 1))';
  return [key, configValue, increment];
}

function filterDriverLoop(): string {
  const guard = 'case $_pi_driver in filter.*) ;; *) continue ;; esac';
  const bindings = FILTER_BINDINGS.flatMap(([suffix, value]) => filterBinding(suffix, value));
  const body = shellJoin([guard, ...bindings]);
  return `for _pi_driver in $_pi_drivers; do ${body}; done`;
}

function filterDisableShell(configCount: number): string {
  return shellJoin([attributeSourceProbe(), discoveredFilterDrivers(configCount), filterDriverLoop()]);
}

function configExport(key: string, value: string, index: number): string {
  const configKey = `export GIT_CONFIG_KEY_${index}=${key}`;
  const configValue = `export GIT_CONFIG_VALUE_${index}='${value}'`;
  return `${configKey}; ${configValue}`;
}

function gitSafetyBody(configCount: number, configExports: string, blocked: string, filters: string): string {
  const header = `export GIT_CONFIG_COUNT=${configCount}; ${configExports}`;
  const helpers = `export GIT_EXTERNAL_DIFF=; ${blocked}; export GIT_TERMINAL_PROMPT=0`;
  const tail = `${filters}; export GIT_CONFIG_COUNT=$_pi_n;`;
  return `${header}; ${helpers}; ${tail}`;
}

export function gitSafetyPrelude(): string {
  const configExports = READONLY_GIT_CONFIG.map(([key, value], index) => configExport(key, value, index)).join('; ');
  const blocked = BLOCKED_GIT_ENV.map((key) => `export ${key}=${DISABLED_GIT_HELPER}`).join('; ');
  const filters = filterDisableShell(READONLY_GIT_CONFIG.length);
  const body = gitSafetyBody(READONLY_GIT_CONFIG.length, configExports, blocked, filters);
  return `_pi_apply_git_safety() { ${body} }\n_pi_apply_git_safety; `;
}
