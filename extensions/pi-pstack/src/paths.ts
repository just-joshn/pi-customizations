import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function upstreamRevision(): string {
  try {
    return (JSON.parse(readFileSync(join(PACKAGE_ROOT, 'generated', 'upstream-lock.json'), 'utf8')) as { revision: string }).revision;
  } catch {
    return 'unknown';
  }
}
