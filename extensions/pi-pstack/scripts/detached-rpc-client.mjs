import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activitySchema, readRecord, responseSchema, snapshotSchema, statusSchema, writeRecord } from './detached-rpc-protocol.mjs';

const requestDeadlineMs = 30000;
const pollMs = 25;
const terminal = (status) => status?.kind === 'exited' || status?.kind === 'failed';
const pause = () => new Promise((resolve) => setTimeout(resolve, pollMs));

async function requiredRecord(path, schema, message) {
  const record = await readRecord(path, schema);
  if (!record) throw new Error(message);
  return record;
}

export function openDetachedRpc(directory) {
  const statusPath = join(directory, 'status.json');
  const readStatus = () => readRecord(statusPath, statusSchema);
  return {
    directory,
    snapshot: () => readRecord(join(directory, 'snapshot.json'), snapshotSchema),
    activity: () => requiredRecord(join(directory, 'activity.json'), activitySchema, 'Detached RPC activity is unavailable.'),
    status: async () => (await requiredRecord(statusPath, statusSchema, 'Detached RPC has not started.')).kind,
    async send(command) {
      const status = await readStatus();
      if (terminal(status)) throw new Error(`Detached RPC ${status.kind}: ${status.error ?? 'process closed'}`);
      const id = randomUUID();
      const responsePath = join(directory, 'responses', `${id}.json`);
      await writeRecord(join(directory, 'commands', `${id}.json`), { id, command });
      const deadline = Date.now() + requestDeadlineMs;
      while (Date.now() < deadline) {
        const response = await readRecord(responsePath, responseSchema);
        if (response) {
          await unlink(responsePath);
          return response;
        }
        const current = await readStatus();
        if (terminal(current)) throw new Error(`Detached RPC ${current.kind}: ${current.error ?? 'process closed'}`);
        await pause();
      }
      throw new Error(`Detached RPC timed out: ${command.type}`);
    },
    async close() {
      if (terminal(await readStatus())) return;
      try {
        await this.send({ type: 'pstack_close' });
      } catch (error) {
        if (!terminal(await readStatus())) throw error;
      }
      const deadline = Date.now() + requestDeadlineMs;
      while (Date.now() < deadline) {
        if (terminal(await readStatus())) return;
        await pause();
      }
      throw new Error('Detached RPC shutdown timed out.');
    },
  };
}

export async function startDetachedRpc({ directory: base, cwd, agentDir, args, headless, closeAfterSettle, ownerId }) {
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'rpc-'));
  await Promise.all(['commands', 'processing', 'responses'].map((name) => mkdir(join(directory, name), { mode: 0o700 })));
  await mkdir(agentDir, { recursive: true });
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle', 'cli.js');
  await writeRecord(join(directory, 'launch.json'), { executable: process.execPath, args: [cli, '--mode', 'rpc', ...args], cwd: await realpath(cwd), agentDir, headless, closeAfterSettle, ownerId });
  const supervisor = spawn(process.execPath, [fileURLToPath(new URL('./detached-rpc-server.mjs', import.meta.url)), directory], { detached: true, stdio: 'ignore' });
  let failure;
  supervisor.on('error', (error) => {
    failure = error;
  });
  supervisor.unref();
  const handle = openDetachedRpc(directory);
  try {
    const deadline = Date.now() + requestDeadlineMs;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      const status = await readRecord(join(directory, 'status.json'), statusSchema);
      if (status?.kind === 'ready') return handle;
      if (terminal(status)) throw new Error(`Detached RPC ${status.kind}: ${status.error ?? 'startup exited'}`);
      if (supervisor.exitCode !== null || supervisor.signalCode !== null) throw new Error('Detached RPC supervisor exited before readiness.');
      await pause();
    }
    throw new Error('Detached RPC startup timed out.');
  } catch (error) {
    supervisor.kill('SIGTERM');
    throw error;
  }
}
