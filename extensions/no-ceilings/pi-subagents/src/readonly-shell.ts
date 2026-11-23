export const DEV_NULL = '/dev/null';

function isShellBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s<>|&;)]/.test(char);
}

export function skipWhitespace(command: string, start: number): number {
  let index = start;
  while (command[index] === ' ' || command[index] === '\t') {
    index += 1;
  }
  return index;
}

function isDevNullTarget(command: string, start: number): boolean {
  const index = skipWhitespace(command, start);
  const end = index + DEV_NULL.length;
  return command.startsWith(DEV_NULL, index) && isShellBoundary(command[end]);
}

function isFdDuplicate(command: string, start: number): boolean {
  const destination = command[skipWhitespace(command, start)] ?? '';
  return destination === '' || destination === '-' || /\d/.test(destination);
}

function isAllowedWriteRedirect(command: string, index: number): boolean {
  if (command[index + 1] === '&') {
    return isFdDuplicate(command, index + 2);
  }
  const target = command[index + 1] === '>' ? index + 2 : index + 1;
  return isDevNullTarget(command, target);
}

/** True when the command contains a redirect that writes a file. Quoted redirects, fd duplicates, /dev/null, and read redirection stay allowed. */
export function hasUnquotedRedirect(command: string): boolean {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? '';
    if (char === '\\' && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote !== undefined) {
      quote = char === quote ? undefined : quote;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if ((char === '<' && command[index + 1] === '>') || (char === '>' && !isAllowedWriteRedirect(command, index))) {
      return true;
    }
  }
  return false;
}

export function hasUnquotedShellExpansion(command: string): boolean {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? '';
    if (char === '\\' && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote === "'") {
      quote = char === "'" ? undefined : quote;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = undefined;
      } else if (char === '$' || char === '`') {
        return true;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '$' || char === '{' || char === '}' || char === '*' || char === '?' || char === '[' || char === '`') {
      return true;
    }
  }
  return false;
}

function isUnsafeDoubleQuoted(command: string, index: number): boolean {
  const char = command[index] ?? '';
  return char === '`' || char === ';' || (char === '$' && command[index + 1] === '(');
}

function isLoneAmpersand(command: string, index: number): boolean {
  const previous = command[index - 1];
  return previous !== '>' && previous !== '|' && command[index + 1] !== '>';
}

function isUnsafeOutsideQuotes(command: string, index: number): boolean {
  const char = command[index] ?? '';
  const next = command[index + 1] ?? '';
  if (char === '\n' || char === '\r' || char === ';' || char === '`') {
    return true;
  }
  if ((char === '$' && next === '(') || (char === '<' && next === '(') || (char === '|' && next === '|')) {
    return true;
  }
  return char === '&' && (next === '&' || isLoneAmpersand(command, index));
}

export function splitReadOnlyPipeline(command: string): readonly string[] | undefined {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? '';
    if (char === '\\' && quote !== "'") {
      const next = command[index + 1] ?? '';
      if (next === '\n' || next === '\r') {
        return undefined;
      }
      current += char + next;
      index += 1;
      continue;
    }
    if (quote === '"' && isUnsafeDoubleQuoted(command, index)) {
      return undefined;
    }
    if (quote === undefined && (char === "'" || char === '"')) {
      quote = char;
      current += char;
      continue;
    }
    if (quote !== undefined) {
      quote = char === quote ? undefined : quote;
      current += char;
      continue;
    }
    if (isUnsafeOutsideQuotes(command, index)) {
      return undefined;
    }
    if (char === '|') {
      segments.push(current);
      current = '';
      if (command[index + 1] === '&') {
        index += 1;
      }
      continue;
    }
    current += char;
  }
  if (quote !== undefined) {
    return undefined;
  }
  segments.push(current);
  return segments;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function hasUnquotedLineContinuation(command: string): boolean {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? '';
    if (char === '\\' && quote !== "'") {
      const next = command[index + 1] ?? '';
      if (next === '\n' || next === '\r') {
        return true;
      }
      index += 1;
      continue;
    }
    if (quote === "'") {
      quote = char === "'" ? undefined : quote;
      continue;
    }
    if (quote === '"') {
      quote = char === '"' ? undefined : quote;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    }
  }
  return false;
}
