import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { piCommand } from '../pi-command.ts';
import { isSupervisorLive, readArm, readRegistry } from './durable-store.ts';
import type { ArmStatus, StoredSubscription } from './durable-types.ts';

const DEFAULT_READY_MS = 2_000;
const POLL_MS = 50;

export function supervisorBinPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../bin/pstack-routines-supervisor');
}

export type EnsureSupervisorSpawnOptions = {
  /** Concrete port override forwarded as PSTACK_ROUTINES_PORT, including ephemeral port zero. */
  routinesPort?: number;
  /** Bin path override; production leaves this unset. */
  binPath?: string;
};

/**
 * Spawns `pstack-routines-supervisor --workspace <cwd>` detached when no live lock exists.
 * Idempotent when the supervisor is already running for that workspace.
 * Spawn errors (missing bin) are swallowed so the interactive Pi process cannot crash.
 */
export function defaultEnsureSupervisor(cwd: string, options: EnsureSupervisorSpawnOptions = {}): void {
  if (isSupervisorLive(cwd)) return;
  const env: NodeJS.ProcessEnv = { ...process.env, PI_PSTACK_PI_COMMAND: JSON.stringify(piCommand()) };
  if (options.routinesPort !== undefined) {
    env['PSTACK_ROUTINES_PORT'] = String(options.routinesPort);
  }
  const child = spawn(options.binPath ?? supervisorBinPath(), ['--workspace', cwd], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.on('error', () => {
    // Missing bin or other spawn failure: chat falls back to in-process arming.
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

export async function waitForArm(cwd: string, sub: StoredSubscription, readyMs = DEFAULT_READY_MS): Promise<Extract<ArmStatus, { state: 'ready' }>> {
  const deadline = Date.now() + readyMs;
  for (;;) {
    const current = readRegistry(cwd).subscriptions.find((entry) => entry.id === sub.id);
    if (current?.lifecycle === 'cancelled') throw new Error(`Subscription ${sub.id} was cancelled while arming.`);
    const status = readArm(cwd, sub);
    if (status?.state === 'ready') return status;
    if (status?.state === 'error') throw new Error(`Subscription ${sub.id} could not arm. ${status.message}`);
    if (Date.now() >= deadline) throw new Error(`Subscription ${sub.id} readiness timed out. No matching live supervisor arm.`);
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
  }
}
