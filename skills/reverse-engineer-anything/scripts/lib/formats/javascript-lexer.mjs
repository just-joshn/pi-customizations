const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const WHITESPACE = new Set([' ', '\t', '\r', '\n', '\f', '\v', '\u00a0', '\ufeff']);
const KEYWORD_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'case', 'yield', 'await']);

/**
 * A deliberately small scanner: enough to find calls, literals and their source
 * positions without executing or evaluating anything. It tracks strings,
 * templates, comments and a practical regex heuristic, and records what it
 * could not resolve instead of guessing.
 */
export function tokenize(source) {
  const state = { tokens: [], limits: [], lineStarts: [0] };
  let index = 0;
  while (index < source.length) index = advance(source, index, state);
  return { tokens: state.tokens, lineStarts: state.lineStarts, limits: state.limits, bytes: source.length };
}

function advance(source, index, state) {
  const character = source[index];
  if (character === '\n') {
    state.lineStarts.push(index + 1);
    return index + 1;
  }
  if (WHITESPACE.has(character)) return index + 1;
  if (character === '/' && source[index + 1] === '/') return skipLineComment(source, index);
  if (character === '/' && source[index + 1] === '*') return skipBlockComment(source, index, state.limits);
  if (character === '"' || character === "'") return pushQuoted(source, index, state);
  if (character === '`') return pushTemplate(source, index, state);
  if (character === '/' && startsRegex(state.tokens)) return pushRegex(source, index, state);
  if (IDENT_START.test(character)) return pushIdentifier(source, index, state);
  if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(source[index + 1] ?? ''))) return pushNumber(source, index, state);
  return pushPunctuation(source, index, state);
}

function pushQuoted(source, index, state) {
  const read = readQuoted(source, index);
  state.tokens.push({ type: 'string', value: read.value, start: index, end: read.end, dynamic: false });
  return read.end;
}

function pushTemplate(source, index, state) {
  const read = readTemplate(source, index);
  state.tokens.push({ type: 'string', value: read.value, start: index, end: read.end, dynamic: read.dynamic });
  return read.end;
}

function pushRegex(source, index, state) {
  const read = readRegex(source, index);
  state.tokens.push({ type: 'regex', value: read.value, start: index, end: read.end });
  return read.end;
}

function pushIdentifier(source, index, state) {
  let cursor = index;
  while (cursor < source.length && IDENT_PART.test(source[cursor])) cursor += 1;
  state.tokens.push({ type: 'ident', value: source.slice(index, cursor), start: index, end: cursor });
  return cursor;
}

function pushNumber(source, index, state) {
  let cursor = index;
  while (cursor < source.length && /[0-9a-fA-FxXoObBeE_.+-]/.test(source[cursor])) cursor += 1;
  state.tokens.push({ type: 'number', value: source.slice(index, cursor), start: index, end: cursor });
  return cursor;
}

function pushPunctuation(source, index, state) {
  if (source.slice(index, index + 2) === ';=') {
    state.tokens.push({ type: 'punct', value: ';=', start: index, end: index + 2 });
    return index + 2;
  }
  state.tokens.push({ type: 'punct', value: source[index], start: index, end: index + 1 });
  return index + 1;
}

function startsRegex(tokens) {
  const previous = tokens[tokens.length - 1];
  if (previous === undefined) return true;
  if (previous.type === 'ident') return KEYWORD_BEFORE_REGEX.has(previous.value);
  if (previous.type === 'string' || previous.type === 'number' || previous.type === 'regex') return false;
  return ![')', ']', '}'].includes(previous.value);
}

function skipLineComment(source, index) {
  let cursor = index + 2;
  while (cursor < source.length && source[cursor] !== '\n') cursor += 1;
  return cursor;
}

function skipBlockComment(source, index, limits) {
  const end = source.indexOf('*/', index + 2);
  if (end < 0) {
    limits.push('A block comment was never closed; the remainder of the file was treated as comment.');
    return source.length;
  }
  return end + 2;
}

function readQuoted(source, index) {
  const quote = source[index];
  let cursor = index + 1;
  let value = '';
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '\\') {
      value += decodeEscape(source, cursor);
      cursor += 2;
      continue;
    }
    if (character === quote) return { value, end: cursor + 1 };
    if (character === '\n') return { value, end: cursor };
    value += character;
    cursor += 1;
  }
  return { value, end: cursor };
}

function readTemplate(source, index) {
  let cursor = index + 1;
  let value = '';
  let dynamic = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '\\') {
      value += decodeEscape(source, cursor);
      cursor += 2;
      continue;
    }
    if (character === '$' && source[cursor + 1] === '{') {
      dynamic = true;
      const closing = findTemplateExpressionEnd(source, cursor + 2);
      value += source.slice(cursor, closing + 1);
      cursor = closing + 1;
      continue;
    }
    if (character === '`') return { value, end: cursor + 1, dynamic };
    value += character;
    cursor += 1;
  }
  return { value, end: cursor, dynamic };
}

function findTemplateExpressionEnd(source, index) {
  let depth = 1;
  let cursor = index;
  while (cursor < source.length && depth > 0) {
    const character = source[cursor];
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    if (depth === 0) return cursor;
    cursor += 1;
  }
  return cursor;
}

function readRegex(source, index) {
  let cursor = index + 1;
  let inClass = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (character === '[') inClass = true;
    else if (character === ']') inClass = false;
    else if (character === '/' && !inClass) break;
    else if (character === '\n') return { value: '', end: cursor };
    cursor += 1;
  }
  return { value: source.slice(index, cursor + 1), end: cursor + 1 };
}

function decodeEscape(source, index) {
  const next = source[index + 1];
  const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
  return simple[next] ?? next ?? '';
}

/** One-based line, zero-based column, matching the reference's source ranges. */
export function positionAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - lineStarts[low] };
}

export function rangeBetween(lineStarts, start, end) {
  return { start: positionAt(lineStarts, start), end: positionAt(lineStarts, end) };
}

/** Find `callee(` followed by arguments, returning the argument token spans without the call's own parentheses. */
export function findCallArguments(tokens, index, { maxArguments = 8 } = {}) {
  if (tokens[index]?.value !== '(') return null;
  let depth = 0;
  const args = [];
  let current = [];
  for (let cursor = index; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.value === '(') {
      depth += 1;
      if (depth === 1) continue;
    } else if (token.value === ')') {
      depth -= 1;
      if (depth === 0) {
        if (current.length > 0) args.push(current);
        return { args, endIndex: cursor, endOffset: token.end, truncated: false };
      }
    } else if (token.value === '{' || token.value === '[') {
      depth += 1;
    } else if (token.value === '}' || token.value === ']') {
      depth -= 1;
    } else if (token.value === ',' && depth === 1) {
      args.push(current);
      current = [];
      if (args.length >= maxArguments) return { args, endIndex: cursor, endOffset: token.start, truncated: true };
      continue;
    }
    current.push(token);
  }
  return null;
}
