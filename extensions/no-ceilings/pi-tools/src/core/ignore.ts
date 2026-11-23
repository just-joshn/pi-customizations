import { readFile } from 'node:fs/promises';
import path from 'node:path';

import ignore, { type Ignore } from 'ignore';
import { DEFAULT_IGNORE_FILES } from '../constants.ts';
import { canonicalPath, displayPath, isInside, parentOf, relativeTo } from './paths.ts';

export interface IgnoreSource {
  /** Directory the patterns are relative to. */
  readonly dir: string;
  /** Absolute path of the ignore file. */
  readonly file: string;
  readonly matcher: Ignore;
}

export interface IgnoreResolver {
  /** Absolute paths of every ignore file loaded so far. */
  files(): readonly string[];
  /** True when a rule ignores this path. */
  ignores(target: string, isDirectory?: boolean): Promise<boolean>;
  /** The ignore file responsible for a path, when one is. */
  describe(target: string): Promise<string | undefined>;
  /** Reload the eager set and drop cached nested files. */
  reload(): Promise<void>;
}

/** Parse one ignore file body. Blank lines and `#` comments are skipped, `!` negates. */
export function parseIgnorePatterns(body: string): Ignore {
  const matcher = ignore();
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\r$/, '').trimStart();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    matcher.add(line);
  }
  return matcher;
}

