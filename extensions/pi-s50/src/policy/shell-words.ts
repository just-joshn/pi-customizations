// A small POSIX-shell reader for policy checks. It splits a line into simple commands, keeps quoted text as one
// word so a commit message is never read as a command, and surfaces nested scripts ($(...), backticks, sh -c, eval).
export type SimpleCommand = { readonly words: readonly string[]; readonly redirects: readonly string[] };

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')']);

type Reader = { readonly text: string; index: number };

function closing(reader: Reader, open: string, close: string): string {
  const start = reader.index;
  let depth = 1;
  while (reader.index < reader.text.length) {
    const char = reader.text[reader.index];
    if (char === '\\') reader.index += 1;
    else if (char === open && open !== close) depth += 1;
    else if (char === close && --depth === 0) break;
    reader.index += 1;
  }
  const body = reader.text.slice(start, reader.index);
  reader.index += 1;
  return body;
}

function parse(text: string): readonly SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  const nested: string[] = [];
  let words: string[] = [];
  let redirects: string[] = [];
  let word: string | null = null;
  let redirecting = false;
  const reader: Reader = { text: text.replace(/\\\r?\n/g, ' '), index: 0 };
  const endWord = (): void => {
    if (word === null) return;
    if (redirecting) redirects = [...redirects, word];
    else words = [...words, word];
    word = null;
    redirecting = false;
  };
  const endCommand = (): void => {
    endWord();
    if (words.length > 0 || redirects.length > 0) commands.push({ words, redirects });
    words = [];
    redirects = [];
  };
  const substitution = (): void => {
    if (reader.text.startsWith('$(', reader.index)) {
      reader.index += 2;
      nested.push(closing(reader, '(', ')'));
    } else {
      reader.index += 1;
      nested.push(closing(reader, '`', '`'));
    }
    word = `${word ?? ''}$()`;
  };
  while (reader.index < reader.text.length) {
    const char = reader.text[reader.index] ?? '';
    if (char === '$' && reader.text[reader.index + 1] === '(') substitution();
    else if (char === '`') substitution();
    else if (char === "'") {
      reader.index += 1;
      const end = reader.text.indexOf("'", reader.index);
      const stop = end === -1 ? reader.text.length : end;
      word = `${word ?? ''}${reader.text.slice(reader.index, stop)}`;
      reader.index = stop + 1;
    } else if (char === '"') {
      reader.index += 1;
      let quoted = '';
      while (reader.index < reader.text.length && reader.text[reader.index] !== '"') {
        const inner = reader.text[reader.index] ?? '';
        if (inner === '\\' && reader.index + 1 < reader.text.length) {
          quoted += reader.text[reader.index + 1];
          reader.index += 2;
        } else if (inner === '`' || (inner === '$' && reader.text[reader.index + 1] === '(')) {
          word = `${word ?? ''}${quoted}`;
          quoted = '';
          substitution();
        } else {
          quoted += inner;
          reader.index += 1;
        }
      }
      word = `${word ?? ''}${quoted}`;
      reader.index += 1;
    } else if (char === '\\') {
      word = `${word ?? ''}${reader.text[reader.index + 1] ?? ''}`;
      reader.index += 2;
    } else if (char === '#' && word === null) {
      const end = reader.text.indexOf('\n', reader.index);
      reader.index = end === -1 ? reader.text.length : end;
    } else if (/\s/.test(char) && char !== '\n') {
      endWord();
      reader.index += 1;
    } else if (SEPARATORS.has(char)) {
      endCommand();
      reader.index += 1;
    } else if (char === '>' || char === '<') {
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      reader.index += 1;
      while (reader.text[reader.index] === '>' || reader.text[reader.index] === '&') reader.index += 1;
      redirecting = true;
    } else {
      word = `${word ?? ''}${char}`;
      reader.index += 1;
    }
  }
  endCommand();
  return [...commands, ...nested.flatMap(parse)];
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
