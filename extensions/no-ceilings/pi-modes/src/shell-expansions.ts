import { ONE, TWO } from './types.ts';

const SEGMENT_SEPARATORS = new Set<string>([';', '\n', '|', '&']);
const WHITESPACE = /\s/;
const BACKSLASH = '\\';
const CLOSE_BRACE = '}';

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
