import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { acquireSupervisorLock, isSupervisorLive, releaseSupervisorLock } from '../src/subscriptions/durable-store.ts';
import { defaultEnsureSupervisor, supervisorBinPath, waitForSupervisor } from '../src/subscriptions/ensure-supervisor.ts';

describe('ensure-supervisor', () => {
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), 'pstack-ensure-'));
    cwd = join(agentDir, 'workspace');
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    onTestFinished(() => {
      vi.unstubAllEnvs();
      rmSync(agentDir, { recursive: true, force: true });
    });
  });

  test('supervisorBinPath points at the package bin', () => {
    expect(supervisorBinPath().endsWith(`${join('bin', 'pstack-routines-supervisor')}`)).toBe(true);
  });

  test('waitForSupervisor returns true when the lock is already live', async () => {
    acquireSupervisorLock(cwd);
    onTestFinished(() => releaseSupervisorLock(cwd));
    await expect(waitForSupervisor(cwd, 0)).resolves.toBe(true);
  });

  test('waitForSupervisor returns false when nothing acquires the lock before the deadline', async () => {
    await expect(waitForSupervisor(cwd, 0)).resolves.toBe(false);
  });

  test('defaultEnsureSupervisor is a no-op when the lock is already live', () => {
    acquireSupervisorLock(cwd);
    onTestFinished(() => releaseSupervisorLock(cwd));
    expect(() => defaultEnsureSupervisor(cwd)).not.toThrow();
    expect(acquireSupervisorLock(cwd)).toEqual({ acquired: false, alreadyRunning: true, pid: process.pid });
  });

  test('defaultEnsureSupervisor swallows spawn errors from a missing bin', async () => {
    const missing = join(cwd, 'no-such-supervisor-bin');
    expect(() => defaultEnsureSupervisor(cwd, { binPath: missing, routinesPort: 47_913 })).not.toThrow();
    // Without an error listener, Node can surface ENOENT as an uncaughtException after the call returns.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(isSupervisorLive(cwd)).toBe(false);
  });

  test('the real supervisor bin stays alive past 1s until SIGTERM (SUP-BIN-001)', async () => {
    const child = spawn(supervisorBinPath(), ['--workspace', cwd], {
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onTestFinished(() => {
      child.kill('SIGKILL');
    });
    await expect.poll(() => isSupervisorLive(cwd), { timeout: 5_000 }).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(isSupervisorLive(cwd)).toBe(true);
    expect(child.exitCode).toBeNull();
    child.kill('SIGTERM');
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 5_000 }).toBe(true);
    await expect.poll(() => isSupervisorLive(cwd), { timeout: 5_000 }).toBe(false);
  });
});
