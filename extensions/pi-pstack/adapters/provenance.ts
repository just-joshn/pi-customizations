import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const UPSTREAM = {
  repository: 'https://github.com/cursor/plugins',
  revision: 'a5539b15a3d56e04992565aafee2b37051329ce3',
} as const;

export type Origin = 'pstack' | 'team-kit';

export const VENDOR_ROOTS: Record<Origin, string> = {
  pstack: 'vendor/upstream-pstack',
  'team-kit': 'vendor/upstream-cursor-team-kit',
};

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

export function listFiles(root: string, dir = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(root, path));
    else if (entry.isFile()) files.push(toPosix(relative(root, path)));
  }
  return files;
}

export function upstreamUrl(origin: Origin, path: string): string {
  const prefix = origin === 'pstack' ? 'pstack' : 'cursor-team-kit';
  return `${UPSTREAM.repository}/blob/${UPSTREAM.revision}/${prefix}/${path}`;
}

export function readLock(packageRoot: string): { revision: string; files: Record<string, string> } {
  return JSON.parse(readFileSync(join(packageRoot, 'generated/upstream-lock.json'), 'utf8'));
}
