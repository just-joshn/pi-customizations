import { strip } from '../support/pystr.ts';
import type { ConfigEntry, ConfigValue } from './config-files.ts';
import type { AnyOptionSpec, RawValue } from './spec.ts';

/** One option assignment from one source, in the order that source supplies it. */
export interface Assignment {
  readonly spec: AnyOptionSpec;
  readonly raw: RawValue;
}

export interface SourceReading {
  readonly assignments: readonly Assignment[];
  readonly problems: readonly string[];
}

const TRUE_TEXT = new Set(['true', 'yes', 'on', '1']);
const FALSE_TEXT = new Set(['false', 'no', 'off', '0']);

/** How a source spelling relates to its option: the value itself, the `--no-` form, or a const flag. */
type Role = { readonly kind: 'value' } | { readonly kind: 'negative' } | { readonly kind: 'const'; readonly value: string };

interface Spelling {
  readonly spec: AnyOptionSpec;
  readonly name: string;
  readonly role: Role;
}

const isSwitch = (spec: AnyOptionSpec): boolean => spec.kind === 'boolean' || spec.kind === 'tristate';

/** Every long option string of every option, as argparse would register them. */
export function spellings(specs: readonly AnyOptionSpec[]): Spelling[] {
  return specs.flatMap((spec): Spelling[] => [
    ...[spec.name, ...spec.aliases].map((name): Spelling => ({ spec, name, role: { kind: 'value' } })),
    ...(spec.negatable ? [{ spec, name: `no-${spec.name}`, role: { kind: 'negative' } } satisfies Spelling] : []),
    ...spec.constFlags.map((flag): Spelling => ({ spec, name: flag.name, role: { kind: 'const', value: flag.value } })),
  ]);
}

/** configargparse's legacy list syntax for append options: `[a, b]`, JSON first. */
export function listSyntax(text: string): readonly string[] | null {
  if (!(text.startsWith('[') && text.endsWith(']'))) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((item) => (typeof item === 'boolean' ? (item ? 'True' : 'False') : item === null ? 'None' : String(item)));
  } catch {
    return text
      .slice(1, -1)
      .split(',')
      .map((item) => strip(item));
  }
  return text
    .slice(1, -1)
    .split(',')
    .map((item) => strip(item));
}

type Converted = { readonly raw: RawValue | null } | { readonly problem: string };

/** `convert_item_to_command_line_arg` for a switch or const flag: true appends, false negates or drops. */
function convertSwitch(spelling: Spelling, key: string, text: string): Converted {
  const lowered = text.toLowerCase();
  const on = TRUE_TEXT.has(lowered);
  if (!on && !FALSE_TEXT.has(lowered)) return { problem: `Unexpected value for ${key}: '${text}'. Expecting 'true', 'false', 'yes', 'no', 'on', 'off', '1' or '0'` };
  if (spelling.role.kind === 'const') return { raw: on ? { kind: 'text', text: spelling.role.value } : null };
  if (on) return { raw: { kind: 'switch', on: true } };
  return { raw: spelling.spec.negatable ? { kind: 'switch', on: false } : null };
}

function convertValue(spelling: Spelling, key: string, value: ConfigValue): Converted {
  if (isSwitch(spelling.spec) || spelling.role.kind === 'const') {
    return value.kind === 'text' ? convertSwitch(spelling, key, value.text) : { problem: `${key} must be a single value, not a list` };
  }
  if (spelling.spec.kind === 'list') return { raw: value.kind === 'items' ? value : { kind: 'items', items: [value.text] } };
  if (value.kind === 'items') return { problem: `${key} can't be set to a list '[${value.items.join(', ')}]' unless its action type is changed to 'append' or nargs is set to '*', '+', or > 1` };
  return { raw: value };
}

function collect(converted: readonly (readonly [Spelling, Converted])[]): SourceReading {
  const assignments: Assignment[] = [];
  const problems: string[] = [];
  for (const [spelling, result] of converted) {
    if ('problem' in result) problems.push(result.problem);
    else if (result.raw !== null) assignments.push({ spec: spelling.spec, raw: result.raw });
  }
  return { assignments, problems };
}

