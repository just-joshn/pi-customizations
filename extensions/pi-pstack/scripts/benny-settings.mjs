const closers = new Set(['}', ']']);

function skipComment(text, index) {
  if (text.startsWith('//', index)) {
    const end = text.indexOf('\n', index);
    return end === -1 ? text.length : end;
  }
  if (!text.startsWith('/*', index)) return index;
  const end = text.indexOf('*/', index + 2);
  if (end === -1) throw new Error('Benny project settings contain an unterminated comment.');
  return end + 2;
}

function scanString(text, index) {
  let end = index + 1;
  while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
  if (end >= text.length) throw new Error('Benny project settings contain an unterminated string.');
  return end + 1;
}

function tokenize(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const next = skipComment(text, index);
    if (next !== index) index = next;
    else if (/\s/.test(text[index])) index += 1;
    else if (text[index] === '"') {
      const end = scanString(text, index);
      tokens.push({ kind: 'string', start: index, end, value: text.slice(index, end) });
      index = end;
    } else {
      const end = index + Math.max(1, /[{}[\]:,]/.test(text[index]) ? 1 : text.slice(index).search(/[\s{}[\]:,"/]|$/));
      tokens.push({ kind: 'other', start: index, end, value: text.slice(index, end) });
      index = end;
    }
  }
  return tokens;
}

function closingIndex(tokens, open) {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (['{', '['].includes(tokens[index].value)) depth += 1;
    if (closers.has(tokens[index].value)) depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error('Benny project settings contain an unbalanced bracket.');
}

function toValue(tokens) {
  const kept = tokens.filter((token, index) => !(token.value === ',' && closers.has(tokens[index + 1]?.value)));
  return JSON.parse(kept.map((token) => token.value).join(' '));
}

function topLevelKey(tokens, close, name) {
  let depth = 0;
  for (let index = 1; index < close; index += 1) {
    const value = tokens[index].value;
    if (depth === 0 && tokens[index].kind === 'string' && tokens[index + 1]?.value === ':' && JSON.parse(value) === name) return index + 2;
    if (['{', '['].includes(value)) depth += 1;
    if (closers.has(value)) depth -= 1;
  }
  return -1;
}

function entrySource(tokens) {
  const value = toValue(tokens);
  return typeof value === 'string' ? value : value?.source;
}

function hasEntry(tokens, open, close, source) {
  let depth = 0;
  let from = open + 1;
  for (let index = open + 1; index <= close; index += 1) {
    const value = tokens[index].value;
    if (['{', '['].includes(value)) depth += 1;
    if (closers.has(value) && index < close) depth -= 1;
    if ((value === ',' && depth === 0) || index === close) {
      if (index > from && entrySource(tokens.slice(from, index)) === source) return true;
      from = index + 1;
    }
  }
  return false;
}

function lineEnd(text, position) {
  const rest = /^[ \t]*(?:\/\/[^\n]*)?/.exec(text.slice(position))[0];
  return position + rest.length;
}

function applyEdits(text, edits) {
  return [...edits].sort((a, b) => b.at - a.at).reduce((result, edit) => result.slice(0, edit.at) + edit.text + result.slice(edit.at), text);
}

function appendTo(text, tokens, open, close, item, indent) {
  const last = tokens[close - 1];
  if (close === open + 1) return applyEdits(text, [{ at: tokens[open].end, text: `\n${indent}${item}\n${indent.slice(2)}` }]);
  const trailing = last.value === ',';
  const edits = trailing ? [] : [{ at: last.end, text: ',' }];
  edits.push({ at: lineEnd(text, last.end), text: `\n${indent}${item}${trailing ? ',' : ''}` });
  return applyEdits(text, edits);
}

export function mergePackageEntry(text, source) {
  const item = JSON.stringify(source);
  const tokens = tokenize(text);
  if (tokens.length === 0) return { text: `${text.trimEnd()}${text.trim() ? '\n' : ''}{\n  "packages": [\n    ${item}\n  ]\n}\n`, changed: true };
  if (tokens[0].value !== '{') throw new Error('Benny project settings must contain a JSON object.');
  const close = closingIndex(tokens, 0);
  const value = topLevelKey(tokens, close, 'packages');
  if (value === -1) return { text: appendTo(text, tokens, 0, close, `"packages": [\n    ${item}\n  ]`, '  '), changed: true };
  if (tokens[value]?.value !== '[') throw new Error('Benny project settings "packages" must be an array.');
  const end = closingIndex(tokens, value);
  if (hasEntry(tokens, value, end, source)) return { text, changed: false };
  return { text: appendTo(text, tokens, value, end, item, '    '), changed: true };
}
