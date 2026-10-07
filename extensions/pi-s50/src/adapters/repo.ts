import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { RepoFacts } from '../orchestrator/coordinator.ts';
import { isDirty } from './git.ts';

const PACKAGE_MANAGERS: readonly (readonly [string, string])[] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['Cargo.toml', 'cargo'],
  ['go.mod', 'go'],
  ['pyproject.toml', 'python'],
];

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.override.md'];

const GLOSSARY_FILES = ['GLOSSARY.md', 'GLOSSARY-MAP.md'];

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

async function adrCount(cwd: string): Promise<number> {
  const entries = await readdir(join(cwd, 'docs/adr')).catch(() => []);
  return entries.filter((name) => name.endsWith('.md')).length;
}

export async function repoFacts(cwd: string): Promise<RepoFacts> {
  const [dirty, managers, instructions, glossary, adrs, issueTracker] = await Promise.all([
    isDirty(cwd),
    present(
      cwd,
      PACKAGE_MANAGERS.map(([file]) => file),
    ),
    present(cwd, INSTRUCTION_FILES),
    present(cwd, GLOSSARY_FILES),
    adrCount(cwd),
    present(cwd, ['docs/agents/issue-tracker.md']),
  ]);
  const manager = PACKAGE_MANAGERS.find(([file]) => managers.includes(file))?.[1] ?? 'unknown';
  return { issueTrackerDoc: issueTracker.length > 0, dirty, packageManager: manager, instructions, glossary, adrs };
}