/** The YAML config entries of one file, keyed like configargparse's `get_possible_config_keys`. */
export function readConfig(specs: readonly AnyOptionSpec[], entries: readonly ConfigEntry[], path: string): SourceReading {
  const byKey = new Map(spellings(specs).flatMap((spelling) => [[spelling.name, spelling] as const, [`--${spelling.name}`, spelling] as const]));
  const converted: (readonly [Spelling, Converted])[] = [];
  const unknown: string[] = [];
  for (const entry of entries) {
    const spelling = byKey.get(entry.key);
    if (spelling === undefined) unknown.push(`${path}: unrecognized option ${entry.key}`);
    else converted.push([spelling, convertValue(spelling, entry.key, entry.value)]);
  }
  const reading = collect(converted);
  return { assignments: reading.assignments, problems: [...unknown, ...reading.problems] };
}

/** The environment variable configargparse derives from an option's first long name. */
export const environmentName = (prefix: string, name: string): string => `${prefix}${name}`.replace(/-/g, '_').toUpperCase();

/** `PI_MAINTAINER_<NAME>` variables, the Pi spelling of configargparse's `AIDER_<NAME>`. */
export function readEnvironment(specs: readonly AnyOptionSpec[], environment: Readonly<Record<string, string | undefined>>, prefix: string): SourceReading {
  const converted: (readonly [Spelling, Converted])[] = [];
  for (const spelling of spellings(specs)) {
    if (spelling.role.kind === 'negative' || (spelling.role.kind === 'value' && spelling.name !== spelling.spec.name)) continue;
    const key = environmentName(prefix, spelling.name);
    const text = environment[key];
    if (text === undefined) continue;
    const items = spelling.spec.kind === 'list' ? listSyntax(text) : null;
    converted.push([spelling, convertValue(spelling, key, items === null ? { kind: 'text', text } : { kind: 'items', items })]);
  }
  return collect(converted);
}

/** Pi extension flags: booleans for switches and const flags, strings otherwise. */
export function readFlags(specs: readonly AnyOptionSpec[], getFlag: (name: string) => boolean | string | undefined): SourceReading {
  const assignments: Assignment[] = [];
  const problems: string[] = [];
  for (const spec of specs) {
    const given = spellings([spec]).flatMap((spelling) => flagAssignment(spelling, getFlag(spelling.name)));
    if (given.length > 1) problems.push(`${given.map(([name]) => `--${name}`).join(' and ')} were all given; Pi does not report their order, so --${given.at(-1)?.[0]} wins`);
    const last = given.at(-1);
    if (last !== undefined) assignments.push({ spec, raw: last[1] });
  }
  return { assignments, problems };
}

function flagAssignment(spelling: Spelling, value: boolean | string | undefined): [name: string, raw: RawValue][] {
  if (value === undefined || value === false) return [];
  if (spelling.role.kind === 'const') return [[spelling.name, { kind: 'text', text: spelling.role.value }]];
  if (spelling.role.kind === 'negative') return [[spelling.name, { kind: 'switch', on: false }]];
  if (typeof value === 'boolean') return [[spelling.name, { kind: 'switch', on: true }]];
  const items = spelling.spec.kind === 'list' ? listSyntax(value) : null;
  return [[spelling.name, items === null ? { kind: 'text', text: value } : { kind: 'items', items }]];
}

/** The Pi flags an option registers: its names, a `no-` form when negatable, and its const flags. */
export function flagRegistrations(spec: AnyOptionSpec): { readonly name: string; readonly type: 'boolean' | 'string'; readonly description: string }[] {
  return spellings([spec]).map((spelling) => {
    if (spelling.role.kind === 'const') return { name: spelling.name, type: 'boolean', description: spec.constFlags.find((flag) => flag.name === spelling.name)?.help ?? spec.help };
    if (spelling.role.kind === 'negative') return { name: spelling.name, type: 'boolean', description: spec.help };
    return { name: spelling.name, type: isSwitch(spec) ? 'boolean' : 'string', description: spec.help };
  });
}
