import { DIFF_READ_SUBCOMMANDS, gitOptionWords, hasDangerousDiffFlag, hasPatchFlag, hasSafeDiffFlags, isAllowedDiffArgs } from './git-diff-guard.ts';
import { isAllowedTagArgs } from './git-tag-guard.ts';
import { hasBraceExpansion, isPathnameExpansionChar, startsShellExpansion } from './shell-expansions.ts';
import { ONE, TWO, ZERO } from './types.ts';

const SEGMENT_SEPARATORS = new Set<string>([';', '\n', '|', '&']);
const WHITESPACE = /\s/;
const DIGIT = /[0-9]/;
const SINGLE_QUOTE = "'";
const DOUBLE_QUOTE = '"';
const BACKSLASH = '\\';
const LESS_THAN = '<';
const GREATER_THAN = '>';
const DOLLAR = '$';
const OPEN_PAREN = '(';
const CLOSE_PAREN = ')';
const OPEN_BRACE = '{';
const EQUALS = '=';
const BACKTICK = '`';

/** Commands whose default behavior only reads. Per-command rules below remove the writing forms. */
const READ_ONLY_COMMANDS = new Set<string>([
  'cat',
  'head',
  'tail',
  'grep',
  'rg',
  'find',
  'fd',
  'ls',
  'eza',
  'bat',
  'pwd',
  'echo',
  'printf',
  'wc',
  'sort',
  'uniq',
  'diff',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'which',
  'whereis',
  'type',
  'printenv',
  'uname',
  'whoami',
  'id',
  'cal',
  'uptime',
  'ps',
  'jq',
  'sed',
]);

const GIT_READ_SUBCOMMANDS = new Set<string>(['log', 'diff', 'show', 'rev-parse', 'rev-list', 'describe', 'ls-files', 'ls-tree', 'shortlog', 'merge-base', 'cat-file', 'for-each-ref', 'diff-tree', 'name-rev', 'show-ref']);

/** Flags that make an otherwise read-only command write or execute. */
const DENIED_LONG_FLAGS: Readonly<Record<string, readonly string[]>> = {
  fd: ['--exec', '--exec-batch'],
  sort: ['--output', '--compress-program', '--temporary-directory'],
  rg: ['--pre', '--pre-glob', '--hostname-bin'],
  tree: ['--output'],
  sed: ['--in-place', '--file'],
  bat: ['--pager', '--config-file', '--generate-config-file'],
  file: ['--compile', '--preserve-date'],
};

/** Short options whose letter inside a cluster writes, runs a program, or names an unread script, as in `sort -nro out` or `sed -nf`. */
const DENIED_SHORT_LETTERS: Readonly<Record<string, readonly string[]>> = {
  sort: ['o', 'T'],
  tree: ['o'],
  fd: ['x', 'X'],
  file: ['C', 'p'],
};

/** Short options that are complete words and take a separate argument, as in `find -exec`. */
const DENIED_SHORT_WORDS: Readonly<Record<string, readonly string[]>> = {
  find: ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'],
};

const NETWORK_DEVICE_PATH = /\/dev\/(?:tcp|udp)(?:\/|$)/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SAFE_ENV_NAMES = new Set<string>(['LANG', 'LANGUAGE', 'TZ', 'TERM', 'COLORTERM', 'NO_COLOR', 'CLICOLOR', 'CLICOLOR_FORCE', 'FORCE_COLOR', 'COLUMNS', 'LINES']);

function isSafeEnvAssignment(word: string): boolean {
  const name = word.slice(ZERO, word.indexOf('='));
  return name.startsWith('LC_') || SAFE_ENV_NAMES.has(name);
}

interface LexedCommand {
  readonly segments: readonly (readonly string[])[];
  readonly safe: boolean;
}

/**
 * Split a command line into words and segments without a shell. Quotes and backslash escapes are
 * honored, and any output redirection, command substitution, or process substitution marks the
 * whole line unsafe. This is what makes `rg 'a>b'` readable and `echo x 1<> f` blocked.
 */
