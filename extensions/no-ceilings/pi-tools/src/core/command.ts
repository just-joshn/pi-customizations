/** Command analysis: tokenize shell words, unwrap nested invocations, and normalize before matching. */

const WRAPPERS = new Set(['env', 'command', 'nohup', 'time', 'exec', 'builtin']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+/;
const INLINE_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash']);

/** The form a rule should match: collapsed whitespace, no quoting, no subshell wrapper. */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

/**
 * Split shell words into their evaluated text. `''`, `""`, `$''`, `$""`, and backslash escapes are
 * removed the way a shell would remove them, so `echo sec''ret` and `echo "sec"ret` both read `secret`.
 */
function shellWords(segment: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote: '"' | "'" | undefined;
  let index = 0;
  const push = (): void => {
    if (word !== '') {
      words.push(word);
    }
    word = '';
  };
  while (index < segment.length) {
    let char = segment[index] ?? '';
    if (char === '\\' && quote !== "'") {
      word += segment[index + 1] ?? '';
      index += 2;
      continue;
    }
    if (char === '$' && (segment[index + 1] === '"' || segment[index + 1] === "'")) {
      char = segment[index + 1] ?? '';
      index += 2;
      quote = char as '"' | "'";
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else if (char === '`') {
        word += char;
      } else {
        word += char;
      }
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index++;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      index++;
      continue;
    }
    word += char;
    index++;
  }
  push();
  return words;
}

/** Strip subshell or grouping parentheses and redirections from a segment. */
function unwrapSegment(segment: string): string {
  let current = normalizeCommand(segment);
  const group = /^\(\s*([\s\S]*?)\s*\)\s*$/.exec(current);
  if (group?.[1] !== undefined) {
    current = normalizeCommand(group[1]);
  }
  return current;
}

/** Redirections (`> file`, `2>&1`, `< in`) removed before tokenization. */
function stripRedirects(segment: string): string {
  return segment
    .replace(/(?:\d+)?(?:>>?|<<?|<&)\s*(?:&?\d+|"[^"]*"|'[^']*'|[^\s]+)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Executable tokens of one segment, with assignments, wrappers, and their flags skipped. */
function executableTokens(segment: string): string[] {
  const tokens = shellWords(stripRedirects(segment)).map((token, index) => (index === 0 ? (token.split('/').pop() ?? token) : token));
  let index = 0;
  while (index < tokens.length && ASSIGNMENT.test(`${tokens[index]} `)) {
    index++;
  }
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (!WRAPPERS.has(token)) {
      break;
    }
    index++;
    while (index < tokens.length && tokens[index]?.startsWith('-') === true) {
      index++;
    }
    while (index < tokens.length && ASSIGNMENT.test(`${tokens[index]} `)) {
      index++;
    }
  }
  return tokens.slice(index);
}

/** Bodies of `$(...)` and backtick substitutions. */
function substitutionBodies(command: string): string[] {
  const bodies: string[] = [];
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '`') {
      const end = command.indexOf('`', index + 1);
      if (end === -1) {
        break;
      }
      bodies.push(command.slice(index + 1, end));
      index = end;
      continue;
    }
    if (char === '$' && command[index + 1] === '(') {
      const end = findClosingParen(command, index + 1);
      bodies.push(command.slice(index + 2, end === -1 ? command.length : end));
      index = end === -1 ? command.length : end;
    }
  }
  return bodies;
}

function findClosingParen(command: string, open: number): number {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let index = open; index < command.length; index++) {
    const char = command[index] ?? '';
    if (quote !== undefined) {
      if (char === quote && command[index - 1] !== '\\') {
        quote = undefined;
      }
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

/** Split on top-level `;`, `|`, `&`, and newlines, without cutting inside quotes or substitutions. */
export function splitCommand(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  const flush = (): void => {
    const trimmed = normalizeCommand(current);
    if (trimmed !== '') {
      segments.push(trimmed);
    }
    current = '';
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index] ?? '';
    if (quote === undefined && (char === '(' || char === ')')) {
      flush();
      continue;
    }
    if (char === '\\' && quote !== "'") {
      current += char + (command[index + 1] ?? '');
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
    if (char === ';' || char === '\n' || char === '|' || char === '&') {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return segments;
}

/** If the tokens are an inline shell invocation, return the inner command. */
function inlineShellBody(tokens: readonly string[]): string | undefined {
  const [head, ...rest] = tokens;
  if (head === undefined || !INLINE_SHELLS.has(head)) {
    return undefined;
  }
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index] ?? '';
    if (flag === '-c') {
      return rest.slice(index + 1).join(' ');
    }
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag)) {
      const inline = rest.slice(index + 1).join(' ');
      if (inline !== '') {
        return inline;
      }
    }
  }
  return undefined;
}

/** Nested command bodies an exec rule must also see. */
function nestedBodies(tokens: readonly string[]): string[] {
  const bodies: string[] = [];
  const shell = inlineShellBody(tokens);
  if (shell !== undefined && shell !== '') {
    bodies.push(shell);
  }
  const [head, ...rest] = tokens;
  if (head === 'eval' && rest.length > 0) {
    bodies.push(rest.join(' '));
  }
  return bodies;
}

/**
 * Every string an exec rule should see: the whole command, each segment's executable form, and the
 * bodies of nested shells, `eval`, and substitutions. Code a scanner cannot see, such as a script file
 * invoked by name, is out of reach.
 */
export function analyzeCommand(command: string): string[] {
  const seen = new Set<string>();
  const visit = (input: string, depth: number): void => {
    if (depth > 6) {
      return;
    }
    for (const segment of splitCommand(input)) {
      const unwrapped = unwrapSegment(segment);
      const tokens = executableTokens(unwrapped);
      const normalized = tokens.join(' ');
      if (normalized !== '') {
        seen.add(normalized);
      }
      for (const body of nestedBodies(tokens)) {
        visit(body, depth + 1);
      }
      for (const body of substitutionBodies(unwrapped)) {
        visit(body, depth + 1);
      }
    }
  };
  visit(command, 0);
  return [...seen];
}

/** Directory targets of every `cd`/`pushd`, including inside `sh -c`, subshells, and substitutions. */
export function directoryChanges(command: string): string[] {
  const targets: string[] = [];
  const visit = (input: string, depth: number): void => {
    if (depth > 6) {
      return;
    }
    for (const segment of splitCommand(input)) {
      const unwrapped = unwrapSegment(segment);
      const tokens = executableTokens(unwrapped);
      const [head, ...rest] = tokens;
      if (head === 'cd' || head === 'pushd') {
        const args = rest.filter((token) => !token.startsWith('-'));
        const target = args[0];
        if (target !== undefined && target !== '' && target !== '-' && !target.startsWith('$')) {
          targets.push(target);
        }
      }
      for (const body of nestedBodies(tokens)) {
        visit(body, depth + 1);
      }
      for (const body of substitutionBodies(unwrapped)) {
        visit(body, depth + 1);
      }
    }
  };
  visit(command, 0);
  return targets;
}

/** Environment variables a shell sources at startup, which a rule cannot see. */
export const SHELL_STARTUP_ENV = ['BASH_ENV', 'ENV'] as const;
