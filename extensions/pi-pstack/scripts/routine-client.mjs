import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { parseRoutine } from './routine-domain.mjs';

const pause = (signal) => delay(25, undefined, { signal });
export async function routineRecord(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function durableRecord(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o077) throw new Error('Routine directory must be owned by this user with mode 0700.');
}

export async function prepareRoutine(root, input, signal) {
  signal?.throwIfAborted();
  const definition = parseRoutine(input);
  await privateDirectory(root);
  signal?.throwIfAborted();
  const directory = join(root, randomUUID());
  await privateDirectory(directory);
  for (const name of ['secrets', 'events', 'delivered', 'fallback']) await privateDirectory(join(directory, name));
  await durableRecord(join(directory, 'definition.json'), definition);
  signal?.throwIfAborted();
  return { ...definition, directory, kind: 'disabled' };
}

export async function routineDefinition(directory) {
  const stored = await routineRecord(join(directory, 'definition.json'));
  if (!stored) throw new Error('Routine draft is missing.');
  const { revision, trigger, ...input } = stored;
  const parsed = parseRoutine(input);
  if (trigger?.type !== 'webhook' || revision !== parsed.revision) throw new Error('Routine revision changed. Prepare a new draft.');
  return parsed;
}

function alive(status) {
  if (!status?.pid || ['disabled', 'failed'].includes(status.kind)) return false;
  try {
    process.kill(status.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function inspectRoutine(directory, signal) {
  signal?.throwIfAborted();
  const definition = await routineDefinition(directory);
  const status = await routineRecord(join(directory, 'status.json'));
  signal?.throwIfAborted();
  if (!status) return { ...definition, directory, kind: 'disabled' };
  if (status.kind === 'ready' && !alive(status)) return { ...definition, directory, kind: 'failed', error: 'Supervisor exited. Reconcile accepted events before preparing a replacement.' };
  return { ...definition, directory, ...status };
}

export async function startRoutine(directory, revision, launch, signal) {
  signal?.throwIfAborted();
  await privateDirectory(directory);
  const definition = await routineDefinition(directory);
  if (definition.revision !== revision) throw new Error('Approved routine revision does not match the draft.');
  if (process.platform !== 'darwin') throw new Error('Routine worker isolation requires macOS sandbox-exec. This host cannot enable routines safely.');
  const previous = await routineRecord(join(directory, 'status.json'));
  signal?.throwIfAborted();
  if (previous?.kind === 'ready' && alive(previous)) return inspectRoutine(directory, signal);
  await mkdir(join(directory, 'owner'), { mode: 0o700 }).catch((error) => {
    if (error.code === 'EEXIST') throw new Error('Routine already has an owner. Reconcile its receipts before preparing a replacement.');
    throw error;
  });
  await durableRecord(join(directory, 'launch.json'), launch);
  await durableRecord(join(directory, 'approval.json'), { revision, approvedAt: Date.now() });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./routine-service.mjs', import.meta.url)), directory], { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    void durableRecord(join(directory, 'status.json'), { kind: 'failed', error: 'Routine supervisor failed to start.' });
  });
  child.unref();
  const deadline = Date.now() + 30000;
  signal?.throwIfAborted();
  while (Date.now() < deadline) {
    const current = await routineRecord(join(directory, 'status.json'));
    signal?.throwIfAborted();
    if (current?.kind === 'ready' && alive(current)) return inspectRoutine(directory, signal);
    if (current?.kind === 'failed' || current?.kind === 'disabled') throw new Error(`Routine service unavailable: ${current.error ?? current.kind}`);
    await pause(signal);
  }
  throw new Error('Routine startup timed out. Inspect before retrying.');
}

export async function disableRoutine(directory, signal) {
  signal?.throwIfAborted();
  const current = await routineRecord(join(directory, 'status.json'));
  signal?.throwIfAborted();
  if (!current) return inspectRoutine(directory, signal);
  await durableRecord(join(directory, 'disable.json'), { requestedAt: Date.now() });
  if (current.kind === 'disabled') return inspectRoutine(directory, signal);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const status = await routineRecord(join(directory, 'status.json'));
    signal?.throwIfAborted();
    if (status?.kind === 'disabled') return inspectRoutine(directory, signal);
    if (!alive(status)) throw new Error('Routine supervisor is unavailable. Disable is persisted; active work needs reconciliation.');
    await pause(signal);
  }
  throw new Error('Routine disable timed out. The disable request remains persisted.');
}
