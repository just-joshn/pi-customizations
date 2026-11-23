import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

type PackageSource = string | { readonly source?: string };

const AGENTS_DIR = 'agents';
const HOME_PREFIX = '~/';

function sourceOf(value: PackageSource): string | undefined {
  if (typeof value === 'string') {
    return value.trim();
  }
  return value.source?.trim();
}

function expandHome(value: string): string {
  return value === '~' ? homedir() : value.startsWith(HOME_PREFIX) ? join(homedir(), value.slice(HOME_PREFIX.length)) : value;
}

function npmPackageName(source: string): string | undefined {
  const spec = source.slice('npm:'.length);
  if (spec.length === 0) {
    return undefined;
  }
  const versionAt = spec.lastIndexOf('@');
  return versionAt > (spec.startsWith('@') ? spec.indexOf('/') : 0) ? spec.slice(0, versionAt) : spec;
}

function gitRepository(source: string): { readonly host: string; readonly path: string } | undefined {
  const spec = source.slice('git:'.length);
  const refAt = spec.lastIndexOf('@');
  const repository = refAt > 0 ? spec.slice(0, refAt) : spec;
  const [host, ...parts] = repository.split('/');
  return host === undefined || parts.length === 0 ? undefined : { host, path: parts.join('/') };
}

function existingPath(candidate: string): string | undefined {
  try {
    return statSync(candidate).isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function isInsideProject(cwd: string, candidate: string): boolean {
  const inside = relative(resolve(cwd), resolve(candidate));
  return inside === '' || (!inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside));
}

function localPackageRoots(source: string, cwd: string, agentDir: string, projectTrusted: boolean): readonly string[] {
  const path = expandHome(source.replace(/^file:/, ''));
  const candidates = isAbsolute(path) ? [path] : [resolve(agentDir, path), resolve(cwd, '.pi', path), resolve(cwd, path)];
  return candidates
    .filter((candidate) => projectTrusted || !isInsideProject(cwd, candidate))
    .map(existingPath)
    .filter((candidate): candidate is string => candidate !== undefined);
}

function packageRoots(source: string, cwd: string, agentDir: string, projectTrusted: boolean): readonly string[] {
  if (source.startsWith('npm:')) {
    const name = npmPackageName(source);
    if (name === undefined) {
      return [];
    }
    return [join(agentDir, 'npm', 'node_modules', name), ...(projectTrusted ? [join(cwd, '.pi', 'npm', 'node_modules', name)] : [])];
  }
  if (source.startsWith('git:')) {
    const repository = gitRepository(source);
    if (repository === undefined) {
      return [];
    }
    return [join(agentDir, 'git', repository.host, repository.path), ...(projectTrusted ? [join(cwd, '.pi', 'git', repository.host, repository.path)] : [])];
  }
  return localPackageRoots(source, cwd, agentDir, projectTrusted);
}

/** Resolves agents shipped inside configured Pi packages. Project packages load only for trusted projects. */
export function resolvePackageAgentDirectories(packages: readonly PackageSource[] | undefined, cwd: string, agentDir: string, projectTrusted: boolean): readonly string[] {
  let directories: readonly string[] = [];
  for (const source of packages ?? []) {
    const value = sourceOf(source);
    if (value === undefined) {
      continue;
    }
    for (const root of packageRoots(value, cwd, agentDir, projectTrusted)) {
      const directory = existingPath(join(root, AGENTS_DIR));
      if (directory !== undefined) {
        directories = [...new Set([...directories, directory])];
      }
    }
  }
  return directories;
}