function lexCommand(command: string): LexedCommand {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = '';
  let hasWord = false;
  let quote: string | undefined;
  let safe = true;
  let index = ZERO;

  const endWord = (): void => {
    if (hasWord) {
      words = [...words, word];
      word = '';
      hasWord = false;
    }
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > ZERO) {
      segments.push(words);
      words = [];
    }
  };

  while (index < command.length) {
    const char = command[index] ?? '';
    if (quote === SINGLE_QUOTE) {
      if (char === SINGLE_QUOTE) {
        quote = undefined;
      } else {
        word += char;
        hasWord = true;
      }
      index += 1;
      continue;
    }
    if (char === BACKSLASH && quote !== SINGLE_QUOTE) {
      const next = command[index + 1];
      if (next === '\n') {
        // Bash removes a line continuation before it parses the command, which can join an expansion.
        const after = command[index + 2];
        if ((word.endsWith(DOLLAR) && startsShellExpansion(after)) || (word.endsWith(EQUALS) && after === OPEN_PAREN)) {
          safe = false;
        }
        index += 2;
        continue;
      }
      if (next !== undefined) {
        word += next;
        hasWord = true;
      }
      index += 2;
      continue;
    }
    if (quote === DOUBLE_QUOTE) {
      if (char === DOUBLE_QUOTE) {
        quote = undefined;
        index += 1;
        continue;
      }
      if (char === DOLLAR) {
        const next = command[index + 1];
        if (next !== DOUBLE_QUOTE && next !== SINGLE_QUOTE && startsShellExpansion(next)) {
          safe = false;
        }
      }
      if (char === BACKTICK) {
        safe = false;
      }
      word += char;
      hasWord = true;
      index += 1;
      continue;
    }
    if (char === DOLLAR && startsShellExpansion(command[index + 1])) {
      // Locale and ANSI-C quoting decode the argument, and parameter expansion runs before argv is fixed.
      safe = false;
    }
    if (char === OPEN_BRACE && hasBraceExpansion(command, index)) {
      safe = false;
    }
    if (char === OPEN_PAREN || char === CLOSE_PAREN) {
      safe = false;
    }
    if (char === EQUALS && command[index + 1] === OPEN_PAREN) {
      // zsh process substitution, also invalid in bash.
      safe = false;
    }
    if (isPathnameExpansionChar(char)) {
      // Unquoted pathname expansion can turn a filename into an option.
      safe = false;
    }
    if (char === SINGLE_QUOTE || char === DOUBLE_QUOTE) {
      quote = char;
      hasWord = true;
      index += 1;
      continue;
    }
    if (char === GREATER_THAN) {
      // `2>&1` and `>&2` duplicate a file descriptor, which writes nothing. Other `>` forms write.
      const fdTarget = command[index + 1] === '&' ? (command[index + 2] ?? '') : '';
      const afterFd = command[index + 3];
      if (DIGIT.test(fdTarget) && (afterFd === undefined || WHITESPACE.test(afterFd) || SEGMENT_SEPARATORS.has(afterFd))) {
        if (word.length > ZERO && !/^[0-9]+$/.test(word)) {
          endWord();
        } else {
          word += `>&${fdTarget}`;
          hasWord = true;
        }
        index += 3;
        continue;
      }
      safe = false;
    }
    if (char === BACKTICK) {
      safe = false;
    }
    if (char === DOLLAR && command[index + 1] === OPEN_PAREN) {
      safe = false;
    }
    if (char === LESS_THAN) {
      // Input redirects can hide argv shifts, process substitution, and network pseudo-files.
      safe = false;
      index += 1;
      continue;
    }
    if (char === '\n') {
      endSegment();
      index += 1;
      continue;
    }
    if (SEGMENT_SEPARATORS.has(char)) {
      endSegment();
      index += 1;
      continue;
    }
    if (WHITESPACE.test(char)) {
      endWord();
      index += 1;
      continue;
    }
    word += char;
    hasWord = true;
    index += 1;
  }
  endSegment();
  return { segments, safe };
}

function hasLongFlag(words: readonly string[], flags: readonly string[]): boolean {
  return words.some((word) => {
    if (!word.startsWith('--')) {
      return false;
    }
    const option = word.split('=')[0] ?? '';
    return option.length > TWO && flags.some((flag) => flag.startsWith(option));
  });
}

function hasShortLetter(words: readonly string[], letters: readonly string[]): boolean {
  return words.some((word) => word.startsWith('-') && !word.startsWith('--') && word.length > 1 && letters.some((letter) => word.slice(1).includes(letter)));
}

function hasExplicitLogFormat(words: readonly string[]): boolean {
  return words.some((word) => word === '--oneline' || word === '--format' || word.startsWith('--format=') || word === '--pretty' || word.startsWith('--pretty='));
}

function hasSignatureFormat(words: readonly string[]): boolean {
  return words.some((word) => word.includes('%G'));
}

