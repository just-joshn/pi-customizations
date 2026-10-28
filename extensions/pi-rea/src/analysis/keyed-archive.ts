import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';
import { decodePlist, type PlistValue } from './plist.ts';

export interface KeyedArchiveObject {
  readonly id: number;
  readonly kind: 'nil' | 'scalar' | 'array' | 'dictionary' | 'class-descriptor' | 'archived-object';
  readonly class_id: number | null;
  readonly class_name: string | null;
  readonly status: 'observed' | 'unknown-class' | 'unresolved-class' | 'nil';
  readonly value: PlistValue;
}

export interface KeyedArchiveReference {
  readonly source: number | null;
  readonly path: readonly (string | number)[];
  readonly target: number | null;
  readonly status: 'resolved' | 'nil' | 'unresolved' | 'malformed';
  readonly raw: PlistValue;
}

export interface KeyedArchiveInspection {
  readonly target_sha256: null;
  readonly archive_path: string;
  readonly archive_sha256: string;
  readonly archive_format: 'binary-plist' | 'xml-plist';
  readonly roots: Record<string, PlistValue>;
  readonly objects: readonly KeyedArchiveObject[];
  readonly references: readonly KeyedArchiveReference[];
  readonly total_objects: number;
  readonly total_references: number;
  readonly offset: number;
  readonly next_offset: number | null;
  readonly truncated: boolean;
  readonly limitations: readonly string[];
}

const LIMITATIONS = [
  'Archive classes are never instantiated. Class names and serialized fields are observed; class-specific semantics are unknown.',
  'Conditional references serialized as UID 0 cannot be distinguished from ordinary nil references. Missing fields remain absent in the raw serialized value.',
  'Root selection selects the named $top entry; object pagination retains original indices and does not recursively expand references.',
] as const;

