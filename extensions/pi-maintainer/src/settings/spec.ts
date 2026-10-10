import { strip } from '../support/pystr.ts';

export type SarName = 'edit' | 'git' | 'map' | 'lint';

/** Aider's argparse action family for an option. */
export type OptionKind = 'boolean' | 'tristate' | 'string' | 'int' | 'float' | 'list';

/**
 * One assignment as a settings source spells it, after configargparse turns a config or
 * environment value into command-line form and before argparse converts it.
 */
export type RawValue = { readonly kind: 'switch'; readonly on: boolean } | { readonly kind: 'text'; readonly text: string } | { readonly kind: 'items'; readonly items: readonly string[] };

export type Decoded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** A store_const flag that writes a fixed value into another option, like `--architect`. */
export interface ConstFlag {
  readonly name: string;
  readonly value: string;
  readonly help: string;
}

export interface OptionSpec<T> {
  /** Aider's long option name without dashes, such as `dry-run`. */
  readonly name: string;
  /** Further long option names of the same argparse action, such as `chat-mode`. */
  readonly aliases: readonly string[];
  readonly kind: OptionKind;
  /** True for argparse.BooleanOptionalAction, which also accepts `--no-<name>`. */
  readonly negatable: boolean;
  readonly constFlags: readonly ConstFlag[];
  readonly defaultValue: T;
  readonly help: string;
  readonly sar: SarName;
  readonly decode: (raw: RawValue) => Decoded<T>;
}

interface Common {
  readonly name: string;
  readonly help: string;
  readonly sar: SarName;
  readonly aliases?: readonly string[];
}

const ok = <T>(value: T): Decoded<T> => ({ ok: true, value });
const fail = <T>(error: string): Decoded<T> => ({ ok: false, error });

function optionLabel(name: string, aliases: readonly string[]): string {
  return [name, ...aliases].map((spelling) => `--${spelling}`).join('/');
}

function spec<T>(common: Common, kind: OptionKind, defaultValue: T, decode: (raw: RawValue) => Decoded<T>, extra: Partial<Pick<OptionSpec<T>, 'negatable' | 'constFlags'>> = {}): OptionSpec<T> {
  return {
    name: common.name,
    aliases: common.aliases ?? [],
    kind,
    negatable: extra.negatable ?? false,
    constFlags: extra.constFlags ?? [],
    defaultValue,
    help: common.help,
    sar: common.sar,
    decode,
  };
}

function switchValue(raw: RawValue, label: string): Decoded<boolean> {
  if (raw.kind === 'switch') return ok(raw.on);
  return fail(`argument ${label}: ignored explicit argument ${pyRepr(raw.kind === 'text' ? raw.text : raw.items.join(' '))}`);
}

function textValue(raw: RawValue, label: string): Decoded<string> {
  if (raw.kind === 'text') return ok(raw.text);
  if (raw.kind === 'items') return fail(`argument ${label}: expected one argument`);
  return fail(`argument ${label}: expected one argument`);
}

/** Python's `repr()` of a str, as argparse quotes rejected values. */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  const escaped = text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  return quote === "'" ? `'${escaped.replace(/'/g, "\\'")}'` : `"${escaped}"`;
}

function chosen(value: string, choices: readonly string[] | undefined, label: string): Decoded<string> {
  if (choices === undefined || choices.includes(value)) return ok(value);
  return fail(`argument ${label}: invalid choice: ${pyRepr(value)} (choose from ${choices.map(pyRepr).join(', ')})`);
}

/** `store_true` (not negatable) or `BooleanOptionalAction` (negatable) with a boolean default. */
export function booleanOption(common: Common & { readonly defaultValue: boolean; readonly negatable: boolean }): OptionSpec<boolean> {
  const label = optionLabel(common.name, common.aliases ?? []);
  return spec(common, 'boolean', common.defaultValue, (raw) => switchValue(raw, label), { negatable: common.negatable });
}

