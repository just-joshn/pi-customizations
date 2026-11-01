import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSupervisorLive } from './durable-store.ts';

const DEFAULT_READY_MS = 2_000;
const POLL_MS = 50;

export function supervisorBinPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../bin/pstack-routines-supervisor');
}

/**
 * Spawns `pstack-routines-supervisor --workspace <cwd>` detached when no live lock exists.
 * Idempotent when the supervisor is already running for that workspace.
 */
export function defaultEnsureSupervisor(cwd: string): void {
  if (isSupervisorLive(cwd)) return;
  const child = spawn(supervisorBinPath(), ['--workspace', cwd], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

/** Polls until supervisor.lock names a live pid, or the deadline passes. */
export async function waitForSupervisor(cwd: string, readyMs = DEFAULT_READY_MS, now = Date.now, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))): Promise<boolean> {
  if (isSupervisorLive(cwd)) return true;
  const deadline = now() + readyMs;
  while (now() < deadline) {
    await sleep(POLL_MS);
    if (isSupervisorLive(cwd)) return true;
  }
  return isSupervisorLive(cwd);
}
