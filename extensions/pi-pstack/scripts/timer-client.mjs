import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeRecord } from './detached-rpc-protocol.mjs';
import { allocateTimerLease } from './timer-lease.mjs';

const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
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

async function waitReady(directory, child, priorPid) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const status = await timerRecord(join(directory, 'status.json'));
    if (status?.kind === 'ready' && timerAlive(status)) return;
    if (status && status.pid !== priorPid && !timerAlive(status)) throw new Error(`Timer service unavailable: ${status.error ?? status.kind}. Explicit restart is required.`);
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Timer service exited before readiness; its exclusive owner lease may be in use.');
    await pause();
  }
  throw new Error('Timer service startup timed out.');
}

export async function startTimerService(directory, launch) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(join(directory, 'commands'), { recursive: true, mode: 0o700 });
  await mkdir(join(directory, 'receipts'), { recursive: true, mode: 0o700 });
  const status = await timerRecord(join(directory, 'status.json'));
  if (status) return waitReady(directory);
  if (!(await timerRecord(join(directory, 'launch.json')))) await saveLaunch(directory, launch);
  await waitReady(directory, spawnService(directory));
}

async function saveLaunch(directory, launch) {
  const temporary = join(directory, `launch-${randomUUID()}.tmp`);
  await writeRecord(temporary, { ...launch, leasePort: await allocateTimerLease() });
  try {
    await link(temporary, join(directory, 'launch.json'));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    await unlink(temporary);
  }
}

export async function restartTimerService(directory) {
  const status = await timerRecord(join(directory, 'status.json'));
  if (timerAlive(status)) return waitReady(directory);
  const launch = await timerRecord(join(directory, 'launch.json'));
  if (!launch?.leasePort) throw new Error('Timer recovery needs the saved owner launch and lease.');
  await waitReady(directory, spawnService(directory), status?.pid);
}

function receiptResult(receipt, command) {
  if (JSON.stringify(receipt.command) !== JSON.stringify(command)) throw new Error('Timer command identity was already used for a different command.');
  if (!receipt.success) throw new Error(receipt.error);
  return receipt.result;
}

async function waitStopped(directory) {
  const deadline = Date.now() + 30000;
  while (timerAlive(await timerRecord(join(directory, 'status.json')))) {
    if (Date.now() >= deadline) throw new Error('Timer service shutdown did not finish.');
    await pause();
  }
}

export async function timerCommand(directory, command, id = randomUUID()) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid timer command identity.');
  const existing = await timerRecord(join(directory, 'receipts', `${id}.json`));
  if (existing) return receiptResult(existing, command);
  const status = await timerRecord(join(directory, 'status.json'));
  if (!timerAlive(status)) throw new Error(`Timer service unavailable: ${status?.error ?? status?.kind ?? 'not started'}`);
  await writeRecord(join(directory, 'commands', `${id}.json`), { id, command });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const receipt = await timerRecord(join(directory, 'receipts', `${id}.json`));
    if (receipt) {
      if (command.type === 'shutdown' && receipt.success) await waitStopped(directory);
      return receiptResult(receipt, command);
    }
    if (!timerAlive(await timerRecord(join(directory, 'status.json')))) throw new Error('Timer service stopped before acknowledgment.');
    await pause();
  }
  throw new Error(`Timer command timed out: ${command.type}`);
}
