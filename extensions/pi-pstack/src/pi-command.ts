import { existsSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Argv prefix for spawning Pi: the running script when available so children match
 * the parent's Pi version, else `pi` on PATH. Same rule as task/tool.ts historically.
 */
export function piCommand(): string[] {
  const script = process.argv[1];
  if (script !== undefined && !script.startsWith('/$bunfs/') && existsSync(script)) return [process.execPath, script];
  return /^(node|bun)(\.exe)?$/.test(basename(process.execPath).toLowerCase()) ? ['pi'] : [process.execPath];
}
