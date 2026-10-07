import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Preflight } from '../domain/run.ts';
import { isRecord, parseJson } from '../orchestrator/decode.ts';
import { isDirty, remoteUrl, revision, topLevel } from './git.ts';
import type { Shell } from './shell.ts';

const PACKAGE_MANAGERS: readonly (readonly [string, string])[] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['package.json', 'npm'],
  ['Cargo.toml', 'cargo'],
  ['go.mod', 'go'],
  ['pyproject.toml', 'pip'],
];

const LANGUAGES: readonly (readonly [string, string])[] = [
  ['tsconfig.json', 'typescript'],
  ['package.json', 'javascript'],
  ['Cargo.toml', 'rust'],
  ['go.mod', 'go'],
  ['pyproject.toml', 'python'],
  ['setup.py', 'python'],
  ['Gemfile', 'ruby'],
  ['pom.xml', 'java'],
  ['build.gradle', 'java'],
  ['build.gradle.kts', 'kotlin'],
];

const INSTRUCTION_FILES = ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'];

const GLOSSARY_FILES = ['GLOSSARY.md', 'GLOSSARY-MAP.md'];

const TEST_TARGET = /^(test|check|verify)([\w:-]*)$/;

const BUILD_TARGET = /^(build|typecheck|compile)([\w:-]*)$/;

async function present(cwd: string, names: readonly string[]): Promise<readonly string[]> {
  const found = await Promise.all(
    names.map((name) =>
      access(join(cwd, name)).then(
        () => name,
        () => null,
      ),
    ),
  );
  return found.filter((name) => name !== null);
}

async function text(cwd: string, name: string): Promise<string | null> {
  return readFile(join(cwd, name), 'utf8').catch(() => null);
}

async function adrCount(cwd: string): Promise<number> {
  const entries = await readdir(join(cwd, 'docs/adr')).catch(() => []);
  return entries.filter((name) => name.endsWith('.md')).length;
}

type Manifest = { readonly scripts: readonly string[]; readonly dependencies: readonly string[] };

function manifest(source: string | null): Manifest {
  if (source === null) return { scripts: [], dependencies: [] };
  const parsed = parseJson(source);
  if (parsed.kind === 'invalid' || !isRecord(parsed.value)) return { scripts: [], dependencies: [] };
  const keys = (field: unknown): readonly string[] => (isRecord(field) ? Object.keys(field) : []);
  const { scripts, dependencies, devDependencies, peerDependencies } = parsed.value;
  return { scripts: keys(scripts), dependencies: [...keys(dependencies), ...keys(devDependencies), ...keys(peerDependencies)] };
}

function makeTargets(source: string | null): readonly string[] {
  if (source === null) return [];
  return source
    .split('\n')
    .map((line) => /^([A-Za-z][\w:-]*)\s*:(?!=)/.exec(line)?.[1])
    .filter((target) => target !== undefined);
}

function commands(pattern: RegExp, packageManager: string, scripts: readonly string[], targets: readonly string[], native: readonly string[]): readonly string[] {
  return [...scripts.filter((script) => pattern.test(script)).map((script) => `${packageManager} run ${script}`), ...targets.filter((target) => pattern.test(target)).map((target) => `make ${target}`), ...native];
}

export async function repoFacts(cwd: string, shell: Shell): Promise<Preflight> {
  const [root, remote, head, dirty, markers, instructions, glossary, adrs, issueTracker, packageJson, makefile] = await Promise.all([
    topLevel(shell),
    remoteUrl(shell),
    revision(shell),
    isDirty(shell),
    present(cwd, [...new Set([...PACKAGE_MANAGERS.map(([file]) => file), ...LANGUAGES.map(([file]) => file)])]),
    present(cwd, INSTRUCTION_FILES),
    present(cwd, GLOSSARY_FILES),
    adrCount(cwd),
    present(cwd, ['docs/agents/issue-tracker.md']),
    text(cwd, 'package.json'),
    text(cwd, 'Makefile'),
  ]);
  const packageManager = PACKAGE_MANAGERS.find(([file]) => markers.includes(file))?.[1] ?? 'unknown';
  const { scripts, dependencies } = manifest(packageJson);
  const targets = makeTargets(makefile);
  const nativeTests = [...(markers.includes('Cargo.toml') ? ['cargo test'] : []), ...(markers.includes('go.mod') ? ['go test ./...'] : [])];
  const nativeBuilds = [...(markers.includes('Cargo.toml') ? ['cargo build'] : []), ...(markers.includes('go.mod') ? ['go build ./...'] : [])];
  return {
    repositoryRoot: root,
    remote,
    revision: head,
    dirty,
    languages: [...new Set(LANGUAGES.filter(([file]) => markers.includes(file)).map(([, language]) => language))],
    packageManager,
    testCommands: commands(TEST_TARGET, packageManager, scripts, targets, nativeTests),
    buildCommands: commands(BUILD_TARGET, packageManager, scripts, targets, nativeBuilds),
    instructions,
    glossary,
    adrs,
    issueTrackerDoc: issueTracker.length > 0,
    reactStack: dependencies.includes('react') || dependencies.includes('next'),
  };
}
