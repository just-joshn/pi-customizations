/**
 * Argument repair. Models routinely send a shape Pi's schema almost accepts: `file_path` for `path`,
 * an array as a JSON string, a number as a string. Pi coerces scalar types; this module repairs the
 * structural mistakes before validation runs, so a recoverable call never reaches the model as a
 * validation error.
 */

export interface RepairSpec {
  /** Alternative field names mapped onto the canonical one, first present wins. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Fields whose value may arrive as a single object or as a JSON string of an array. */
  readonly arrays?: readonly string[];
  /** Fields that must end up as numbers. */
  readonly numbers?: readonly string[];
  /** Fields that must end up as booleans. */
  readonly booleans?: readonly string[];
  /** Fields that must be strings; other scalars are stringified. */
  readonly strings?: readonly string[];
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toNumber(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
}

function toBoolean(value: unknown): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}

/** Apply one repair specification to a raw argument object. Never throws. */
export function repairArguments(raw: unknown, spec: RepairSpec): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const input = { ...(raw as Record<string, unknown>) };

  for (const [alias, canonical] of Object.entries(spec.aliases ?? {})) {
    const aliasValue = input[alias];
    if (aliasValue !== undefined && input[canonical] === undefined) {
      input[canonical] = aliasValue;
    }
    if (alias !== canonical) {
      delete input[alias];
    }
  }

  for (const field of spec.arrays ?? []) {
    const value = input[field];
    if (value === undefined) {
      continue;
    }
    const parsed = parseJsonValue(value);
    if (Array.isArray(parsed)) {
      input[field] = parsed;
    } else if (parsed !== null && typeof parsed === 'object') {
      input[field] = [parsed];
    } else if (parsed !== value) {
      input[field] = parsed;
    }
  }

  for (const field of spec.numbers ?? []) {
    if (input[field] !== undefined) {
      input[field] = toNumber(input[field]);
    }
  }

  for (const field of spec.booleans ?? []) {
    if (input[field] !== undefined) {
      input[field] = toBoolean(input[field]);
    }
  }

  for (const field of spec.strings ?? []) {
    const value = input[field];
    if (typeof value === 'number' || typeof value === 'boolean') {
      input[field] = String(value);
    }
  }

  for (const [key, value] of Object.entries(input)) {
    if (value === null) {
      delete input[key];
    }
  }

  return input;
}

/** Build a `prepareArguments` hook from a repair specification. */
export function prepareWith(spec: RepairSpec): (raw: unknown) => unknown {
  return (raw: unknown) => repairArguments(raw, spec);
}

/** Aliases shared by every tool that takes a path. */
export const PATH_ALIASES: Readonly<Record<string, string>> = {
  file_path: 'path',
  filePath: 'path',
  filepath: 'path',
  filename: 'path',
  target_file: 'path',
  directory: 'path',
  dir: 'path',
  target_directory: 'path',
};
