import { rstrip } from '../support/pystr.ts';

/** The characters Python's Unicode `\s` matches, which is exactly `str.isspace()`. */
const S = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
/** Python's `[^\S\r\n]`: whitespace other than CR and LF. */
const H = '\\t\\v\\f\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

const unicodeSticky = (source: string): RegExp => new RegExp(source, 'uy');

/** python-dotenv's token patterns, sticky so each match starts at the reader's position. */
const patterns = {
  multilineWhitespace: unicodeSticky(`[${S}]*`),
  whitespace: unicodeSticky(`[${H}]*`),
  export: unicodeSticky(`(?:export[${H}]+)?`),
  singleQuotedKey: /'([^']+)'/uy,
  unquotedKey: unicodeSticky(`([^=#${S}]+)`),
  equalSign: unicodeSticky(`(=[${H}]*)`),
  singleQuotedValue: /'((?:\\'|[^'])*)'/uy,
  doubleQuotedValue: /"((?:\\"|[^"])*)"/uy,
  unquotedValue: /([^\r\n]*)/uy,
  comment: unicodeSticky(`(?:[${H}]*#[^\\r\\n]*)?`),
  endOfLine: unicodeSticky(`[${H}]*(?:\\r\\n|\\n|\\r|$)`),
  restOfLine: /[^\r\n]*(?:\r|\n|\r\n)?/uy,
};

const DOUBLE_QUOTE_ESCAPES = /\\[\\'"abfnrtv]/g;
const SINGLE_QUOTE_ESCAPES = /\\[\\']/g;
const ESCAPES: Record<string, string> = { '\\\\': '\\', "\\'": "'", '\\"': '"', '\\a': '\x07', '\\b': '\b', '\\f': '\f', '\\n': '\n', '\\r': '\r', '\\t': '\t', '\\v': '\v' };
const UNQUOTED_COMMENT = new RegExp(`[${S}]+#[^\\n]*`, 'gu');
const VARIABLE = /\$\{([^}:]*)(?::-([^}]*))?\}/g;

class ParseError extends Error {}

/** python-dotenv's `Reader`: a cursor over the whole file. */
class Reader {
  position = 0;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  peek(count: number): string {
    return this.text.slice(this.position, this.position + count);
  }

  readRegex(shared: RegExp): string[] {
    const pattern = new RegExp(shared.source, shared.flags);
    pattern.lastIndex = this.position;
    const match = pattern.exec(this.text);
    if (match === null) throw new ParseError('read_regex: Pattern not found');
    this.position += match[0].length;
    return match.slice(1).map((group) => group ?? '');
  }

  rewind(position: number): void {
    this.position = position;
  }
}

const decodeEscapes = (pattern: RegExp, text: string): string => text.replace(pattern, (sequence) => ESCAPES[sequence] ?? sequence);

function parseKey(reader: Reader): string | null {
  const char = reader.peek(1);
  if (char === '#') return null;
  const [key = ''] = reader.readRegex(char === "'" ? patterns.singleQuotedKey : patterns.unquotedKey);
  return key;
}

function parseValue(reader: Reader): string {
  const char = reader.peek(1);
  if (char === "'") return decodeEscapes(SINGLE_QUOTE_ESCAPES, reader.readRegex(patterns.singleQuotedValue)[0] ?? '');
  if (char === '"') return decodeEscapes(DOUBLE_QUOTE_ESCAPES, reader.readRegex(patterns.doubleQuotedValue)[0] ?? '');
  if (char === '' || char === '\n' || char === '\r') return '';
  return rstrip((reader.readRegex(patterns.unquotedValue)[0] ?? '').replace(UNQUOTED_COMMENT, ''));
}

type Binding = { readonly key: string | null; readonly value: string | null };

function parseBinding(reader: Reader): Binding {
  const mark = reader.position;
  try {
    reader.readRegex(patterns.multilineWhitespace);
    if (reader.position >= reader.text.length) return { key: null, value: null };
    reader.readRegex(patterns.export);
    const key = parseKey(reader);
    reader.readRegex(patterns.whitespace);
    let value: string | null = null;
    if (reader.peek(1) === '=') {
      reader.readRegex(patterns.equalSign);
      value = parseValue(reader);
    }
    reader.readRegex(patterns.comment);
    reader.readRegex(patterns.endOfLine);
    return { key, value };
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    reader.rewind(mark);
    reader.readRegex(patterns.restOfLine);
    return { key: null, value: null };
  }
}

/** python-dotenv's `parse_stream`, keeping the bindings that name a key, in file order. */
export function parseDotenv(text: string): [key: string, value: string | null][] {
  const reader = new Reader(text);
  const bindings: [string, string | null][] = [];
  while (reader.position < text.length) {
    const binding = parseBinding(reader);
    if (binding.key !== null) bindings.push([binding.key, binding.value]);
  }
  return bindings;
}

/** python-dotenv's `resolve_variables` with `override=True`: `${NAME}` and `${NAME:-default}`. */
export function resolveVariables(bindings: readonly (readonly [string, string | null])[], environment: Readonly<Record<string, string | undefined>>): Map<string, string | null> {
  const resolved = new Map<string, string | null>();
  for (const [name, value] of bindings) {
    const lookup = (key: string): string | null | undefined => (resolved.has(key) ? resolved.get(key) : environment[key]);
    const result = value === null ? null : value.replace(VARIABLE, (_match, variable: string, fallback: string | undefined) => lookup(variable) ?? (lookup(variable) === null ? '' : (fallback ?? '')));
    resolved.set(name, result);
  }
  return resolved;
}

/** `load_dotenv(path, override=True)` applied to an environment value instead of `os.environ`. */
export function applyDotenv(text: string, environment: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = { ...environment };
  for (const [key, value] of resolveVariables(parseDotenv(text), environment)) {
    if (value !== null) next[key] = value;
  }
  return next;
}
