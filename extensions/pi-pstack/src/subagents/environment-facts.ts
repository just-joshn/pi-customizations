import { accessSync, constants, readdirSync } from 'node:fs';
import { type } from 'node:os';
import { delimiter, join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { EnvironmentFacts } from './prompt-assembly.ts';

export type Exec = ExtensionAPI['exec'];

const advertisedTools = ['git', 'curl', 'gh'];
const hiddenEntries = new Set(['.git', 'node_modules']);
const listingLimit = 40;

export type Probe = Readonly<{
  git: (cwd: string) => Promise<string | undefined>;
  entries: (cwd: string) => readonly { name: string; directory: boolean }[];
  onPath: (binary: string) => boolean;
  osName: () => string;
}>;

async function gitRoot(exec: Exec, cwd: string): Promise<string | undefined> {
  const result = await exec('git', ['rev-parse', '--show-toplevel'], { cwd }).catch(() => undefined);
  return result?.code === 0 ? result.stdout.trim() || undefined : undefined;
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

export const systemProbe = (exec: Exec): Probe => ({ git: (cwd) => gitRoot(exec, cwd), entries: entriesOf, onPath, osName: type });

export function directorySnapshot(entries: readonly { name: string; directory: boolean }[]): string | undefined {
  const visible = entries.filter((entry) => !hiddenEntries.has(entry.name)).toSorted((left, right) => left.name.localeCompare(right.name));
  if (visible.length === 0) return undefined;
  const shown = visible.slice(0, listingLimit).map((entry) => `${entry.name}${entry.directory ? '/' : ''}`);
  const rest = visible.length - shown.length;
  return [...shown, ...(rest > 0 ? [`... ${rest} more`] : [])].join('\n');
}

export async function gatherEnvironment(cwd: string, probe: Probe): Promise<EnvironmentFacts> {
  const root = await probe.git(cwd);
  const listing = directorySnapshot(probe.entries(cwd));
  return { cwd, ...(root !== undefined ? { gitRoot: root } : {}), os: probe.osName(), ...(listing !== undefined ? { listing } : {}), tools: advertisedTools.filter((tool) => probe.onPath(tool)) };
}
