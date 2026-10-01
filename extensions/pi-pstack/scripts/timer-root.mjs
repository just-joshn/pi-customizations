import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { openDetachedRpc, startDetachedRpc } from './detached-rpc-client.mjs';
import { readRecord, statusSchema, writeRecord } from './detached-rpc-protocol.mjs';
import { timerRecord } from './timer-client.mjs';

async function identity(handle) {
  const state = await handle.send({ type: 'get_state' });
  const status = await handle.info();
  if (!state.success || !state.data?.sessionFile || status.kind !== 'ready') throw new Error('Timer root did not provide a durable live session.');
  return { rpcDirectory: handle.directory, sessionFile: state.data.sessionFile, runId: state.data.sessionId, childPid: status.childPid, model: state.data.model };
}

async function remainingWriter(saved) {
  if (!saved.childPid) return false;
  try {
    const { stdout } = await promisify(execFile)('ps', ['-p', String(saved.childPid), '-o', 'command=']);
    if (!stdout.trim()) return false;
    if (!stdout.includes('cli.js') || !stdout.includes(join(saved.rpcDirectory, '..', 'session'))) throw new Error('Cannot verify the prior timer writer identity; refusing to resume its transcript.');
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  }
}

async function stopOrphan(saved) {
  if (!(await remainingWriter(saved))) return;
  process.kill(saved.childPid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (await remainingWriter(saved)) {
    if (Date.now() >= deadline) throw new Error('Prior timer writer did not exit; refusing a second transcript writer.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function discover(directory, savedDirectory) {
  const candidates = [];
  for (const name of (await readdir(directory)).filter((item) => item.startsWith('rpc-'))) {
    const path = join(directory, name);
    if (path === savedDirectory) continue;
    const raw = await readRecord(join(path, 'status.json'), statusSchema);
    if (raw?.kind === 'exited') continue;
    const handle = openDetachedRpc(path);
    if (raw?.kind !== 'ready' || (await handle.info()).kind !== 'ready') throw new Error(`Timer bootstrap ${name} requires reconciliation before another transcript writer can start.`);
    candidates.push(handle);
  }
  if (candidates.length > 1) throw new Error('Multiple timer RPC roots found; refusing to choose a transcript writer.');
  return candidates[0];
}

async function seedSession(directory, cwd) {
  const saved = await timerRecord(join(directory, 'session-seed.json'));
  if (saved) return saved.sessionFile;
  const manager = SessionManager.create(cwd, join(directory, 'session'));
  manager.appendMessage({ role: 'user', content: 'This is the persistent timer root. Initialization is complete; execute only the scheduled prompts that follow.', timestamp: Date.now() });
  const sessionFile = manager.getSessionFile();
  if (!sessionFile) throw new Error('Timer bootstrap did not create a persistent session.');
  await writeRecord(join(directory, 'session-seed.json'), { sessionFile });
  return sessionFile;
}

export async function openTimerRoot(directory, launch) {
  const saved = await timerRecord(join(directory, 'root.json'));
  const discovered = await discover(directory, saved?.rpcDirectory);
  if (saved && discovered) throw new Error('Multiple timer RPC roots found; refusing to choose a transcript writer.');
  let handle = saved ? openDetachedRpc(saved.rpcDirectory) : discovered;
  const status = await handle?.info();
  if (status?.kind !== 'ready') {
    if (saved) await stopOrphan(saved);
    const sessionFile = saved?.sessionFile ?? (await seedSession(directory, launch.cwd));
    handle = await startDetachedRpc({ ...launch, args: [...launch.args, '--session', sessionFile], directory, headless: true, closeAfterSettle: false });
  }
  try {
    const root = await identity(handle);
    if (saved && saved.sessionFile !== root.sessionFile) throw new Error('Timer recovery selected a different transcript.');
    if (launch.expectedModel && (root.model?.provider !== launch.expectedModel.provider || root.model?.id !== launch.expectedModel.id)) throw new Error('Timer root could not load the requested model and provider.');
    await writeRecord(join(directory, 'root.json'), root);
    return { handle, root };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export async function occurrenceCompleted(handle, invocation) {
  const result = await handle.send({ type: 'get_entries' });
  if (!result.success) throw new Error(result.error);
  const messages = result.data.entries.filter((entry) => entry.type === 'message').map((entry) => entry.message);
  const start = messages.findLastIndex((message) => message.role === 'user' && JSON.stringify(message.content).includes(`[pstack-timer occurrence=${invocation} `));
  if (start < 0) return false;
  const nextUser = messages.findIndex((message, index) => index > start && message.role === 'user');
  return messages.slice(start + 1, nextUser < 0 ? undefined : nextUser).some((message) => message.role === 'assistant' && message.stopReason === 'stop');
}
