import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function zombie(pid: number): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    return close !== -1 && stat.slice(close + 2, close + 3) === 'Z';
  } catch {
    return false;
  }
}

export function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return !zombie(pid);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type Lease = { token: string; release: () => void };

/** A holder token keeps a stale reaper from unlinking a replacement owner's lease. */
export function acquireLease(path: string): Lease | undefined {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = `${process.pid}-${randomUUID()}`;
  const temporary = `${path}.${token}.tmp`;
  mkdirSync(temporary, { mode: 0o700 });
  try {
    writeFileSync(join(temporary, token), '', { mode: 0o600 });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        renameSync(temporary, path);
        return {
          token,
          release: () => {
            rmSync(join(path, token), { force: true });
            try {
              rmdirSync(path);
            } catch (error) {
              if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
            }
          },
        };
      } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
      let holders: string[];
      try {
        holders = readdirSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const holder of holders) {
        const pid = Number(/^(\d+)-[a-f0-9-]+$/.exec(holder)?.[1]);
        if (!Number.isInteger(pid)) throw new Error(`Invalid process lock ${path}. Retain it for diagnosis.`);
        if (alive(pid)) return undefined;
        rmSync(join(path, holder), { force: true });
      }
      try {
        rmdirSync(path);
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
    return undefined;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