function isAlwaysPagingValue(value: string | undefined): boolean {
  return value !== undefined && value.length >= TWO && 'always'.startsWith(value);
}

function hasBatForcedPager(words: readonly string[]): boolean {
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word === '--paging' || word === '--pag') {
      if (isAlwaysPagingValue(words[index + 1])) {
        return true;
      }
      continue;
    }
    if (word.startsWith('--paging=') || word.startsWith('--pag=')) {
      if (isAlwaysPagingValue(word.slice(word.indexOf('=') + 1))) {
        return true;
      }
    }
  }
  return false;
}

function hasExactWord(words: readonly string[], flags: readonly string[]): boolean {
  return words.some((word) => flags.includes(word));
}

/** `-e` ends the option cluster; the rest of that word is the sed script, not option letters. */
function hasDeniedSedOption(words: readonly string[]): boolean {
  return words.some((word) => {
    if (!word.startsWith('-') || word.startsWith('--')) {
      return false;
    }
    for (const letter of word.slice(1)) {
      if (letter === 'e') {
        return false;
      }
      if (letter === 'i' || letter === 'I' || letter === 'f') {
        return true;
      }
    }
    return false;
  });
}

function hasDeniedFlag(command: string, words: readonly string[]): boolean {
  const shortDenied = command === 'sed' ? hasDeniedSedOption(words) : hasShortLetter(words, DENIED_SHORT_LETTERS[command] ?? []);
  return hasLongFlag(words, DENIED_LONG_FLAGS[command] ?? []) || shortDenied || hasExactWord(words, DENIED_SHORT_WORDS[command] ?? []);
}

function skipBlank(script: string, start: number): number {
  let index = start;
  while (index < script.length && WHITESPACE.test(script[index] ?? '')) {
    index += 1;
  }
  return index;
}

/** Consume one required run of digits, or return -1 when it is missing. */
function skipDigits(script: string, start: number): number {
  if (!DIGIT.test(script[start] ?? '')) {
    return -1;
  }
  let index = start + 1;
  while (index < script.length && DIGIT.test(script[index] ?? '')) {
    index += 1;
  }
  return index;
}

function skipAddress(script: string, start: number, allowRelative = false): number {
  const char = script[start];
  if (char === undefined) {
    return start;
  }
  if (char === '/') {
    const close = scanToDelimiter(script, start + 1, '/');
    return close < ZERO ? -1 : close + 1;
  }
  if (char === BACKSLASH) {
    const delimiter = script[start + 1];
    const close = delimiter === undefined ? -1 : scanToDelimiter(script, start + 2, delimiter);
    return close < ZERO ? -1 : close + 1;
  }
  if (allowRelative && (char === '+' || char === '~')) {
    return skipDigits(script, start + 1);
  }
  if (DIGIT.test(char) || char === DOLLAR) {
    let index = start + 1;
    while (index < script.length && DIGIT.test(script[index] ?? '')) {
      index += 1;
    }
    if (script[index] === '~') {
      return skipDigits(script, index + 1);
    }
    return index;
  }
  return start;
}

/** Index of the closing delimiter, or -1 when the delimiter never closes on this line. */
function scanToDelimiter(script: string, start: number, delimiter: string): number {
  let index = start;
  while (index < script.length) {
    const char = script[index] ?? '';
    if (char === BACKSLASH) {
      index += 2;
      continue;
    }
    if (char === '\n') {
      return -1;
    }
    if (char === delimiter) {
      return index;
    }
    index += 1;
  }
  return -1;
}

/** Parse one `s`/`y` command, rejecting the write (`w`, `W`) and execute (`e`) flags. */
function skipSubstitution(script: string, start: number): number {
  const delimiter = script[start + 1];
  if (delimiter === undefined || delimiter === '\n' || delimiter === BACKSLASH) {
    return -1;
  }
  const patternEnd = scanToDelimiter(script, start + 2, delimiter);
  if (patternEnd < ZERO) {
    return -1;
  }
  const replacementEnd = scanToDelimiter(script, patternEnd + 1, delimiter);
  if (replacementEnd < ZERO) {
    return -1;
  }
  let index = replacementEnd + 1;
  let flags = '';
  while (index < script.length && !(script[index] === ';' || script[index] === '\n')) {
    flags += script[index] ?? '';
    index += 1;
  }
  return /[wWe]/.test(flags) ? -1 : index;
}

