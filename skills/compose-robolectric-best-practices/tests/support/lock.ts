import { readFileSync, rmSync, writeFileSync } from 'node:fs';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

type Owner = { kind: 'pid'; pid: number } | { kind: 'writing' } | { kind: 'none' };

// An empty file is a run between creating the lock and writing its pid.
function readOwner(lockFile: string): Owner {
  let text: string;
  try {
    text = readFileSync(lockFile, 'utf8').trim();
  } catch {
    return { kind: 'none' };
  }
  if (text === '') return { kind: 'writing' };
  const pid = Number(text);
  return Number.isInteger(pid) && pid > 0 ? { kind: 'pid', pid } : { kind: 'none' };
}

function tryCreate(lockFile: string): boolean {
  try {
    writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

// The lock file is created exclusively, so only one run can own it. A run killed by a signal never reaches its
// finally block, so a lock whose owner has exited is removed and the create is retried once.
export function withLock<T>({ lockFile, busy, run }: { lockFile: string; busy: () => T; run: () => T }): T {
  if (!tryCreate(lockFile)) {
    const owner = readOwner(lockFile);
    if (owner.kind === 'writing' || (owner.kind === 'pid' && isAlive(owner.pid))) return busy();
    rmSync(lockFile, { force: true });
    if (!tryCreate(lockFile)) return busy();
  }
  try {
    return run();
  } finally {
    rmSync(lockFile, { force: true });
  }
}
