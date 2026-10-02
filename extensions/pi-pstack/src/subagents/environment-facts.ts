import { execFileSync } from 'node:child_process';
import { accessSync, constants, readdirSync } from 'node:fs';
import { type } from 'node:os';
import { delimiter, join } from 'node:path';

import type { EnvironmentFacts } from './prompt-assembly.ts';

const advertisedTools = ['git', 'curl', 'gh'];
const hiddenEntries = new Set(['.git', 'node_modules']);
const listingLimit = 40;

export type Probe = Readonly<{
  git: (cwd: string) => string | undefined;
  entries: (cwd: string) => readonly { name: string; directory: boolean }[];
  onPath: (binary: string) => boolean;
  osName: () => string;
}>;

function gitRoot(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function entriesOf(cwd: string): readonly { name: string; directory: boolean }[] {
  try {
    return readdirSync(cwd, { withFileTypes: true }).map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
  } catch {
    return [];
  }
}

function onPath(binary: string): boolean {
  return (process.env.PATH ?? '').split(delimiter).some((directory) => {
    try {
      accessSync(join(directory, binary), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export const systemProbe: Probe = { git: gitRoot, entries: entriesOf, onPath, osName: type };

export function directorySnapshot(entries: readonly { name: string; directory: boolean }[]): string | undefined {
  const visible = entries.filter((entry) => !hiddenEntries.has(entry.name)).toSorted((left, right) => left.name.localeCompare(right.name));
  if (visible.length === 0) return undefined;
  const shown = visible.slice(0, listingLimit).map((entry) => `${entry.name}${entry.directory ? '/' : ''}`);
  const rest = visible.length - shown.length;
  return [...shown, ...(rest > 0 ? [`... ${rest} more`] : [])].join('\n');
}

export function gatherEnvironment(cwd: string, probe: Probe = systemProbe): EnvironmentFacts {
  const root = probe.git(cwd);
  const listing = directorySnapshot(probe.entries(cwd));
  return { cwd, ...(root !== undefined ? { gitRoot: root } : {}), os: probe.osName(), ...(listing !== undefined ? { listing } : {}), tools: advertisedTools.filter((tool) => probe.onPath(tool)) };
}