const SIMPLE_SED_COMMANDS = new Set<string>(['p', 'P', 'd', 'D', 'n', 'N', 'h', 'H', 'g', 'G', 'x', 'l', 'q', 'Q', 'z', '=', '{', '}']);
const TEXT_SED_COMMANDS = new Set<string>(['a', 'i', 'c']);
const READ_SED_COMMANDS = new Set<string>(['r', 'R']);

/**
 * Allow only the printing side of sed. A numeric address may be a `~` stride. The second address of a
 * range may be GNU `+N` or `~N`, with blanks around the comma. `s` and `y` are parsed far enough to
 * reject `w`, `W`, and `e`. `sed -n '/The word/p'` reads and `sed -n '/a/w out'` does not.
 */
function isSafeSedScript(script: string): boolean {
  let index = ZERO;
  while (index < script.length) {
    const char = script[index] ?? '';
    if (WHITESPACE.test(char) || char === ';') {
      index += 1;
      continue;
    }
    const firstAddress = skipAddress(script, index);
    if (firstAddress < ZERO) {
      return false;
    }
    index = skipBlank(script, firstAddress);
    if (script[index] === ',') {
      const secondStart = skipBlank(script, index + 1);
      const secondAddress = skipAddress(script, secondStart, true);
      if (secondAddress < ZERO || secondAddress === secondStart) {
        return false;
      }
      index = skipBlank(script, secondAddress);
    }
    if (script[index] === '!') {
      index += 1;
    }
    const command = script[index];
    if (command === undefined) {
      return true;
    }
    if (command === 's' || command === 'y') {
      index = skipSubstitution(script, index);
      if (index < ZERO) {
        return false;
      }
      continue;
    }
    if (SIMPLE_SED_COMMANDS.has(command)) {
      index += 1;
      while (index < script.length && DIGIT.test(script[index] ?? '')) {
        index += 1;
      }
      continue;
    }
    if (TEXT_SED_COMMANDS.has(command) || READ_SED_COMMANDS.has(command)) {
      const newline = script.indexOf('\n', index + 1);
      index = newline < ZERO ? script.length : newline + 1;
      continue;
    }
    return false;
  }
  return true;
}

function sedScripts(words: readonly string[]): readonly string[] | undefined {
  const scripts: string[] = [];
  let hasExpressionOption = false;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word === '--expression') {
      const value = words[index + 1];
      if (value !== undefined) {
        scripts.push(value);
      }
      hasExpressionOption = true;
      index += 1;
      continue;
    }
    if (word.startsWith('--expression=')) {
      scripts.push(word.slice('--expression='.length));
      hasExpressionOption = true;
      continue;
    }
    if (word.startsWith('-') && !word.startsWith('--')) {
      const cluster = word.slice(1);
      const expression = cluster.indexOf('e');
      if (expression >= ZERO) {
        const attached = cluster.slice(expression + 1);
        hasExpressionOption = true;
        if (attached.length > ZERO) {
          scripts.push(attached);
        } else {
          const value = words[index + 1];
          if (value !== undefined) {
            scripts.push(value);
          }
          index += 1;
        }
      }
      continue;
    }
    if (word.startsWith('--')) {
      return undefined;
    }
    if (word.startsWith('-')) {
      continue;
    }
    if (!hasExpressionOption && scripts.length === ZERO) {
      scripts.push(word);
    }
  }
  return scripts;
}

const BRANCH_DENIED_LONG = ['--delete', '--delete-merged', '--move', '--copy', '--force', '--set-upstream-to', '--unset-upstream', '--edit-description'];
const BRANCH_DENIED_SHORT = new Set<string>(['d', 'D', 'm', 'M', 'c', 'C', 'f', 'u']);

/** Git accepts unambiguous long-option prefixes, so every prefix of a denied option is denied too. */
function isAllowedBranchArgs(args: readonly string[]): boolean {
  const valueFlags = new Set(['--merged', '--no-merged', '--contains', '--points-at', '--sort', '--format', '--list']);
  let expectsValue = false;
  for (const arg of args) {
    const option = arg.split('=')[0] ?? '';
    if (arg.startsWith('--')) {
      if (BRANCH_DENIED_LONG.some((denied) => denied.startsWith(option))) {
        return false;
      }
    } else if (arg.startsWith('-') && arg.length > ONE) {
      if ([...arg.slice(1)].some((letter) => BRANCH_DENIED_SHORT.has(letter))) {
        return false;
      }
    }
    if (expectsValue) {
      expectsValue = false;
      continue;
    }
    if (arg.startsWith('-')) {
      expectsValue = valueFlags.has(option) && !arg.includes('=');
      continue;
    }
    return false;
  }
  return true;
}

