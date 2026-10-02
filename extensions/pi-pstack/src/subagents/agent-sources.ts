import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const maxAgentFileBytes = 1048576;

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
