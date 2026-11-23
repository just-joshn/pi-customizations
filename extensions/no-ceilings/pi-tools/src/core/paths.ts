import { readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Remove the `@` prefix some models put in front of paths. */
export function stripAtPrefix(input: string): string {
  return input.startsWith('@') ? input.slice(1) : input;
}

/** Expand a leading `~` to the home directory. */
export function expandHome(input: string, home: string): string {
  if (input === '~') {
    return home;
  }
  if (input.startsWith('~/')) {
    return path.join(home, input.slice(2));
  }
  return input;
}

/**
 * Turn a model-supplied path into an absolute path.
 * Accepts `file://` URLs, `~`, `@`, relative, and absolute inputs.
 */
export function resolveToolPath(input: string, cwd: string, home: string): string {
  const trimmed = stripAtPrefix(input.trim());
  if (trimmed === '') {
    throw new Error('path is empty or only whitespace');
  }
  let candidate = trimmed;
  if (candidate.startsWith('file://')) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      throw new Error(`${candidate} is not a valid file URL. Use an absolute path instead.`);
    }
  }
  const expanded = expandHome(candidate, home);
  return path.resolve(cwd, expanded);
}

/** True when `target` equals `root` or sits inside it. */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Real path when the path exists, otherwise the normalized input. */
export async function realpathOrSelf(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Canonical absolute path. Existing paths resolve fully. A missing leaf resolves through its nearest
 * existing ancestor, and a symlink is followed even when its final target does not exist yet.
 */
export async function canonicalPath(target: string): Promise<string> {
  return canonicalize(path.resolve(target), new Set());
}

async function canonicalize(resolved: string, seen: Set<string>): Promise<string> {
  try {
    return await realpath(resolved);
  } catch {
    // Missing, dangling, or looping. Fall through and resolve what we can.
  }
  if (seen.has(resolved)) {
    return resolved;
  }
  seen.add(resolved);
  let linkTarget: string | undefined;
  try {
    linkTarget = await readlink(resolved);
  } catch {
    linkTarget = undefined;
  }
  if (linkTarget !== undefined) {
    return canonicalize(path.resolve(path.dirname(resolved), linkTarget), seen);
  }
  const parent = path.dirname(resolved);
  if (parent === resolved) {
    return resolved;
  }
  return path.join(await canonicalize(parent, seen), path.basename(resolved));
}

/** One character of opposite case, or undefined when the path has no letters. */
function flipCase(input: string): string | undefined {
  for (let index = input.length - 1; index >= 0; index--) {
    const char = input[index];
    if (char === undefined) {
      continue;
    }
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    if (lower === upper) {
      continue;
    }
    const flipped = char === lower ? upper : lower;
    return `${input.slice(0, index)}${flipped}${input.slice(index + 1)}`;
  }
  return undefined;
}

/** True when this existing directory treats `A` and `a` as the same name. */
async function directoryFoldsCase(directory: string): Promise<boolean> {
  const variant = flipCase(directory);
  if (variant === undefined) {
    return false;
  }
  let canonical: string;
  try {
    canonical = await realpath(directory);
  } catch {
    return false;
  }
  try {
    return (await realpath(variant)) === canonical;
  } catch {
    return false;
  }
}

/**
 * Fence key for one file. Realpath when the file exists, otherwise the canonical lexical path.
 * On a case-folding volume the key is folded too, so a missing path and its later on-disk spelling match.
 */
export async function fileIdentity(target: string): Promise<string> {
  const canonical = await canonicalPath(target);
  const folds = await directoryFoldsCase(path.dirname(canonical));
  return folds ? canonical.toLowerCase() : canonical;
}

/**
 * Fence key for the named path. The parent is canonicalized and the final component is appended,
 * so a symlink records the link itself and not the file it points at.
 */
export async function canonicalName(target: string): Promise<string> {
  const resolved = path.resolve(target);
  const parent = await canonicalPath(path.dirname(resolved));
  const named = path.join(parent, path.basename(resolved));
  const folds = await directoryFoldsCase(parent);
  return folds ? named.toLowerCase() : named;
}

/** The path a caller named plus its canonical form, deduplicated. Policy rules check both. */
export async function policySubjects(target: string): Promise<string[]> {
  const named = path.resolve(target);
  const canonical = await canonicalPath(named);
  return canonical === named ? [named] : [named, canonical];
}

/** Path with forward slashes, for matching and display. */
export function toPosix(target: string): string {
  return target.split(path.sep).join('/');
}

/** Path relative to a root, in posix form, or the absolute posix path when outside the root. */
export function relativeTo(root: string, target: string): string {
  if (!isInside(root, target)) {
    return toPosix(target);
  }
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' ? '.' : toPosix(relative);
}

/** Display form for a path: relative to the working directory when inside it, else absolute. */
export function displayPath(cwd: string, target: string): string {
  return isInside(cwd, target) ? relativeTo(cwd, target) : toPosix(target);
}

/** Directory that contains the given path. */
export function parentOf(target: string): string {
  return path.dirname(path.resolve(target));
}