function isAllowedGit(words: readonly string[]): boolean {
  // Skip the global options that only choose the repository or the pager.
  let subcommandIndex = 1;
  let noOptionalLocks = false;
  let fsmonitorOff = false;
  while (subcommandIndex < words.length) {
    const word = words[subcommandIndex];
    if (word === '-C') {
      subcommandIndex += 2;
      continue;
    }
    if (word === '--no-optional-locks') {
      noOptionalLocks = true;
      subcommandIndex += 1;
      continue;
    }
    if (word === '-c') {
      if (words[subcommandIndex + 1] !== 'core.fsmonitor=false') {
        return false;
      }
      fsmonitorOff = true;
      subcommandIndex += 2;
      continue;
    }
    if (word === '--no-pager' || word === '--paginate' || word === '-P') {
      subcommandIndex += 1;
      continue;
    }
    break;
  }
  const args = words.slice(subcommandIndex);
  const subcommand = args[0];
  if (subcommand === undefined) {
    return false;
  }
  if (args.slice(1).some((word) => word === '--output' || word.startsWith('--output='))) {
    return false;
  }
  if (subcommand === 'show') {
    const options = gitOptionWords(args.slice(1));
    if (hasSignatureFormat(options) || hasLongFlag(options, ['--show-signature']) || !hasLongFlag(options, ['--no-show-signature']) || !hasExplicitLogFormat(options)) {
      return false;
    }
  }
  if (subcommand === 'diff') {
    const options = gitOptionWords(args.slice(1));
    return noOptionalLocks && fsmonitorOff && (options.includes('--cached') || options.includes('--staged')) && isAllowedDiffArgs(args);
  }
  if (subcommand === 'diff-files' || subcommand === 'diff-index') {
    return false;
  }
  if (subcommand === 'ls-files') {
    return noOptionalLocks && fsmonitorOff;
  }
  if (subcommand === 'describe') {
    return noOptionalLocks && fsmonitorOff && !hasLongFlag(args.slice(1), ['--dirty', '--broken']);
  }
  if (subcommand === 'diff-tree') {
    const options = gitOptionWords(args.slice(1));
    return noOptionalLocks && fsmonitorOff && !hasLongFlag(options, ['--show-signature']) && !hasSignatureFormat(options) && isAllowedDiffArgs(args);
  }
  if (DIFF_READ_SUBCOMMANDS.has(subcommand)) {
    return isAllowedDiffArgs(args);
  }
  if (subcommand === 'log') {
    const flags = args.slice(1);
    const options = gitOptionWords(flags);
    return (
      hasLongFlag(options, ['--no-show-signature']) &&
      hasExplicitLogFormat(options) &&
      !hasLongFlag(options, ['--show-signature']) &&
      !hasSignatureFormat(options) &&
      !hasDangerousDiffFlag(flags) &&
      (!hasPatchFlag(flags) || hasSafeDiffFlags(flags))
    );
  }
  if (subcommand === 'rev-list') {
    const options = gitOptionWords(args.slice(1));
    return !hasSignatureFormat(options) && !hasLongFlag(options, ['--show-signature']);
  }
  if (subcommand === 'cat-file') {
    return !hasLongFlag(args.slice(1), ['--textconv', '--filters']);
  }
  if (GIT_READ_SUBCOMMANDS.has(subcommand)) {
    return true;
  }
  if (subcommand === 'config') {
    let index = 1;
    while (index < args.length) {
      const word = args[index];
      if (word === '--local' || word === '--global' || word === '--system' || word === '--worktree' || word === '--show-origin' || word === '--null') {
        index += 1;
        continue;
      }
      if (word === '--file' || word === '-f') {
        index += 2;
        continue;
      }
      break;
    }
    const flag = args[index];
    return flag === '--get' || flag === '--get-all' || flag === '--get-regexp' || flag === '--get-urlmatch' || flag === '--list' || flag === '-l';
  }
  if (subcommand === 'grep') {
    const flags = args.slice(1);
    return noOptionalLocks && fsmonitorOff && !hasLongFlag(flags, ['--textconv', '--open-files-in-pager']) && !flags.some((arg) => arg.startsWith('-') && !arg.startsWith('--') && arg.slice(ONE).includes('O'));
  }
  if (subcommand === 'branch') {
    return isAllowedBranchArgs(args.slice(1));
  }
  if (subcommand === 'remote') {
    const verb = args[1];
    if (verb === '-v' || verb === '--verbose') {
      return args.length === TWO;
    }
    return verb === undefined || verb === 'get-url';
  }
  if (subcommand === 'stash') {
    if (args[1] === 'list') {
      const flags = args.slice(TWO);
      return !hasDangerousDiffFlag(flags) && (!hasPatchFlag(flags) || hasSafeDiffFlags(flags));
    }
    if (args[1] !== 'show') {
      return false;
    }
    const flags = args.slice(TWO);
    return !hasDangerousDiffFlag(flags) && (!hasPatchFlag(flags) || hasSafeDiffFlags(flags));
  }
  if (subcommand === 'worktree') {
    return args[1] === 'list';
  }
  if (subcommand === 'tag') {
    return isAllowedTagArgs(args.slice(1));
  }
  return false;
}

