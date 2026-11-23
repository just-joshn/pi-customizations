import { realpath } from 'node:fs/promises';
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
 * Canonical absolute path. Existing paths resolve fully; a missing leaf resolves through its nearest
 * existing ancestor, so `/tmp/x` and `/private/tmp/x` produce the same value before and after creation.
 */
export async function canonicalPath(target: string): Promise<string> {
  const resolved = path.resolve(target);
  try {
    return await realpath(resolved);
  } catch {
    const parent = path.dirname(resolved);
    if (parent === resolved) {
      return resolved;
    }
    return path.join(await canonicalPath(parent), path.basename(resolved));
  }
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
