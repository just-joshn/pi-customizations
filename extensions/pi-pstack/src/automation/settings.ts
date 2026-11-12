import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const PACKAGE = 'npm:@justjoshn/pi-pstack';

export function mergeBennySettings(path: string): { added: string[]; conflicts: string[] } {
  const source = existsSync(path) ? readFileSync(path, 'utf8') : '{}';
  const clean = source.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) => (match.startsWith('"') ? match : match.replace(/[^\n]/g, ' ')));
  const tokens = [...clean.matchAll(/"(?:\\.|[^"\\])*"|[^\s]/g)];
  const trailing = new Set(tokens.filter((token, index) => token[0] === ',' && /^[}\]]$/.test(tokens[index + 1]?.[0] ?? '')).map((token) => token.index));
  const json = clean
    .split('')
    .map((char, index) => (trailing.has(index) ? ' ' : char))
    .join('');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { added: [], conflicts: ['invalid settings JSONC'] };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { added: [], conflicts: ['settings must be an object'] };
  const packages = (value as Record<string, unknown>)['packages'];
  if (packages !== undefined && !Array.isArray(packages)) return { added: [], conflicts: ['packages'] };
  if (
    packages?.some((entry) => {
      const name = typeof entry === 'string' ? entry : entry?.source;
      return typeof name === 'string' && /(?:^|[/@:])pi-pstack(?:\.git|@[^/]+)?\/?$/.test(name);
    })
  )
    return { added: [], conflicts: [] };
  let output: string;
  if (packages === undefined) {
    const end = clean.lastIndexOf('}');
    const prefix = clean.slice(0, end).trimEnd();
    const comma = prefix.endsWith('{') || prefix.endsWith(',') ? '' : ',';
    output = `${source.slice(0, end)}${comma}\n  "packages": ["${PACKAGE}"]\n${source.slice(end)}`;
  } else {
    const tokens = [...clean.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)];
    let depth = 0;
    let start = -1;
    let end = -1;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (depth === 1 && token[0] === '"packages"' && tokens[i + 1]?.[0] === ':' && tokens[i + 2]?.[0] === '[') start = tokens[i + 2]!.index;
      if (start >= 0 && token[0] === ']' && depth === 2) {
        end = token.index;
        break;
      }
      if (token[0] === '{' || token[0] === '[') depth++;
      if (token[0] === '}' || token[0] === ']') depth--;
    }
    if (end < 0) return { added: [], conflicts: ['packages'] };
    const prefix = clean.slice(start + 1, end).trimEnd();
    const comma = !prefix || prefix.endsWith(',') ? '' : ',';
    output = `${source.slice(0, end)}${comma}"${PACKAGE}"${source.slice(end)}`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, output);
  return { added: ['packages'], conflicts: [] };
}
