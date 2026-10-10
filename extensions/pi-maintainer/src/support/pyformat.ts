/**
 * Python's `str.format(**values)` for the field syntax Aider's templates use: `{name}`,
 * `{name[0]}`, and the `{{` and `}}` escapes. Values are inserted as they are and never parsed
 * again. Conversions, format specs, attributes, and positional fields are not supported and
 * throw, because no Aider template uses them.
 */
export type FormatValue = string | readonly string[];

class ValueError extends Error {
  override name = 'ValueError';
}

class KeyError extends Error {
  override name = 'KeyError';
}

class IndexError extends Error {
  override name = 'IndexError';
}

const FIELD = /^([^[.!:]+)((?:\[\d+\])*)$/;

function nextBrace(template: string, from: number): number {
  const open = template.indexOf('{', from);
  const close = template.indexOf('}', from);
  if (open === -1 || close === -1) return Math.max(open, close);
  return Math.min(open, close);
}

/** Index of the `}` closing the field that starts at `start`, skipping `[...]` like CPython. */
function fieldEnd(template: string, start: number): number {
  for (let index = start; index < template.length; index += 1) {
    const char = template[index];
    if (char === '{') throw new ValueError("unexpected '{' in field name");
    if (char === '}') return index;
    if (char === ':' || char === '!') throw new Error(`pyFormat supports no conversion or format spec: ${template}`);
    if (char === '[') {
      const close = template.indexOf(']', index);
      if (close === -1) break;
      index = close;
    }
  }
  throw new ValueError("expected '}' before end of string");
}

function item(value: FormatValue, index: number): string {
  const found = (typeof value === 'string' ? [...value] : value)[index];
  if (found === undefined) throw new IndexError(`${typeof value === 'string' ? 'string' : 'tuple'} index out of range`);
  return found;
}

function fieldValue(field: string, values: Readonly<Record<string, FormatValue>>): string {
  const [, name, indexes = ''] = FIELD.exec(field) ?? [];
  if (name === undefined || /^\d+$/.test(name)) throw new Error(`pyFormat supports only named fields with integer indexes: {${field}}`);
  const value = Object.hasOwn(values, name) ? values[name] : undefined;
  if (value === undefined) throw new KeyError(`'${name}'`);
  let current: FormatValue = value;
  for (const match of indexes.matchAll(/\[(\d+)\]/g)) current = item(current, Number(match[1]));
  if (typeof current !== 'string') throw new Error(`pyFormat formats only string values: {${field}}`);
  return current;
}

/** Python's `template.format(**values)` for named and indexed fields. */
export function pyFormat(template: string, values: Readonly<Record<string, FormatValue>>): string {
  let result = '';
  let index = 0;
  for (let at = nextBrace(template, 0); at !== -1; at = nextBrace(template, index)) {
    const char = template[at];
    result += template.slice(index, at);
    if (char === template[at + 1]) {
      result += char;
      index = at + 2;
    } else if (char === '}') {
      throw new ValueError("Single '}' encountered in format string");
    } else if (at + 1 === template.length) {
      throw new ValueError("Single '{' encountered in format string");
    } else {
      const end = fieldEnd(template, at + 1);
      result += fieldValue(template.slice(at + 1, end), values);
      index = end + 1;
    }
  }
  return result + template.slice(index);
}
