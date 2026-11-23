/**
 * Command analysis: decode shell words the way a shell does, unwrap nested invocations, and report a
 * command the analyzer cannot see through instead of guessing at its spelling.
 *
 * The analyzer covers a known grammar: quoting, line continuation, ANSI-C escapes, assignments, a fixed
 * wrapper set, inline shells, `eval`, and substitutions. Reserved words are skipped so the body is visible.
 * Brace expansion and command substitutions are refused rather than guessed. Anything outside that grammar
 * is marked untrusted and the caller refuses the command, so a new spelling cannot slip past a rule.
 */
import { homedir, userInfo } from 'node:os';

/** Wrappers whose remaining arguments are the command, with the flags that consume a value. */
interface WrapperSpec {
  /** Flags that take no value. */
  readonly flags: readonly string[];
  /** Flags that consume the next argument. */
  readonly valueFlags: readonly string[];
  /** Positional arguments before the command (for example `timeout`'s duration). */
  readonly positional?: number;
}

const WRAPPERS: ReadonlyMap<string, WrapperSpec> = new Map([
  ['env', { flags: ['-i', '--ignore-environment', '-0', '--null', '-v', '--debug'], valueFlags: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'] }],
  ['command', { flags: ['-p', '--'], valueFlags: [] }],
  ['nohup', { flags: ['--'], valueFlags: [] }],
  ['time', { flags: ['-p', '-v', '--'], valueFlags: [] }],
  ['exec', { flags: ['-c', '-l', '--'], valueFlags: ['-a'] }],
  ['builtin', { flags: [], valueFlags: [] }],
  ['timeout', { flags: ['-v', '--preserve-status', '--foreground', '--'], valueFlags: ['-s', '--signal', '-k', '--kill-after'], positional: 1 }],
  ['nice', { flags: [], valueFlags: ['-n', '--adjustment'], positional: 0 }],
  ['stdbuf', { flags: ['--'], valueFlags: ['-i', '-o', '-e', '--input', '--output', '--error'] }],
  ['setsid', { flags: ['-f', '-w', '--'], valueFlags: [] }],
]);

/** Wrappers that run another command, which this analyzer does not follow. */
const INDIRECT = new Set(['sudo', 'doas', 'su', 'runuser', 'chroot', 'xargs', 'parallel', 'watch', 'script', 'caffeinate', 'strace', 'ltrace', 'chrt', 'taskset', 'numactl', 'eatmydata', 'fakeroot', 'firejail', 'bwrap']);

const INLINE_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'fish', 'csh', 'tcsh']);
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/;

/** Assignments that change how the shell finds, starts, or splits, so the analyzer cannot vouch for them. */
const RESOLUTION_ASSIGNMENTS = new Set(['CDPATH', 'BASH_ENV', 'ENV', 'IFS']);

/** Builtins that assign the same way a leading `NAME=value` does. */
const ASSIGNMENT_BUILTINS = new Set(['export', 'declare', 'typeset', 'readonly']);

