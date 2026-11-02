import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { acquireSupervisorLock, createDesired, isSupervisorLive, readLock, releaseSupervisorLock, writeArm } from '../src/subscriptions/durable-store.ts';
import { defaultEnsureSupervisor, supervisorBinPath, waitForArm, waitForSupervisor } from '../src/subscriptions/ensure-supervisor.ts';

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
    await expect(waitForSupervisor(cwd, 50)).resolves.toBe(false);
    expect(isSupervisorLive(cwd)).toBe(false);
  });

  test('readiness requires this subscription arm and the current supervisor incarnation', async () => {
    const { subscription } = createDesired(cwd, {
      id: 'sub-ready',
      name: 'ready',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      ownerSessionId: 'owner',
      config: { kind: 'webhook', slug: 'ready', prompt: 'handle' },
    });
    acquireSupervisorLock(cwd);
    onTestFinished(() => releaseSupervisorLock(cwd));
    await expect(waitForArm(cwd, subscription, 0)).rejects.toThrow('readiness timed out');
    const lock = readLock(cwd);
    if (lock === undefined) throw new Error('Expected a live supervisor lock.');
    const epoch = lock.epoch;
    writeArm(cwd, { state: 'ready', subscriptionId: subscription.id, revision: subscription.revision, epoch, url: 'http://127.0.0.1:1234/routines/ready' });
    await expect(waitForArm(cwd, subscription, 0)).resolves.toMatchObject({ state: 'ready', url: 'http://127.0.0.1:1234/routines/ready' });
    releaseSupervisorLock(cwd);
    acquireSupervisorLock(cwd);
    await expect(waitForArm(cwd, subscription, 0)).rejects.toThrow('readiness timed out');
  });

  test('an arm failure remains visible instead of a success-shaped URL', async () => {
    const { subscription } = createDesired(cwd, {
      id: 'sub-ready',
      name: 'ready',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      ownerSessionId: 'owner',
      config: { kind: 'webhook', slug: 'ready', prompt: 'handle' },
    });
    acquireSupervisorLock(cwd);
    onTestFinished(() => releaseSupervisorLock(cwd));
    const lock = readLock(cwd);
    if (lock === undefined) throw new Error('Expected a live supervisor lock.');
    writeArm(cwd, { state: 'error', subscriptionId: subscription.id, revision: subscription.revision, epoch: lock.epoch, message: 'port is occupied' });
    await expect(waitForArm(cwd, subscription, 0)).rejects.toThrow('port is occupied');
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
    const liveSince = Date.now();
    await expect.poll(() => isSupervisorLive(cwd) && Date.now() - liveSince >= 1_000, { timeout: 5_000 }).toBe(true);
    expect(child.exitCode).toBeNull();
    child.kill('SIGTERM');
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 5_000 }).toBe(true);
    await expect.poll(() => isSupervisorLive(cwd), { timeout: 5_000 }).toBe(false);
  });
});
