import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { AgentSourceKind } from './agent-definition.ts';

export type AgentDirectory = Readonly<{ dir: string; source: AgentSourceKind }>;
export type LocationInputs = Readonly<{ cwd: string; agentDir: string; home?: string; additionalRoots?: readonly string[] }>;

const projectSubdirectories = [join('.github', 'agents'), join('.pi', 'agents')];

function ancestorsToRepositoryRoot(cwd: string, home: string): readonly string[] {
  const found: string[] = [];
  for (let current = resolve(cwd); current !== home; current = dirname(current)) {
    found.push(current);
    if (existsSync(join(current, '.git')) || dirname(current) === current) break;
  }
  return found.toReversed();
}

export function userAgentDirectories(agentDir: string, home: string = homedir()): readonly string[] {
  return [join(home, '.copilot', 'agents'), join(agentDir, 'agents')];
}

export function agentDirectories({ cwd, agentDir, home = homedir(), additionalRoots = [] }: LocationInputs): readonly AgentDirectory[] {
  const projectRoots = ancestorsToRepositoryRoot(cwd, resolve(home));
  const additional = additionalRoots.map((root) => resolve(root)).filter((root) => !projectRoots.includes(root));
  const underRoots = (roots: readonly string[]) => roots.flatMap((root) => projectSubdirectories.map((subdirectory) => ({ dir: join(root, subdirectory), source: 'project' as const })));
  return [...userAgentDirectories(agentDir, home).map((dir) => ({ dir, source: 'user' as const })), ...underRoots(additional), ...underRoots(projectRoots)];
}