/** Reserved words whose following words are the command that actually runs. */
const INTRODUCERS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{']);

/** Reserved words that carry no command of their own. The body is a later segment. */
const STRUCTURAL = new Set(['for', 'case', 'select', 'function', 'fi', 'done', 'esac', '}', 'in']);

/** Commands whose literal operands create or modify a file. `git` is intentionally absent. */
const WRITE_COMMANDS = new Set(['touch', 'mkdir', 'cp', 'mv', 'rm', 'dd', 'ln', 'tee', 'chmod', 'chown', 'truncate']);

/** Variables a `cd` target may name, resolved from the session instead of the shell. */
const DIR_VARIABLES = new Map([
  ['HOME', 'home'],
  ['PWD', 'cwd'],
  ['OLDPWD', 'cwd'],
]);

/** Environment variables a shell sources, or that redirect path resolution, which a rule cannot see. */
export const SHELL_STARTUP_ENV = ['BASH_ENV', 'ENV'] as const;

/** Variables removed from every spawned shell, so a rule verdict matches the command that runs. */
export const SHELL_ENV_SCRUB = [...SHELL_STARTUP_ENV, 'CDPATH', 'SHELLOPTS', 'BASHOPTS'] as const;

/** The form a rule should match: collapsed whitespace, no quoting, no subshell wrapper. */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

interface Word {
  /** The text the shell would use, with quoting removed and ANSI-C escapes decoded. */
  readonly value: string;
  /** False when an expansion contributed text this analyzer cannot know. */
  readonly literal: boolean;
  /** True when an unquoted command substitution or backtick contributed to the word. */
  readonly hidesCommand: boolean;
}

interface Lexed {
  readonly words: readonly Word[];
  readonly substitutions: readonly string[];
  readonly unbalanced: boolean;
  /** True when an unquoted brace expansion appears, which changes the words before they run. */
  readonly brace: boolean;
}

interface Redirect {
  readonly raw: string;
  readonly write: boolean;
  /** A `<<<` here-string carries data, but a substitution inside it still runs. */
  readonly hereString?: boolean;
}

/** Resolve a leading `~`, `~/`, or `~user`. Anything else is unchanged. */
function tildeTarget(value: string, home: string): { path: string; unknown?: string } | undefined {
  if (!value.startsWith('~')) {
    return undefined;
  }
  if (value === '~') {
    return { path: home };
  }
  if (value.startsWith('~/')) {
    return { path: `${home}/${value.slice(2)}` };
  }
  const slash = value.indexOf('/');
  const name = slash === -1 ? value.slice(1) : value.slice(1, slash);
  const rest = slash === -1 ? '' : value.slice(slash + 1);
  let username: string | undefined;
  let userHome: string | undefined;
  try {
    const info = userInfo();
    username = info.username;
    userHome = info.homedir;
  } catch {
    username = undefined;
  }
  if (username !== undefined && username !== '' && name === username && userHome !== undefined && userHome !== '') {
    return { path: rest === '' ? userHome : `${userHome}/${rest}` };
  }
  return { path: value, unknown: `the directory names ~${name}, which the analyzer cannot resolve` };
}

function literalPath(raw: string, home: string): { path?: string; unknown?: string } {
  const tilde = tildeTarget(raw, home);
  if (tilde === undefined) {
    return { path: raw };
  }
  return tilde.unknown === undefined ? { path: tilde.path } : { unknown: tilde.unknown };
}

/** Join a literal path onto the logical directory, keeping a relative path relative. */
function locate(raw: string, cwd: string | undefined): string {
  if (raw.startsWith('/')) {
    return raw;
  }
  if (cwd === undefined || cwd === '.' || cwd === '') {
    return raw;
  }
  return `${cwd.replace(/\/+$/, '')}/${raw}`;
}

/** True when `{` at `open` starts an unquoted brace expansion inside the current word. */
function opensBraceExpansion(segment: string, open: number): boolean {
  let depth = 0;
  let comma = false;
  let range = false;
  let quote: '"' | "'" | undefined;
  for (let index = open; index < segment.length; index++) {
    const char = segment[index] ?? '';
    if (quote !== undefined) {
      if (char === '\\' && quote === '"') {
        index++;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      return false;
    }
    if (char === '$' && segment[index + 1] === '{') {
      const close = segment.indexOf('}', index + 2);
      if (close === -1) {
        return false;
      }
      index = close;
      continue;
    }
    if (char === '{') {
      depth++;
      continue;
    }
    if (char === ',' && depth > 0) {
      comma = true;
      continue;
    }
    if (char === '.' && segment[index + 1] === '.' && depth > 0) {
      range = true;
      index++;
      continue;
    }
    if (char === '}') {
      depth--;
      if (depth === 0) {
        return comma || range;
      }
    }
  }
  return false;
}

/** Decode the escapes bash accepts inside `$'...'`. */
function decodeAnsiC(source: string): string {
  let out = '';
  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? '';
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = source[index + 1] ?? '';
    index++;
    switch (next) {
      case 'a':
        out += '\u0007';
        break;
      case 'b':
        out += '\b';
        break;
      case 'e':
      case 'E':
        out += '\u001b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'v':
        out += '\v';
        break;
      case 'x': {
        const hex = /^[0-9a-fA-F]{1,2}/.exec(source.slice(index + 1))?.[0];
        if (hex === undefined) {
          out += '\\x';
          break;
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        index += hex.length;
        break;
      }
      case 'u':
      case 'U': {
        const length = next === 'u' ? 4 : 8;
        const hex = new RegExp(`^[0-9a-fA-F]{1,${length}}`).exec(source.slice(index + 1))?.[0];
        if (hex === undefined) {
          out += `\\${next}`;
          break;
        }
        out += String.fromCodePoint(Number.parseInt(hex, 16));
        index += hex.length;
        break;
      }
      case 'c': {
        const control = source[index + 1] ?? '';
        out += control === '' ? '\\c' : String.fromCharCode(control.toUpperCase().charCodeAt(0) ^ 0x40);
        if (control !== '') {
          index++;
        }
        break;
      }
      default: {
        const octal = /^[0-7]{1,3}/.exec(next + source.slice(index + 1))?.[0];
        if (octal !== undefined && /^[0-7]/.test(next)) {
          out += String.fromCharCode(Number.parseInt(octal, 8));
          index += octal.length - 1;
          break;
        }
        // `\\`, `\'`, `\"`, and any other escaped character stand for themselves.
        out += next;
      }
    }
  }
  return out;
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
function findClosingParen(command: string, open: number): number {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let index = open; index < command.length; index++) {
    const char = command[index] ?? '';
    if (quote !== undefined) {
      if (char === '\\' && quote === '"') {
        index++;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Command bodies of unquoted `$(...)` and backticks in an expansion.
 * Single quotes hide them. Double quotes do not. Arithmetic is not a command, but a substitution inside it is.
 */
function commandSubstitutions(source: string): string[] {
  const found: string[] = [];
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? '';
    if (quote === "'") {
      if (char === "'") {
        quote = undefined;
      }
      continue;
    }
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '"') {
      quote = quote === '"' ? undefined : '"';
      continue;
    }
    if (char === "'" && quote === undefined) {
      quote = "'";
      continue;
    }
    if (char === '`') {
      const end = source.indexOf('`', index + 1);
      const stop = end === -1 ? source.length : end;
      found.push(source.slice(index + 1, stop));
      index = stop;
      continue;
    }
    if (char === '$' && source[index + 1] === '(') {
      const arithmetic = source[index + 2] === '(';
      const end = findClosingParen(source, index + 1);
      const stop = end === -1 ? source.length : end;
      if (arithmetic) {
        found.push(...commandSubstitutions(source.slice(index + 2, stop)));
      } else {
        found.push(source.slice(index + 2, stop));
      }
      index = stop;
      continue;
    }
  }
  return found;
}

/** Read an expansion starting at `$`, returning its source text and the index after it. */
function readExpansion(segment: string, start: number): { text: string; end: number } {
  const next = segment[start + 1] ?? '';
  if (next === '{') {
    const close = segment.indexOf('}', start + 2);
    const end = close === -1 ? segment.length : close + 1;
    return { text: segment.slice(start, end), end };
  }
  const name = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9@*#?$!-]/.exec(segment.slice(start + 1))?.[0];
  if (name === undefined) {
    return { text: '$', end: start + 1 };
  }
  return { text: `$${name}`, end: start + 1 + name.length };
}

/**
 * Lex one segment into words. Quoting is removed, ANSI-C escapes are decoded, and substitutions are
 * reported separately. A word that contains an expansion is marked non-literal.
 */
function lexSegment(segment: string): Lexed {
  const words: Word[] = [];
  const substitutions: string[] = [];
  let value = '';
  let literal = true;
  let hidesCommand = false;
  let started = false;
  let state: 'plain' | 'single' | 'double' | 'ansi' = 'plain';
  let unbalanced = false;
  let brace = false;

  const begin = (): void => {
    started = true;
  };
  const expansion = (text: string, command = false): void => {
    value += text;
    literal = false;
    if (command) {
      hidesCommand = true;
    }
    begin();
  };
  const push = (): void => {
    if (started) {
      words.push({ value, literal, hidesCommand });
    }
    value = '';
    literal = true;
    hidesCommand = false;
    started = false;
  };

  for (let index = 0; index < segment.length; index++) {
    const char = segment[index] ?? '';
    if (state === 'single') {
      if (char === "'") {
        state = 'plain';
      } else {
        value += char;
      }
      continue;
    }
    if (state === 'ansi') {
      if (char === '\\') {
        // One escape, which may span several characters: hex, unicode, octal, or control.
        const run = /^\\(?:x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|.)/.exec(segment.slice(index))?.[0] ?? '\\';
        value += decodeAnsiC(run);
        index += run.length - 1;
        continue;
      }
      if (char === "'") {
        state = 'plain';
        continue;
      }
      value += char;
      continue;
    }
    if (char === '\\') {
      const next = segment[index + 1] ?? '';
      // A backslash-newline is a line continuation outside single quotes, not a character of the word.
      if (next === '\n') {
        index++;
        continue;
      }
      if (state === 'double' && !['$', '`', '"', '\\', '\n'].includes(next)) {
        value += `\\${next}`;
      } else {
        value += next;
      }
      index++;
      begin();
      continue;
    }
    if (char === "'" && state === 'plain') {
      state = 'single';
      begin();
      continue;
    }
    if (char === '"') {
      state = state === 'double' ? 'plain' : 'double';
      begin();
      continue;
    }
    if (char === '$' && segment[index + 1] === "'" && state === 'plain') {
      state = 'ansi';
      index++;
      begin();
      continue;
    }
    if (char === '$' && segment[index + 1] === '"') {
      state = 'double';
      index++;
      begin();
      continue;
    }
    if (char === '$' && segment[index + 1] === '(') {
      const arithmetic = segment[index + 2] === '(';
      const end = findClosingParen(segment, index + 1);
      const stop = end === -1 ? segment.length : end;
      const body = segment.slice(index + 2, stop);
      const inners = arithmetic ? commandSubstitutions(body) : [];
      if (arithmetic && inners.length > 0) {
        substitutions.push(...inners);
      } else {
        substitutions.push(body);
      }
      expansion(segment.slice(index, stop + 1), !arithmetic || inners.length > 0);
      index = stop;
      continue;
    }
    if (char === '`') {
      const end = segment.indexOf('`', index + 1);
      const stop = end === -1 ? segment.length : end;
      substitutions.push(segment.slice(index + 1, stop));
      expansion(segment.slice(index, stop + 1), true);
      index = stop;
      continue;
    }
    if (char === '$') {
      const read = readExpansion(segment, index);
      const parameter = read.text.startsWith('${');
      const body = parameter ? read.text.slice(2, read.text.endsWith('}') ? -1 : undefined) : '';
      const inners = parameter ? commandSubstitutions(body) : [];
      substitutions.push(...inners);
      expansion(read.text, inners.length > 0);
      index = read.end - 1;
      continue;
    }
    if (state === 'plain' && /\s/.test(char)) {
      push();
      continue;
    }
    if (state === 'plain' && char === '{' && opensBraceExpansion(segment, index)) {
      brace = true;
    }
    value += char;
    begin();
  }
  if (state !== 'plain') {
    unbalanced = true;
  }
  push();
  return { words, substitutions, unbalanced, brace };
}

interface CommandSegment {
  readonly text: string;
  /** True when a top-level pipeline feeds this segment. */
  readonly piped: boolean;
}

/** Split on top-level `;`, `|`, `&`, and newlines, recording which segments a pipe feeds. */
function splitCommandSegments(command: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let current = '';
  let quote: '"' | "'" | 'ansi' | undefined;
  let piped = false;
  let pipedNext = false;
  const flush = (): void => {
    const trimmed = normalizeCommand(current);
    if (trimmed !== '') {
      segments.push({ text: trimmed, piped });
    }
    current = '';
    piped = pipedNext;
    pipedNext = false;
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index] ?? '';
    if (quote === 'ansi') {
      current += char;
      if (char === '\\') {
        current += command[index + 1] ?? '';
        index++;
      } else if (char === "'") {
        quote = undefined;
      }
      continue;
    }
    if (char === '\\' && quote !== "'") {
      const next = command[index + 1] ?? '';
      if (next === '\n') {
        index++;
        continue;
      }
      current += char + next;
      index++;
      continue;
    }
    if (quote !== undefined) {
      current += char;
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '$' && command[index + 1] === "'") {
      quote = 'ansi';
      current += "$'";
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '$' && command[index + 1] === '(') {
      const end = findClosingParen(command, index + 1);
      current += command.slice(index, end === -1 ? command.length : end + 1);
      index = end === -1 ? command.length : end;
      continue;
    }
    if (char === '`') {
      const end = command.indexOf('`', index + 1);
      if (end !== -1) {
        current += command.slice(index, end + 1);
        index = end;
        continue;
      }
    }
    if (quote === undefined && (char === '(' || char === ')')) {
      flush();
      continue;
    }
    if (char === ';' || char === '\n' || char === '|' || char === '&') {
      // `>&` and `<&` belong to a redirection, not to the command separator.
      const trimmed = current.trimEnd();
      if (char === '&' && (trimmed.endsWith('>') || trimmed.endsWith('<'))) {
        current += char;
        continue;
      }
      pipedNext = char === '|';
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return segments;
}

/** Split on top-level `;`, `|`, `&`, and newlines, without cutting inside quotes or substitutions. */
export function splitCommand(command: string): string[] {
  return splitCommandSegments(command).map((segment) => segment.text);
}

/** Index after one word that follows a redirect operator, respecting quotes and escapes. */
function skipRedirectTarget(segment: string, start: number): number {
  let index = start;
  while (index < segment.length && /\s/.test(segment[index] ?? '')) {
    index++;
  }
  while (index < segment.length) {
    const char = segment[index] ?? '';
    if (/\s/.test(char)) {
      return index;
    }
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      index++;
      while (index < segment.length) {
        const inner = segment[index] ?? '';
        if (inner === '\\' && char === '"') {
          index += 2;
          continue;
        }
        index++;
        if (inner === char) {
          break;
        }
      }
      continue;
    }
    if (char === '$' && segment[index + 1] === '(') {
      const end = findClosingParen(segment, index + 1);
      index = end === -1 ? segment.length : end + 1;
      continue;
    }
    if (char === '`') {
      const end = segment.indexOf('`', index + 1);
      index = end === -1 ? segment.length : end + 1;
      continue;
    }
    if (char === '$' && (segment[index + 1] === '"' || segment[index + 1] === "'")) {
      const quote = segment[index + 1];
      index += 2;
      while (index < segment.length) {
        const inner = segment[index] ?? '';
        if (inner === '\\') {
          index += 2;
          continue;
        }
        index++;
        if (inner === quote) {
          break;
        }
      }
      continue;
    }
    index++;
  }
  return index;
}

/** Redirections (`> file`, `2>&1`, `< in`) removed before tokenization, without touching quoted text. */
function stripRedirects(segment: string): { readonly text: string; readonly redirects: readonly Redirect[] } {
  let out = '';
  const redirects: Redirect[] = [];
  let index = 0;
  let quote: '"' | "'" | 'ansi' | undefined;
  while (index < segment.length) {
    const char = segment[index] ?? '';
    if (quote === 'ansi') {
      out += char;
      if (char === '\\') {
        out += segment[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (char === "'") {
        quote = undefined;
      }
      index++;
      continue;
    }
    if (quote !== undefined) {
      out += char;
      if (char === '\\' && quote === '"') {
        out += segment[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      index++;
      continue;
    }
    if (char === '\\') {
      out += char + (segment[index + 1] ?? '');
      index += 2;
      continue;
    }
    if (char === '$' && segment[index + 1] === '(') {
      const end = findClosingParen(segment, index + 1);
      const stop = end === -1 ? segment.length : end + 1;
      out += segment.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === '`') {
      const end = segment.indexOf('`', index + 1);
      const stop = end === -1 ? segment.length : end + 1;
      out += segment.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === '$' && (segment[index + 1] === '"' || segment[index + 1] === "'")) {
      quote = segment[index + 1] === '"' ? '"' : 'ansi';
      out += segment.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      index++;
      continue;
    }
    if (char === '<' || char === '>') {
      // A leading digit belongs to the operator (`2>`), not to a word.
      out = out.replace(/[0-9]+$/, '');
      const operatorStart = index;
      index++;
      while (index < segment.length && '<>&|'.includes(segment[index] ?? '')) {
        index++;
      }
      const operator = segment.slice(operatorStart, index);
      const attached = /^&?-?[0-9]+|^&/.exec(segment.slice(index))?.[0];
      if (attached !== undefined) {
        index += attached.length;
      } else {
        let targetStart = index;
        while (targetStart < segment.length && /\s/.test(segment[targetStart] ?? '')) {
          targetStart++;
        }
        index = skipRedirectTarget(segment, index);
        const raw = segment.slice(targetStart, index);
        // Here-documents name a delimiter, not a path. A here-string carries data but still runs
        // substitutions, so its target is scanned without being treated as a path.
        if (operator === '<<<') {
          redirects.push({ raw, write: false, hereString: true });
        } else if (!operator.includes('<<') && raw !== '') {
          redirects.push({ raw, write: operator.includes('>') });
        }
      }
      out += ' ';
      continue;
    }
    out += char;
    index++;
  }
  return { text: out, redirects };
}

/** Strip leading `NAME=value` assignments, reporting the names. */
function stripAssignments(words: readonly Word[]): { rest: readonly Word[]; names: readonly string[] } {
  const names: string[] = [];
  let index = 0;
  while (index < words.length) {
    const value = words[index]?.value ?? '';
    const match = ASSIGNMENT.exec(value);
    if (match?.[1] === undefined) {
      break;
    }
    names.push(match[1]);
    index++;
  }
  return { rest: words.slice(index), names };
}

/** Skip a wrapper's flags and positional arguments, returning the index of the command word. */
function skipWrapper(spec: WrapperSpec, words: readonly Word[]): number {
  let index = 0;
  let positional = spec.positional ?? 0;
  while (index < words.length) {
    const value = words[index]?.value ?? '';
    if (value === '--') {
      index++;
      break;
    }
    if (spec.valueFlags.includes(value)) {
      index += 2;
      continue;
    }
    const equals = /^(--[a-z-]+)=/.exec(value)?.[1];
    if (equals !== undefined && spec.valueFlags.includes(equals)) {
      index++;
      continue;
    }
    if (value.startsWith('-') && value !== '-') {
      // A flag that consumes a value is matched above; any other flag is positionless.
      index++;
      continue;
    }
    if (positional > 0) {
      positional--;
      index++;
      continue;
    }
    break;
  }
  return index;
}

/** The command word as a rule sees it: no directory, no quoting. */
function commandName(word: Word): string {
  const value = word.value;
  const slash = value.lastIndexOf('/');
  return slash === -1 ? value : value.slice(slash + 1);
}

/** Resolve a `cd` target, marking targets the analyzer cannot know. */
function directoryTarget(raw: string, home: string, cwd?: string): { target?: string; unknown?: string } {
  const value = raw.trim();
  if (value === '' || value === '-' || value === '.') {
    return { target: '.' };
  }
  const tilde = tildeTarget(value, home);
  if (tilde !== undefined) {
    return tilde.unknown === undefined ? { target: tilde.path } : { unknown: tilde.unknown };
  }
  const variable = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))(.*)$/.exec(value);
  if (variable !== null) {
    const name = variable[1] ?? variable[2] ?? '';
    const kind = DIR_VARIABLES.get(name);
    if (kind === undefined) {
      return { unknown: `the directory is set by $${name}, which the analyzer cannot resolve` };
    }
    const base = kind === 'home' ? home : cwd;
    const rest = variable[3] ?? '';
    if (rest !== '' && !rest.startsWith('/')) {
      return { unknown: `the directory mixes $${name} with other text` };
    }
    // Without a known earlier directory, `$PWD` is the spawn directory, so drop the leading slash.
    return { target: base === undefined ? rest.replace(/^\/+/, '') || '.' : `${base}${rest}` };
  }
  if (value.includes('$') || value.includes('`')) {
    return { unknown: 'the directory target is built by an expansion' };
  }
  return { target: value };
}

/** Name assigned by `export`, `declare`, `typeset`, or `readonly` when it is one the analyzer cannot vouch for. */
function resolutionAssignment(values: readonly string[]): string | undefined {
  for (const value of values) {
    if (value === '--' || (value.startsWith('-') && !ASSIGNMENT.test(value))) {
      continue;
    }
    const name = ASSIGNMENT.exec(value)?.[1];
    if (name !== undefined && RESOLUTION_ASSIGNMENTS.has(name)) {
      return name;
    }
  }
  return undefined;
}

/** True when `git -c` carries a config value that starts a shell command. The value may be attached or a separate word. */
function gitInlineShell(words: readonly Word[]): boolean {
  let index = 0;
  while (index < words.length) {
    const value = words[index]?.value ?? '';
    index++;
    let payload: string | undefined;
    if (value === '-c') {
      payload = words[index]?.value;
      index++;
    } else if (value.startsWith('-c') && !value.startsWith('--') && value.length > 2) {
      payload = value.slice(2);
    } else {
      continue;
    }
    if (payload === undefined || payload === '') {
      continue;
    }
    const eq = payload.indexOf('=');
    const configValue = eq === -1 ? words[index]?.value : payload.slice(eq + 1);
    if (eq === -1) {
      index++;
    }
    if (configValue !== undefined && configValue.startsWith('!')) {
      return true;
    }
  }
  return false;
}

export interface ShellPath {
  /** Spawn-relative or absolute literal path. */
  readonly path: string;
  /** True when this path is a write redirection or an operand of a writing command. */
  readonly write: boolean;
}

export interface ShellAnalysis {
  /** Every string an exec rule should see, in command order. */
  readonly segments: readonly string[];
  /** `cd` targets in order, already expanded where they are literal. */
  readonly directories: readonly string[];
  /** Literal path operands and redirection targets, in command order. */
  readonly paths: readonly ShellPath[];
  /** Why the command cannot be analyzed safely; the caller refuses it when set. */
  readonly untrusted?: string;
}

/**
 * Analyze a shell command. Segments cover each command the shell would run plus the bodies of inline
 * shells, `eval`, and substitutions. `untrusted` reports a construct the analyzer will not vouch for,
 * so the caller can refuse it instead of matching a spelling the shell does not use.
 */
export function analyzeShellCommand(command: string, home: string = homedir()): ShellAnalysis {
  const segments = new Set<string>();
  const directories: string[] = [];
  const paths: ShellPath[] = [];
  let untrusted: string | undefined;
  const distrust = (reason: string): void => {
    untrusted ??= reason;
  };
  const notePath = (raw: string, write: boolean, base: string | undefined): void => {
    const resolved = literalPath(raw, home);
    if (resolved.unknown !== undefined) {
      distrust(resolved.unknown);
      return;
    }
    if (resolved.path === undefined || resolved.path === '') {
      return;
    }
    paths.push({ path: locate(resolved.path, base), write });
  };
  const collectOperands = (name: string, args: readonly Word[], base: string | undefined): void => {
    if (name === 'git') {
      return;
    }
    let options = true;
    const positional: string[] = [];
    let targetDir: string | undefined;
    const takesTarget = name === 'cp' || name === 'mv' || name === 'ln';
    for (let index = 0; index < args.length; index++) {
      const word = args[index];
      if (word === undefined || !word.literal || word.hidesCommand) {
        continue;
      }
      const value = word.value;
      if (name === 'dd') {
        const io = /^(if|of)=(.+)$/.exec(value);
        if (io?.[2] !== undefined) {
          notePath(io[2], io[1] === 'of', base);
        }
        continue;
      }
      if (options && value === '--') {
        options = false;
        continue;
      }
      if (options && takesTarget && (value === '--target-directory' || value === '-t')) {
        const next = args[index + 1];
        if (next?.literal === true && next.hidesCommand !== true) {
          targetDir = next.value;
        }
        index++;
        continue;
      }
      if (options && takesTarget && value.startsWith('--target-directory=')) {
        targetDir = value.slice('--target-directory='.length);
        continue;
      }
      if (options && takesTarget && value.startsWith('-t') && value.length > 2) {
        targetDir = value.slice(2);
        continue;
      }
      if (options && value.startsWith('-') && value !== '-') {
        continue;
      }
      positional.push(value);
    }
    if (targetDir !== undefined) {
      notePath(targetDir, true, base);
      for (const value of positional) {
        notePath(value, name === 'mv', base);
        const slash = value.lastIndexOf('/');
        const baseName = slash === -1 ? value : value.slice(slash + 1);
        if (baseName !== '' && baseName !== '.' && baseName !== '..') {
          notePath(targetDir.endsWith('/') ? `${targetDir}${baseName}` : `${targetDir}/${baseName}`, true, base);
        }
      }
      return;
    }
    // `cp` reads its sources and writes the last operand. `mv` removes every operand. Every `ln`
    // operand is a write, because the source is the path a later use of the link would escape through.
    // `find -delete` writes the paths it was given.
    const findDelete = name === 'find' && args.some((word) => word.literal && word.value === '-delete');
    const write = WRITE_COMMANDS.has(name) || findDelete;
    for (const [index, value] of positional.entries()) {
      const isWrite = findDelete || name === 'ln' ? true : name === 'cp' ? index === positional.length - 1 : write;
      notePath(value, isWrite, base);
    }
  };

  const visit = (input: string, depth: number, cwd?: string): void => {
    if (depth > 6) {
      distrust('the command nests too deeply to analyze');
      return;
    }
    if (/(^|[;&|\n(])\s*(?:function\s+[A-Za-z_]|[A-Za-z_][A-Za-z0-9_-]*\s*\(\)\s*\{)/.test(input)) {
      distrust('the command defines a shell function, which the analyzer cannot see through');
    }
    for (const segment of splitCommandSegments(input)) {
      const stripped = stripRedirects(segment.text);
      const lexed = lexSegment(stripped.text);
      if (lexed.brace) {
        distrust('the command uses brace expansion, which the analyzer cannot see through');
      }
      if (lexed.unbalanced) {
        distrust('the command has an unterminated quote');
      }
      let redirectHides = false;
      for (const redirect of stripped.redirects) {
        const target = lexSegment(redirect.raw);
        if (target.brace) {
          distrust('the command uses brace expansion, which the analyzer cannot see through');
        }
        const word = target.words.length === 1 ? target.words[0] : undefined;
        if (word?.hidesCommand === true) {
          redirectHides = true;
          continue;
        }
        if (redirect.hereString === true) {
          continue;
        }
        if (word !== undefined && word.literal) {
          notePath(word.value, redirect.write, cwd);
        }
      }
      const { rest, names } = stripAssignments(lexed.words);
      for (const name of names) {
        if (RESOLUTION_ASSIGNMENTS.has(name)) {
          distrust(`${name} changes how the shell finds commands`);
        }
      }
      const words = [...rest];
      let headIndex = 0;
      for (;;) {
        const word = words[headIndex];
        if (word === undefined) {
          break;
        }
        const name = commandName(word);
        const spec = WRAPPERS.get(name);
        if (spec === undefined) {
          break;
        }
        if (name === 'command' && words.slice(headIndex + 1).some((candidate) => candidate.value === '-v' || candidate.value === '-V')) {
          break;
        }
        if (name === 'env' && words.slice(headIndex + 1).some((candidate) => candidate.value === '-S' || candidate.value === '--split-string' || candidate.value.startsWith('--split-string='))) {
          distrust('env -S splits a string into a command the analyzer does not follow');
          break;
        }
        if (name === 'env') {
          const chdir = words.findIndex((candidate, index) => index > headIndex && (candidate.value === '-C' || candidate.value === '--chdir' || candidate.value.startsWith('--chdir=') || candidate.value.startsWith('-C')));
          if (chdir !== -1) {
            const candidate = words[chdir]?.value ?? '';
            const value = candidate.startsWith('-C') && candidate !== '-C' ? candidate.slice(2) : candidate.includes('=') ? candidate.slice(candidate.indexOf('=') + 1) : (words[chdir + 1]?.value ?? '');
            const resolved = directoryTarget(value, home, cwd);
            if (resolved.unknown !== undefined) {
              distrust(resolved.unknown);
            } else if (resolved.target !== undefined && resolved.target !== '.') {
              directories.push(resolved.target);
              cwd = resolved.target.startsWith('/') ? resolved.target : `${cwd ?? '.'}/${resolved.target}`;
            }
          }
        }
        headIndex += 1 + skipWrapper(spec, words.slice(headIndex + 1));
        // `NAME=value` assignments may follow a wrapper (`env FOO=1 cmd`).
        while (ASSIGNMENT.test(words[headIndex]?.value ?? '')) {
          const assigned = ASSIGNMENT.exec(words[headIndex]?.value ?? '')?.[1];
          if (assigned !== undefined && RESOLUTION_ASSIGNMENTS.has(assigned)) {
            distrust(`${assigned} changes how the shell finds commands`);
          }
          headIndex++;
        }
      }
      while (words[headIndex]?.literal === true && INTRODUCERS.has(words[headIndex]?.value ?? '')) {
        headIndex++;
      }

      const head = words[headIndex];
      const structural = head !== undefined && head.literal && STRUCTURAL.has(head.value);
      if (head !== undefined && !structural) {
        const name = commandName(head);
        if (!head.literal) {
          distrust('the command word comes from an expansion');
        }
        const tail = words.slice(headIndex + 1).map((word) => word.value);
        segments.add([name, ...tail].join(' '));

        if (INDIRECT.has(name)) {
          distrust(`${name} runs a command the analyzer does not follow`);
        }
        if (name === 'alias' && tail.length > 0) {
          distrust('alias rebinds a command, which the analyzer cannot see through');
        }
        if (ASSIGNMENT_BUILTINS.has(name)) {
          const assigned = resolutionAssignment(tail);
          if (assigned !== undefined) {
            distrust(`${assigned} changes how the shell finds commands`);
          }
        }
        if (name === 'git' && gitInlineShell(words.slice(headIndex + 1))) {
          distrust('git -c runs a command the analyzer does not follow');
        }
        if (name === 'find' && tail.some((value) => ['-exec', '-execdir', '-ok', '-okdir'].includes(value))) {
          distrust('find -exec runs a command the analyzer does not follow');
        }
        if (INLINE_SHELLS.has(name)) {
          const inline = inlineShellBody([name, ...tail]);
          if (inline !== undefined && inline !== '') {
            visit(inline, depth + 1, cwd);
          } else if (segment.piped || segment.text.includes('<<') || /(^|\s)</.test(segment.text)) {
            distrust(`${name} reads a script from standard input, which the analyzer cannot see`);
          }
        }
        if (name === 'eval' && tail.length > 0) {
          const args = tail[0] === '--' ? tail.slice(1) : tail;
          if (args.length > 0) {
            visit(args.join(' '), depth + 1, cwd);
          }
        }
        collectOperands(name, words.slice(headIndex + 1), cwd);
        if (name === 'cd' || name === 'pushd') {
          const args = words
            .slice(headIndex + 1)
            .map((word) => word.value)
            .filter((value) => !value.startsWith('-') || value === '-');
          if (args.length === 0) {
            directories.push(home);
            cwd = home;
          } else {
            const resolved = directoryTarget(args[0] ?? '', home, cwd);
            if (resolved.unknown !== undefined) {
              distrust(resolved.unknown);
            } else if (resolved.target !== undefined) {
              directories.push(resolved.target);
              cwd = resolved.target.startsWith('/') ? resolved.target : `${cwd ?? '.'}/${resolved.target}`;
            }
          }
        }
      }
      if ((head === undefined || head.literal) && (lexed.words.some((word) => word.hidesCommand) || redirectHides)) {
        distrust('a command substitution hides the text the shell runs');
      }
      for (const body of lexed.substitutions) {
        visit(body, depth + 1, cwd);
      }
    }
  };

  visit(command, 0);
  return { segments: [...segments], directories, paths, ...(untrusted === undefined ? {} : { untrusted }) };
}

/** Every string an exec rule should see. */
export function analyzeCommand(command: string, home?: string): string[] {
  return [...analyzeShellCommand(command, home).segments];
}

/** Directory targets of every `cd`/`pushd`, including inside `sh -c`, subshells, and substitutions. */
export function directoryChanges(command: string, home?: string): string[] {
  return [...analyzeShellCommand(command, home).directories];
}

/** If the tokens are an inline shell invocation, return the inner command. */
function inlineShellBody(tokens: readonly string[]): string | undefined {
  const [head, ...rest] = tokens;
  if (head === undefined || !INLINE_SHELLS.has(head)) {
    return undefined;
  }
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index] ?? '';
    if (!/^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag)) {
      continue;
    }
    const body = rest[index + 1] === '--' ? rest.slice(index + 2) : rest.slice(index + 1);
    const inline = body.join(' ');
    if (flag === '-c' || inline !== '') {
      return inline;
    }
  }
  return undefined;
}
