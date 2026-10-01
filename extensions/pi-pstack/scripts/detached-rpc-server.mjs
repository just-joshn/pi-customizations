import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { commandSchema, launchSchema, readRecord, writeRecord } from './detached-rpc-protocol.mjs';
import { rpcProcess } from './rpc-process.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: detached-rpc-server.mjs <directory>');
const statusPath = join(directory, 'status.json');
const pending = new Set();
let closing = false;
let transport;
let child;
let events;
let diagnostics;
let failure;
const update = (value) => writeRecord(statusPath, { ...value, pid: process.pid });
const respond = (id, command, success, value) => writeRecord(join(directory, 'responses', `${id}.json`), { id, type: 'response', command, success, ...(success ? { data: value } : { error: String(value) }) });
process.on('SIGTERM', () => {
  closing = true;
});
process.on('SIGINT', () => {
  closing = true;
});

async function dispatch(file) {
  const path = join(directory, 'processing', file);
  try {
    await rename(join(directory, 'commands', file), path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const envelope = await readRecord(path, commandSchema);
  if (!envelope) return;
  if (file !== `${envelope.id}.json`) throw new Error('Detached RPC command ID does not match its file.');
  await unlink(path);
  const { id, command } = envelope;
  if (command.type === 'pstack_close') {
    closing = true;
    await respond(id, command.type, true);
    return;
  }
  try {
    const data = await transport.send(command);
    await respond(id, command.type, true, data);
  } catch (error) {
    await respond(id, command.type, false, error instanceof Error ? error.message : String(error));
  }
}

try {
  const config = await readRecord(join(directory, 'launch.json'), launchSchema);
  if (!config) throw new Error('Detached RPC launch configuration is missing.');
  await update({ kind: 'starting' });
  child = spawn(config.executable, config.args, { cwd: config.cwd, env: { ...process.env, PI_CODING_AGENT_DIR: config.agentDir }, stdio: ['pipe', 'pipe', 'pipe'] });
  events = createWriteStream(join(directory, 'events.jsonl'), { flags: 'a', mode: 0o600 });
  diagnostics = createWriteStream(join(directory, 'stderr.log'), { flags: 'a', mode: 0o600 });
  events.on('error', (error) => {
    failure = error;
    closing = true;
  });
  diagnostics.on('error', (error) => {
    failure = error;
    closing = true;
  });
  child.stdout.pipe(events);
  child.stderr.pipe(diagnostics);
  child.on('close', () => {
    closing = true;
  });
  transport = rpcProcess(child, { requestDeadlineMs: 30000, shutdownDeadlineMs: 5000 });
  await transport.send({ type: 'get_state' });
  if (closing) throw new Error('Detached Pi process exited during startup.');
  await update({ kind: 'ready', childPid: child.pid });
  while (!closing) {
    const files = (await readdir(join(directory, 'commands'))).filter((name) => name.endsWith('.json')).sort();
    for (const file of files) {
      const operation = dispatch(file).catch((error) => {
        failure = error;
        closing = true;
      });
      pending.add(operation);
      operation.finally(() => pending.delete(operation));
    }
    if (!closing) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const code = await transport.finish();
  await Promise.allSettled([...pending]);
  if (failure) throw failure;
  await update({ kind: 'exited', code });
} catch (error) {
  await transport?.close().catch(() => {});
  await update({ kind: 'failed', error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  events?.end();
  diagnostics?.end();
}