const UNIQ_VALUE_FLAGS = new Set<string>(['-f', '--skip-fields', '-s', '--skip-chars', '-w', '--check-chars']);

function isAllowedUniqArgs(words: readonly string[]): boolean {
  let positional = ZERO;
  let expectsValue = false;
  let options = true;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (expectsValue) {
      expectsValue = false;
      continue;
    }
    if (options && word === '--') {
      options = false;
      continue;
    }
    if (options && word.startsWith('-') && word !== '-') {
      if (UNIQ_VALUE_FLAGS.has(word)) {
        expectsValue = true;
        continue;
      }
      if (!word.startsWith('--')) {
        const last = word.at(-1);
        if (last === 'f' || last === 's' || last === 'w') {
          expectsValue = true;
        }
      }
      continue;
    }
    positional += 1;
    options = false;
  }
  return positional <= ONE;
}

function isAllowedSegment(words: readonly string[]): boolean {
  if (words.some((word) => NETWORK_DEVICE_PATH.test(word))) {
    return false;
  }
  let commandIndex = ZERO;
  while (commandIndex < words.length && ENV_ASSIGNMENT.test(words[commandIndex] ?? '')) {
    if (!isSafeEnvAssignment(words[commandIndex] ?? '')) {
      return false;
    }
    commandIndex += 1;
  }
  if (commandIndex >= words.length) {
    return false;
  }
  const args = words.slice(commandIndex);
  const command = args[ZERO];
  if (command === undefined) {
    return false;
  }
  if (command === 'git') {
    return isAllowedGit(args);
  }
  if (command === 'env') {
    return args.length === 1;
  }
  if (command === 'node' || command === 'tsc') {
    return args.length === TWO && (args[1] === '--version' || args[1] === '-v');
  }
  if (command === 'python' || command === 'python3') {
    return args.length === TWO && (args[1] === '--version' || args[1] === '-V');
  }
  if (command === 'bun') {
    if (args.length === TWO && (args[1] === '--version' || args[1] === '-v')) {
      return true;
    }
    const verb = args[1];
    if (verb === 'audit') {
      return !args.slice(TWO).some((word) => word === 'fix' || word === '--fix' || word.startsWith('--fix='));
    }
    return verb === 'list' || verb === 'info' || verb === 'outdated' || verb === 'why';
  }
  if (command === 'npm' || command === 'pnpm' || command === 'yarn') {
    if (args.length === TWO && (args[1] === '--version' || args[1] === '-v')) {
      return true;
    }
    const verb = args[1];
    if (verb === 'audit') {
      return !args.slice(TWO).some((word) => word === 'fix' || word === '--fix' || word.startsWith('--fix='));
    }
    return verb === 'list' || verb === 'ls' || verb === 'view' || verb === 'info' || verb === 'search' || verb === 'outdated' || verb === 'why';
  }
  if (!READ_ONLY_COMMANDS.has(command)) {
    return false;
  }
  if (command === 'bat' && (args[ONE] === 'cache' || hasBatForcedPager(args))) {
    return false;
  }
  if (hasDeniedFlag(command, args.slice(1))) {
    return false;
  }
  if (command === 'sed') {
    const scripts = sedScripts(args);
    return scripts !== undefined && scripts.every(isSafeSedScript);
  }
  if (command === 'uniq') {
    return isAllowedUniqArgs(args);
  }
  return true;
}

export function isSafeReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === ZERO) {
    return false;
  }
  const lexed = lexCommand(trimmed);
  if (!lexed.safe || lexed.segments.length === ZERO) {
    return false;
  }
  return lexed.segments.every(isAllowedSegment);
}
