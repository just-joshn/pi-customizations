import { ONE, TWO } from './types.ts';

const SEGMENT_SEPARATORS = new Set<string>([';', '\n', '|', '&']);
const WHITESPACE = /\s/;
const BACKSLASH = '\\';
const CLOSE_BRACE = '}';
const OPEN_BRACE = '{';
const OPEN_BRACKET = '[';
const OPEN_PAREN = '(';
const STAR = '*';
const QUESTION = '?';
const SINGLE_QUOTE = "'";
const DOUBLE_QUOTE = '"';

/** Detect an unquoted brace expansion, which can turn one literal word into an option. */
export function hasBraceExpansion(command: string, start: number): boolean {
  let index = start + ONE;
  while (index < command.length) {
    const char = command[index] ?? '';
    if (char === BACKSLASH) {
      index += TWO;
      continue;
    }
    if (char === CLOSE_BRACE) {
      const inner = command.slice(start + ONE, index);
      return inner.includes(',') || inner.includes('..');
    }
    if (WHITESPACE.test(char) || SEGMENT_SEPARATORS.has(char)) {
      return false;
    }
    index += ONE;
  }
  return false;
}

export function startsShellExpansion(char: string | undefined): boolean {
  return char !== undefined && (char === OPEN_BRACE || char === OPEN_PAREN || char === OPEN_BRACKET || char === SINGLE_QUOTE || char === DOUBLE_QUOTE || /[A-Za-z0-9_?#@*$!-]/.test(char));
}

export function isPathnameExpansionChar(char: string): boolean {
  return char === STAR || char === QUESTION || char === OPEN_BRACKET;
}