const inputError = (path: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_keyed_archive',
    issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${detail}` }],
  });

const isPlainObject = (value: PlistValue): value is { [key: string]: PlistValue } => value !== null && typeof value === 'object' && !Array.isArray(value) && !('$plist_type' in value);

const uidOf = (value: PlistValue): number | undefined => {
  if (!isPlainObject(value)) return undefined;
  if (typeof value.CF$UID === 'number') return value.CF$UID;
  if (typeof value.UID === 'number') return value.UID;
  return undefined;
};

const classifyObject = (id: number, value: PlistValue, classNames: Map<number, string>): KeyedArchiveObject => {
  if (value === null || value === '$null' || value === 'null') {
    return { id, kind: 'nil', class_id: null, class_name: null, status: 'nil', value: '$null' };
  }
  if (Array.isArray(value)) {
    return { id, kind: 'array', class_id: null, class_name: null, status: 'observed', value };
  }
  if (!isPlainObject(value)) {
    return { id, kind: 'scalar', class_id: null, class_name: null, status: 'observed', value };
  }
  if (typeof value.$classname === 'string' || Array.isArray(value.$classes)) {
    const name = typeof value.$classname === 'string' ? value.$classname : null;
    if (name !== null) classNames.set(id, name);
    return { id, kind: 'class-descriptor', class_id: null, class_name: null, status: 'observed', value };
  }
  const classUid = uidOf(value.$class as PlistValue);
  if (classUid !== undefined) {
    const class_name = classNames.get(classUid) ?? null;
    return {
      id,
      kind: 'archived-object',
      class_id: classUid,
      class_name,
      status: class_name === null ? 'unresolved-class' : 'unknown-class',
      value,
    };
  }
  return { id, kind: 'dictionary', class_id: null, class_name: null, status: 'observed', value };
};

const collectReferences = (objects: readonly KeyedArchiveObject[], roots: Record<string, PlistValue>): KeyedArchiveReference[] => {
  const references: KeyedArchiveReference[] = [];
  const visit = (source: number | null, path: readonly (string | number)[], value: PlistValue): void => {
    const uid = uidOf(value);
    if (uid !== undefined) {
      const resolved = uid >= 0 && uid < objects.length;
      references.push({
        source,
        path,
        target: resolved ? uid : null,
        status: uid === 0 ? 'nil' : resolved ? 'resolved' : 'unresolved',
        raw: value,
      });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(source, [...path, index], entry));
      return;
    }
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'CF$UID' || key === 'UID') continue;
        visit(source, [...path, key], child);
      }
    }
  };
  for (const [key, value] of Object.entries(roots)) visit(null, [key], value);
  for (const object of objects) visit(object.id, [], object.value);
  return references;
};

export const projectKeyedArchive = (
  decoded: { readonly format: 'xml' | 'binary'; readonly value: PlistValue },
  archivePath: string,
  sha256: string,
  selection: { readonly root?: string; readonly offset: number; readonly limit: number },
): KeyedArchiveInspection => {
  if (!isPlainObject(decoded.value)) {
    throw inputError(archivePath, 'its root is not a dictionary');
  }
  const archiver = decoded.value.$archiver;
  if (archiver !== 'NSKeyedArchiver') {
    throw inputError(archivePath, typeof archiver === 'string' ? `its $archiver is ${JSON.stringify(archiver)}` : 'it is not an NSKeyedArchiver plist');
  }
  const objectsRaw = decoded.value.$objects;
  if (!Array.isArray(objectsRaw)) throw inputError(archivePath, 'it has no $objects array');
  const classNames = new Map<number, string>();
  objectsRaw.forEach((entry, id) => {
    if (isPlainObject(entry) && typeof entry.$classname === 'string') classNames.set(id, entry.$classname);
  });
  const allObjects = objectsRaw.map((entry, id) => classifyObject(id, entry as PlistValue, classNames));
  const offset = selection.offset;
  const limit = selection.limit;
  const page = allObjects.slice(offset, offset + limit);
  const next = offset + limit < allObjects.length ? offset + limit : null;
  const roots: Record<string, PlistValue> = {};
  const top = isPlainObject(decoded.value.$top) ? decoded.value.$top : null;
  if (top !== null) {
    for (const [key, value] of Object.entries(top)) {
      if (selection.root !== undefined && key !== selection.root) continue;
      roots[key] = value as PlistValue;
    }
  }
  const allReferences = collectReferences(allObjects, roots);
  return {
    target_sha256: null,
    archive_path: archivePath,
    archive_sha256: sha256,
    archive_format: decoded.format === 'binary' ? 'binary-plist' : 'xml-plist',
    roots,
    objects: page,
    references: allReferences,
    total_objects: allObjects.length,
    total_references: allReferences.length,
    offset,
    next_offset: next,
    truncated: next !== null,
    limitations: [...LIMITATIONS],
  };
};

export const inspectKeyedArchiveFromPath = async (
  path: string,
  options: { readonly cwd?: string; readonly root?: string; readonly offset?: number; readonly limit?: number } = {},
): Promise<{ readonly record: KeyedArchiveInspection; readonly path: string; readonly resolvedPath: string }> => {
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let canonical = resolvedPath;
  try {
    canonical = await realpath(resolvedPath);
  } catch {}
  let bytes: Buffer;
  try {
    bytes = await readFile(canonical);
  } catch (error) {
    throw inputError(path, `it could not be read (${(error as Error).message})`);
  }
  let decoded: ReturnType<typeof decodePlist>;
  try {
    decoded = decodePlist(bytes);
  } catch (error) {
    throw inputError(path, `it is not a property list (${(error as Error).message})`);
  }
  const record = projectKeyedArchive(decoded, canonical, createHash('sha256').update(bytes).digest('hex'), {
    ...(options.root === undefined ? {} : { root: options.root }),
    offset: options.offset ?? 0,
    limit: options.limit ?? 20_000,
  });
  return { record, path, resolvedPath: canonical };
};
