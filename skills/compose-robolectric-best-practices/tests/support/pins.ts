import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CodeBlock, Problem } from 'skill-gate';
import { parse as parseToml } from 'smol-toml';
import { HARNESS_DIR } from './harness.ts';

type Declared = { kind: 'literal'; coordinate: string; version: string } | { kind: 'unresolved'; coordinate: string; raw: string } | { kind: 'unattributed'; raw: string };

// `index` is the 0-based line of the block the declaration is reported on, or undefined to report on the fence.
interface Located {
  index: number | undefined;
  declared: Declared;
}

const isLiteral = (raw: string): boolean => /^\d/.test(raw);

function declared({ coordinate, version, raw }: { coordinate: string; version: string | undefined; raw: string }): Declared {
  return version === undefined ? { kind: 'unresolved', coordinate, raw } : { kind: 'literal', coordinate, version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Gradle Kotlin DSL: a statement continues while parentheses are open, so named arguments may span lines.
function statements(code: string): Array<{ index: number; text: string }> {
  const result: Array<{ index: number; text: string }> = [];
  let depth = 0;
  code.split('\n').forEach((line, index) => {
    const last = result.at(-1);
    if (depth > 0 && last) last.text += ` ${line}`;
    else result.push({ index, text: line });
    depth = Math.max(0, depth + (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length);
  });
  return result;
}

type Resolve = (raw: string) => string | undefined;

// Each extractor recognises one Gradle Kotlin DSL spelling; the spellings never overlap, so all of them run.
const KTS_EXTRACTORS: ReadonlyArray<(text: string, resolve: Resolve) => Declared[]> = [
  (text, resolve) => [...text.matchAll(/["']([\w.-]+:[\w.-]+):([^"'\s]+)["']/g)].map(([, coordinate = '', raw = '']) => declared({ coordinate, version: resolve(raw), raw })),
  (text, resolve) =>
    [...text.matchAll(/\b(id|kotlin)\(\s*["']([\w.-]+)["']\s*\)\s*(?:\.version\(\s*["']([^"']+)["']|\s+version\s+(?:["']([^"']+)["']|(\w+)))/g)].map(([, kind, id = '', ...versions]) => {
      const raw = versions.find((v) => v !== undefined) ?? '';
      return declared({ coordinate: kind === 'kotlin' ? `org.jetbrains.kotlin.${id}` : id, version: resolve(raw), raw });
    }),
  (text, resolve) => {
    const [group, name, raw] = ['group', 'name', 'version'].map((field) => text.match(new RegExp(`\\b${field}\\s*=\\s*["']([^"']+)["']`))?.[1]);
    return group && name && raw ? [declared({ coordinate: `${group}:${name}`, version: resolve(raw), raw })] : [];
  },
  (text, resolve) => {
    const rich = text.match(/\b(?:strictly|require|prefer)\(\s*["']([^"']+)["']\s*\)/);
    if (!rich) return [];
    const coordinate = text.match(/["']([\w.-]+:[\w.-]+)["']/)?.[1];
    return [coordinate ? declared({ coordinate, version: resolve(rich[1] ?? ''), raw: rich[0] }) : { kind: 'unattributed', raw: rich[0] }];
  },
];

function ktsDeclarations(code: string): Located[] {
  const vars = new Map(
    code.split('\n').flatMap((line): Array<[string, string]> => {
      const m = line.match(/^\s*val\s+(\w+)\s*=\s*["']([^"']+)["']\s*$/);
      return m ? [[m[1] ?? '', m[2] ?? '']] : [];
    }),
  );
  const resolve: Resolve = (raw) => (isLiteral(raw) ? raw : vars.get(raw.match(/^\$?\{?(\w+)\}?$/)?.[1] ?? ''));
  return statements(code).flatMap(({ index, text }) => KTS_EXTRACTORS.flatMap((extract) => extract(text, resolve)).map((d) => ({ index, declared: d })));
}

function catalogEntry({ section, value, versions }: { section: string; value: unknown; versions: Record<string, unknown> }): Declared | undefined {
  const literal = (raw: string) => (isLiteral(raw) ? raw : undefined);
  if (typeof value === 'string') {
    const parts = value.split(':');
    if (parts.length !== (section === 'plugins' ? 2 : 3)) return undefined;
    const raw = parts.at(-1) ?? '';
    return declared({ coordinate: parts.slice(0, -1).join(':'), version: literal(raw), raw });
  }
  if (!isRecord(value)) return undefined;
  const { module, group, name, id, version } = value;
  const coordinate = typeof module === 'string' ? module : typeof group === 'string' && typeof name === 'string' ? `${group}:${name}` : typeof id === 'string' ? id : undefined;
  if (coordinate === undefined || version === undefined) return undefined;
  if (typeof version === 'string') return declared({ coordinate, version: literal(version), raw: version });
  if (!isRecord(version)) return declared({ coordinate, version: undefined, raw: String(version) });
  if (typeof version['ref'] === 'string') {
    const ref = versions[version['ref']];
    return declared({ coordinate, version: typeof ref === 'string' ? ref : undefined, raw: `version.ref "${version['ref']}"` });
  }
  const rich = [version['strictly'], version['require'], version['prefer']].find((v) => typeof v === 'string');
  return declared({ coordinate, version: typeof rich === 'string' ? literal(rich) : undefined, raw: JSON.stringify(version) });
}

// Where each catalog key is written: the line that sets its version when the key uses dotted keys, else its first line.
function keyLines(lines: readonly string[]): Map<string, number> {
  const found = new Map<string, number>();
  let section = '';
  lines.forEach((line, index) => {
    const header = line.match(/^\s*\[([\w.-]+)\]\s*$/);
    if (header) {
      section = header[1] ?? '';
      return;
    }
    const key = line.match(/^\s*["']?([\w-]+)["']?\s*(\.\s*version\b)?/);
    if (!key?.[1]) return;
    const id = section ? `${section}.${key[1]}` : key[1];
    if (key[2] || !found.has(id)) found.set(id, index);
  });
  return found;
}

function tomlDeclarations(code: string): Located[] | string {
  let doc: unknown;
  try {
    doc = parseToml(code);
  } catch (error) {
    return `version catalog does not parse: ${String(error).split('\n')[0]}`;
  }
  if (!isRecord(doc)) return [];
  const versions = isRecord(doc['versions']) ? doc['versions'] : {};
  const lines = keyLines(code.split('\n'));
  return ['libraries', 'plugins'].flatMap((section) => {
    const table = doc[section];
    if (!isRecord(table)) return [];
    return Object.entries(table).flatMap(([key, value]): Located[] => {
      const entry = catalogEntry({ section, value, versions });
      return entry ? [{ index: lines.get(`${section}.${key}`), declared: entry }] : [];
    });
  });
}

let pins: Map<string, string> | undefined;
function harnessPins(): Map<string, string> {
  if (pins) return pins;
  const catalog = tomlDeclarations(readFileSync(join(HARNESS_DIR, 'gradle/libs.versions.toml'), 'utf8'));
  if (typeof catalog === 'string') throw new Error(`harness ${catalog}`);
  pins = new Map(catalog.flatMap(({ declared: d }): Array<[string, string]> => (d.kind === 'literal' ? [[d.coordinate, d.version]] : [])));
  return pins;
}

export function pinProblems(rel: string, block: CodeBlock): Problem[] {
  const located = block.lang === 'toml' ? tomlDeclarations(block.code) : ktsDeclarations(block.code);
  if (typeof located === 'string') return [{ kind: 'line', rel, line: block.line, message: located }];
  return located.flatMap(({ index, declared: d }): Problem[] => {
    const line = index === undefined ? block.line : block.line + 1 + index;
    const problem = (message: string): Problem[] => [{ kind: 'line', rel, line, message }];
    if (d.kind === 'unattributed') return problem(`${d.raw} is a version the gate cannot attribute to a dependency`);
    if (d.kind === 'unresolved') return problem(`${d.coordinate} version ${d.raw} is not a literal the gate can check`);
    const pinned = harnessPins().get(d.coordinate);
    if (pinned === undefined) return problem(`${d.coordinate}:${d.version} is not pinned in harness/gradle/libs.versions.toml`);
    return pinned === d.version ? [] : problem(`${d.coordinate}:${d.version} does not match the pinned ${pinned}`);
  });
}
