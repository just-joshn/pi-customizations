import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { writeRecord } from './detached-rpc-protocol.mjs';
import { allocateTimerLease } from './timer-lease.mjs';

const pause = (signal) => delay(25, undefined, { signal });
export async function timerRecord(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export function timerAlive(status) {
  if (!status || status.kind === 'failed' || status.kind === 'stopped') return false;
  try {
    process.kill(status.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function spawnService(directory) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./timer-service.mjs', import.meta.url)), directory], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return child;
}

async function waitReady(directory, child, priorPid, signal) {
  signal?.throwIfAborted();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const status = await timerRecord(join(directory, 'status.json'));
    signal?.throwIfAborted();
    if (status?.kind === 'ready' && timerAlive(status)) return;
    if (status && status.pid !== priorPid && !timerAlive(status)) throw new Error(`Timer service unavailable: ${status.error ?? status.kind}. Explicit restart is required.`);
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Timer service exited before readiness; its exclusive owner lease may be in use.');
    await pause(signal);
  }
  throw new Error('Timer service startup timed out.');
}

export async function startTimerService(directory, launch, signal) {
  signal?.throwIfAborted();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  signal?.throwIfAborted();
  await mkdir(join(directory, 'commands'), { recursive: true, mode: 0o700 });
  signal?.throwIfAborted();
  await mkdir(join(directory, 'receipts'), { recursive: true, mode: 0o700 });
  const status = await timerRecord(join(directory, 'status.json'));
  signal?.throwIfAborted();
  if (status) return waitReady(directory, undefined, undefined, signal);
  if (!(await timerRecord(join(directory, 'launch.json')))) {
    signal?.throwIfAborted();
    await saveLaunch(directory, launch, signal);
  } else {
    signal?.throwIfAborted();
  }
  await waitReady(directory, spawnService(directory), undefined, signal);
}

async function saveLaunch(directory, launch, signal) {
  const temporary = join(directory, `launch-${randomUUID()}.tmp`);
  const leasePort = await allocateTimerLease();
  signal?.throwIfAborted();
  await writeRecord(temporary, { ...launch, leasePort });
  try {
    await link(temporary, join(directory, 'launch.json'));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    await unlink(temporary);
  }
}

export async function restartTimerService(directory, signal) {
  signal?.throwIfAborted();
  const status = await timerRecord(join(directory, 'status.json'));
  signal?.throwIfAborted();
  if (timerAlive(status)) return waitReady(directory, undefined, undefined, signal);
  const launch = await timerRecord(join(directory, 'launch.json'));
  if (!launch?.leasePort) throw new Error('Timer recovery needs the saved owner launch and lease.');
  signal?.throwIfAborted();
  await waitReady(directory, spawnService(directory), status?.pid, signal);
}

function receiptResult(receipt, command) {
  if (JSON.stringify(receipt.command) !== JSON.stringify(command)) throw new Error('Timer command identity was already used for a different command.');
  if (!receipt.success) throw new Error(receipt.error);
  return receipt.result;
}

async function waitStopped(directory, signal) {
  const deadline = Date.now() + 30000;
  signal?.throwIfAborted();
  while (timerAlive(await timerRecord(join(directory, 'status.json')))) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('Timer service shutdown did not finish.');
    await pause(signal);
  }
  signal?.throwIfAborted();
}

export async function timerCommand(directory, command, id = randomUUID(), signal) {
  signal?.throwIfAborted();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid timer command identity.');
  const existing = await timerRecord(join(directory, 'receipts', `${id}.json`));
  signal?.throwIfAborted();
  if (existing) return receiptResult(existing, command);
  const status = await timerRecord(join(directory, 'status.json'));
  if (!timerAlive(status)) throw new Error(`Timer service unavailable: ${status?.error ?? status?.kind ?? 'not started'}`);
  signal?.throwIfAborted();
  await writeRecord(join(directory, 'commands', `${id}.json`), { id, command });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const receipt = await timerRecord(join(directory, 'receipts', `${id}.json`));
    signal?.throwIfAborted();
    if (receipt) {
      if (command.type === 'shutdown' && receipt.success) await waitStopped(directory, signal);
      return receiptResult(receipt, command);
    }
    if (!timerAlive(await timerRecord(join(directory, 'status.json')))) throw new Error('Timer service stopped before acknowledgment.');
    await pause(signal);
  }
  throw new Error(`Timer command timed out: ${command.type}`);
}