/** A switch whose default is `None`, so an unset option differs from false. */
export function tristateOption(common: Common & { readonly negatable: boolean }): OptionSpec<boolean | null> {
  const label = optionLabel(common.name, common.aliases ?? []);
  return spec<boolean | null>(common, 'tristate', null, (raw) => switchValue(raw, label), { negatable: common.negatable });
}

export function stringOption(common: Common & { readonly defaultValue: string | null; readonly choices?: readonly string[]; readonly constFlags?: readonly ConstFlag[] }): OptionSpec<string | null> {
  const label = optionLabel(common.name, common.aliases ?? []);
  const decode = (raw: RawValue): Decoded<string | null> => {
    const text = textValue(raw, label);
    return text.ok ? chosen(text.value, common.choices, label) : text;
  };
  return spec(common, 'string', common.defaultValue, decode, { constFlags: common.constFlags ?? [] });
}

const PY_INT = /^[+-]?\d+(?:_\d+)*$/;
const PY_FLOAT = /^[+-]?(?:(?:\d+(?:_\d+)*)?\.?\d+(?:_\d+)*(?:[eE][+-]?\d+(?:_\d+)*)?|\d+(?:_\d+)*\.|inf|infinity|nan)$/i;

/** Python's `int(text)` for decimal text, or null where Python raises ValueError. */
export function pyInt(text: string): number | null {
  const stripped = strip(text);
  return PY_INT.test(stripped) ? Number(stripped.replace(/_/g, '')) : null;
}

/** Python's `float(text)`, or null where Python raises ValueError. */
export function pyFloat(text: string): number | null {
  const stripped = strip(text);
  if (!PY_FLOAT.test(stripped)) return null;
  const lowered = stripped.toLowerCase().replace(/_/g, '');
  if (lowered.endsWith('nan')) return Number.NaN;
  if (lowered.endsWith('inf') || lowered.endsWith('infinity')) return lowered.startsWith('-') ? -Infinity : Infinity;
  return Number(lowered);
}

export function intOption(common: Common & { readonly defaultValue: number | null }): OptionSpec<number | null> {
  const label = optionLabel(common.name, common.aliases ?? []);
  const decode = (raw: RawValue): Decoded<number | null> => {
    const text = textValue(raw, label);
    if (!text.ok) return text;
    const value = pyInt(text.value);
    return value === null ? fail(`argument ${label}: invalid int value: ${pyRepr(text.value)}`) : ok(value);
  };
  return spec(common, 'int', common.defaultValue, decode);
}

export function floatOption(common: Common & { readonly defaultValue: number | null }): OptionSpec<number | null> {
  const label = optionLabel(common.name, common.aliases ?? []);
  const decode = (raw: RawValue): Decoded<number | null> => {
    const text = textValue(raw, label);
    if (!text.ok) return text;
    const value = pyFloat(text.value);
    return value === null ? fail(`argument ${label}: invalid float value: ${pyRepr(text.value)}`) : ok(value);
  };
  return spec(common, 'float', common.defaultValue, decode);
}

/** argparse `action="append"`: every occurrence adds one item, and the default is `None`. */
export function listOption(common: Common): OptionSpec<readonly string[]> {
  const label = optionLabel(common.name, common.aliases ?? []);
  const decode = (raw: RawValue): Decoded<readonly string[]> => {
    if (raw.kind === 'items') return ok(raw.items);
    if (raw.kind === 'text') return ok([raw.text]);
    return fail(`argument ${label}: expected one argument`);
  };
  return spec<readonly string[]>(common, 'list', [], decode);
}

/** Specs of several features, erased to one registry type. */
export type AnyOptionSpec = OptionSpec<unknown>;

/** Resolved option values; reading one decodes the winning source with that option's own type. */
export interface ResolvedSettings {
  value<T>(option: OptionSpec<T>): T;
  /** Where the value came from, such as `cli`, `env`, a config file path, or `default`. */
  source(option: AnyOptionSpec): string;
}
