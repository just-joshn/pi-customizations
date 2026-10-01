import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const maxAgentFileBytes = 1048576;

function agentDirsAt(root: string): string[] {
  return [join(root, '.pi', 'agents'), join(root, '.claude', 'agents')];
}

export function defaultUserDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
  return [join(agentDir, 'agents'), join(homedir(), '.claude', 'agents')];
}

function ancestorsToProjectBoundary(cwd: string, home: string): string[] {
  const found: string[] = [];
  for (let current = resolve(cwd); current !== home; current = dirname(current)) {
    found.push(current);
    if (existsSync(join(current, '.git')) || dirname(current) === current) break;
  }
  return found;
}

export function projectAgentDirs(cwd: string, home: string = homedir()): string[] {
  return ancestorsToProjectBoundary(cwd, resolve(home)).flatMap(agentDirsAt);
}

export function additionalAgentDirs(roots: readonly string[], projectDirs: readonly string[]): string[] {
  const seen = new Set(projectDirs);
  return roots.flatMap((root) => agentDirsAt(resolve(root))).filter((dir) => !seen.has(dir));
}

function managedRoot(env: NodeJS.ProcessEnv): string {
  if (env.PI_MANAGED_DIR) return env.PI_MANAGED_DIR;
  if (platform() === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform() === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return '/etc/claude-code';
}

export function policyAgentDirs(env: NodeJS.ProcessEnv): string[] {
  return [join(managedRoot(env), '.claude', 'agents')];
}

export function baseDirDepth(baseDir: string): number {
  return baseDir.match(/[/\\]/g)?.length ?? 0;
}

function markdownEntries(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownEntries(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

export function markdownAgentFiles(dir: string, logs: string[]): string[] {
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return markdownEntries(dir)
    .toSorted()
    .filter((file) => {
      const stats = statSync(file, { throwIfNoEntry: false });
      if (stats?.isFile() && stats.size <= maxAgentFileBytes) return true;
      logs.push(`loadMarkdownFilesFromDir: skipping ${file}: not a regular file or exceeds ${maxAgentFileBytes} byte limit`);
      return false;
    });
}
