// A small POSIX-shell reader for policy checks. It splits a line into simple commands, keeps quoted text as one
// word so a commit message is never read as a command, and surfaces nested scripts ($(...), backticks, sh -c, eval).
export type SimpleCommand = { readonly words: readonly string[]; readonly redirects: readonly string[] };

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')']);

type Token = { readonly kind: 'word'; readonly text: string } | { readonly kind: 'separator' } | { readonly kind: 'redirect' };

type Read = { readonly text: string; readonly subs: readonly string[]; readonly end: number };

function matching(text: string, start: number, open: string, close: string): { readonly body: string; readonly end: number } {
  let depth = 1;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') index += 1;
    else if (char === open && open !== close) depth += 1;
    else if (char === close && --depth === 0) break;
    index += 1;
  }
  return { body: text.slice(start, index), end: index + 1 };
}

function startsSubstitution(text: string, index: number): boolean {
  return text[index] === '`' || (text[index] === '$' && text[index + 1] === '(');
}

function substitution(text: string, index: number): Read {
  const backtick = text[index] === '`';
  const found = backtick ? matching(text, index + 1, '`', '`') : matching(text, index + 2, '(', ')');
  return { text: '$()', subs: [found.body], end: found.end };
}

function doubleQuoted(text: string, start: number): Read {
  let index = start + 1;
  let value = '';
  let subs: readonly string[] = [];
  while (index < text.length && text[index] !== '"') {
    if (text[index] === '\\' && index + 1 < text.length) {
      value += text[index + 1];
      index += 2;
    } else if (startsSubstitution(text, index)) {
      const nested = substitution(text, index);
      value += nested.text;
      subs = [...subs, ...nested.subs];
      index = nested.end;
    } else {
      value += text[index];
      index += 1;
    }
  }
  return { text: value, subs, end: index + 1 };
}

function piece(text: string, index: number): Read {
  const char = text[index] ?? '';
  if (startsSubstitution(text, index)) return substitution(text, index);
  if (char === '"') return doubleQuoted(text, index);
  if (char === "'") {
    const close = text.indexOf("'", index + 1);
    const stop = close === -1 ? text.length : close;
    return { text: text.slice(index + 1, stop), subs: [], end: stop + 1 };
  }
  if (char === '\\') return { text: text[index + 1] ?? '', subs: [], end: index + 2 };
  return { text: char, subs: [], end: index + 1 };
}

const WORD_END = /[\s;&|()<>]/;

function word(text: string, start: number): Read {
  let index = start;
  let value = '';
  let subs: readonly string[] = [];
  while (index < text.length && !WORD_END.test(text[index] ?? '')) {
    const next = piece(text, index);
    value += next.text;
    subs = [...subs, ...next.subs];
    index = next.end;
  }
  return { text: value, subs, end: index };
}

function lex(text: string): { readonly tokens: readonly Token[]; readonly subs: readonly string[] } {
  const tokens: Token[] = [];
  const subs: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    if (char === '#' && (index === 0 || /\s/.test(text[index - 1] ?? ''))) {
      const close = text.indexOf('\n', index);
      index = close === -1 ? text.length : close;
    } else if (SEPARATORS.has(char)) {
      tokens.push({ kind: 'separator' });
      index += 1;
    } else if (/\s/.test(char)) index += 1;
    else if (char === '>' || char === '<') {
      const last = tokens.at(-1);
      if (last?.kind === 'word' && /^\d+$/.test(last.text)) tokens.pop();
      tokens.push({ kind: 'redirect' });
      index += 1;
      while (text[index] === '>' || text[index] === '&') index += 1;
    } else {
      const read = word(text, index);
      tokens.push({ kind: 'word', text: read.text });
      subs.push(...read.subs);
      index = read.end;
    }
  }
  return { tokens, subs };
}

const SEPARATOR: Token = { kind: 'separator' };

function parse(text: string): readonly SimpleCommand[] {
  const { tokens, subs } = lex(text.replace(/\\\r?\n/g, ' '));
  const commands: SimpleCommand[] = [];
  let words: string[] = [];
  let redirects: string[] = [];
  let redirecting = false;
  for (const token of [...tokens, SEPARATOR]) {
    if (token.kind === 'redirect') redirecting = true;
    else if (token.kind === 'word') {
      if (redirecting) redirects = [...redirects, token.text];
      else words = [...words, token.text];
      redirecting = false;
    } else {
      if (words.length > 0 || redirects.length > 0) commands.push({ words, redirects });
      words = [];
      redirects = [];
    }
  }
  return [...commands, ...subs.flatMap(parse)];
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const WRAPPERS: Readonly<Record<string, ReadonlySet<string>>> = {
  sudo: new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U']),
  env: new Set(['-u', '-C', '-S']),
  command: new Set(),
  exec: new Set(['-a']),
  nohup: new Set(),
  time: new Set(['-f', '-o']),
  nice: new Set(['-n']),
  xargs: new Set(['-I', '-n', '-P', '-L', '-d', '-s', '-E', '-a']),
  timeout: new Set(['-s', '-k']),
};

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

function base(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1);
}

function unwrap(words: readonly string[]): readonly string[] {
  let rest = words;
  for (;;) {
    while (rest[0] !== undefined && ASSIGNMENT.test(rest[0])) rest = rest.slice(1);
    const head = rest[0];
    const valued = head === undefined ? undefined : WRAPPERS[base(head)];
    if (head === undefined || valued === undefined) return rest;
    rest = rest.slice(1);
    while (rest[0] !== undefined && (rest[0].startsWith('-') || ASSIGNMENT.test(rest[0]))) rest = rest.slice(valued.has(rest[0]) ? 2 : 1);
    if (base(head) === 'timeout') rest = rest.slice(1);
  }
}

function expand(command: SimpleCommand, depth: number): readonly SimpleCommand[] {
  const words = unwrap(command.words);
  const head = words[0] === undefined ? '' : base(words[0]);
  const unwrapped = { words: [head, ...words.slice(1)].filter((word, index) => index > 0 || word !== ''), redirects: command.redirects };
  if (depth > 4) return [unwrapped];
  if (SHELLS.has(head)) {
    const flag = words.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));
    const script = flag === -1 ? undefined : words[flag + 1];
    if (script !== undefined) return [unwrapped, ...commandsOf(script, depth + 1)];
  }
  if (head === 'eval') return [unwrapped, ...commandsOf(words.slice(1).join(' '), depth + 1)];
  return [unwrapped];
}

export function commandsOf(line: string, depth = 0): readonly SimpleCommand[] {
  return parse(line).flatMap((command) => expand(command, depth));
}

// Words before `--` that are not options and not the value of an option in `valued`.
export function positionals(args: readonly string[], valued: ReadonlySet<string>): readonly string[] {
  const found: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? '';
    if (word === '--') return [...found, ...args.slice(index + 1)];
    if (valued.has(word)) index += 1;
    else if (!word.startsWith('-') || word === '-') found.push(word);
  }
  return found;
}

// A long flag (exact or `--flag=value`) or a short flag inside a cluster such as `-fu`, before `--`.
export function hasFlag(args: readonly string[], long: readonly string[], short: string): boolean {
  const end = args.indexOf('--');
  return (end === -1 ? args : args.slice(0, end)).some((word) => long.some((flag) => word === flag || word.startsWith(`${flag}=`)) || (short !== '' && /^-[A-Za-z]+$/.test(word) && word.includes(short)));
}