/** Verdict of one source for one path: true ignored, false unignored, undefined no opinion. */
function verdict(source: IgnoreSource, target: string, isDirectory: boolean): boolean | undefined {
  if (source.dir !== target && !isInside(source.dir, target)) {
    return undefined;
  }
  const relative = relativeTo(source.dir, target);
  if (relative === '.' || relative.startsWith('..')) {
    return undefined;
  }
  const candidate = isDirectory ? `${relative.replace(/\/+$/, '')}/` : relative;
  try {
    const result = source.matcher.test(candidate);
    if (result.unignored) {
      return false;
    }
    if (result.ignored) {
      return true;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface IgnoreOptions {
  /** Workspace roots whose ignore files and nested ignore files apply. */
  readonly roots: readonly string[];
  readonly fileNames?: readonly string[];
  /** How far above each root to look for ignore files. */
  readonly maxDepth?: number;
}

/**
 * Ignore rules for a workspace: the roots and their ancestors, plus any ignore file found between a
 * root and a target. Deeper files override shallower ones, and negation inside a file is honored.
 */
class WorkspaceIgnoreResolver implements IgnoreResolver {
  private eager: IgnoreSource[] = [];
  private readonly nested = new Map<string, IgnoreSource[]>();
  private readonly pending = new Map<string, Promise<IgnoreSource[]>>();
  private readonly roots: readonly string[];
  private readonly fileNames: readonly string[];
  private readonly maxDepth: number;

  constructor(options: IgnoreOptions) {
    this.roots = options.roots.map((root) => path.resolve(root));
    this.fileNames = options.fileNames ?? DEFAULT_IGNORE_FILES;
    this.maxDepth = options.maxDepth ?? 32;
  }

  async load(): Promise<void> {
    this.eager = [];
    this.nested.clear();
    const seen = new Set<string>();
    for (const root of this.roots) {
      for (const source of await this.readChain(root, true, seen)) {
        this.eager.push(source);
      }
    }
  }

  private async readChain(dir: string, upward: boolean, seen: Set<string>): Promise<IgnoreSource[]> {
    const sources: IgnoreSource[] = [];
    let current = dir;
    for (let depth = 0; upward && depth <= this.maxDepth; depth++) {
      sources.push(...(await this.readDirectory(current, seen)));
      const parent = parentOf(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return sources;
  }

  private async readDirectory(dir: string, seen: Set<string>): Promise<IgnoreSource[]> {
    const found: IgnoreSource[] = [];
    for (const name of this.fileNames) {
      const file = path.join(dir, name);
      if (seen.has(file)) {
        continue;
      }
      seen.add(file);
      try {
        const body = await readFile(file, 'utf8');
        found.push({ dir, file, matcher: parseIgnorePatterns(body) });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EISDIR' && code !== 'EACCES') {
          throw error;
        }
      }
    }
    return found;
  }

  private async sourcesForDirectory(dir: string): Promise<IgnoreSource[]> {
    const cached = this.nested.get(dir);
    if (cached !== undefined) {
      return cached;
    }
    let pending = this.pending.get(dir);
    if (pending === undefined) {
      pending = this.readDirectory(dir, new Set()).then((sources) => {
        this.nested.set(dir, sources);
        this.pending.delete(dir);
        return sources;
      });
      this.pending.set(dir, pending);
    }
    return pending;
  }

  /** Sources from a root down to the target's own directory, shallowest first. */
  private async chainSources(target: string, isDirectory: boolean): Promise<IgnoreSource[]> {
    const targetDir = isDirectory ? target : parentOf(target);
    for (const root of this.roots) {
      if (root !== targetDir && !isInside(root, targetDir)) {
        continue;
      }
      const chain: IgnoreSource[] = [];
      let current = root;
      const relative = path.relative(root, targetDir);
      const parts = relative === '' ? [] : relative.split(path.sep);
      chain.push(...(await this.sourcesForDirectory(current)));
      for (const part of parts) {
        current = path.join(current, part);
        chain.push(...(await this.sourcesForDirectory(current)));
      }
      return chain;
    }
    return [];
  }

  private async orderedSources(target: string, isDirectory: boolean): Promise<IgnoreSource[]> {
    const nested = await this.chainSources(target, isDirectory);
    const all = [...this.eager, ...nested];
    const seen = new Set<string>();
    const unique = all.filter((source) => {
      if (seen.has(source.file)) {
        return false;
      }
      seen.add(source.file);
      return true;
    });
    return unique.sort((left, right) => left.dir.length - right.dir.length);
  }

  async ignores(target: string, isDirectory = false): Promise<boolean> {
    const canonical = await canonicalPath(target);
    for (const candidate of canonical === target ? [target] : [target, canonical]) {
      const sources = await this.orderedSources(candidate, isDirectory);
      let ignored: boolean | undefined;
      for (const source of sources) {
        const result = verdict(source, candidate, isDirectory);
        if (result !== undefined) {
          ignored = result;
        }
      }
      if (ignored === true) {
        return true;
      }
    }
    return false;
  }

  async describe(target: string): Promise<string | undefined> {
    const canonical = await canonicalPath(target);
    for (const candidate of canonical === target ? [target] : [target, canonical]) {
      for (const isDirectory of [false, true]) {
        const sources = await this.orderedSources(candidate, isDirectory);
        let responsible: string | undefined;
        for (const source of sources) {
          const result = verdict(source, candidate, isDirectory);
          if (result === true) {
            responsible = source.file;
          } else if (result === false) {
            responsible = undefined;
          }
        }
        if (responsible !== undefined) {
          return responsible;
        }
      }
    }
    return undefined;
  }

  files(): readonly string[] {
    const files = new Set(this.eager.map((source) => source.file));
    for (const sources of this.nested.values()) {
      for (const source of sources) {
        files.add(source.file);
      }
    }
    return [...files];
  }

  async reload(): Promise<void> {
    await this.load();
  }
}

/** Read every ignore file that applies to the roots, and resolve nested ones on demand. */
export async function createIgnoreResolver(options: IgnoreOptions): Promise<IgnoreResolver> {
  const resolver = new WorkspaceIgnoreResolver(options);
  await resolver.load();
  return resolver;
}

/** Path shown in an ignore refusal, relative to the session working directory. */
export function ignoreRefusal(cwd: string, target: string, file: string): string {
  return `Path ${displayPath(cwd, target)} is filtered out by ${path.basename(file)}`;
}
