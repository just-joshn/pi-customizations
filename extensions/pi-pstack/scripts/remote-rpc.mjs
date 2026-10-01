import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { parseExecutor } from './remote-executor-schema.mjs';
import { readRecord, statusSchema } from './detached-rpc-protocol.mjs';
import { openDetachedRpc, startDetachedRpc } from './detached-rpc-client.mjs';

const run = promisify(execFile);
const Request = Type.Object({
  operation: Type.Union(['start', 'send', 'info', 'activity', 'snapshot', 'close'].map((value) => Type.Literal(value))),
  executor: Type.Unknown(),
  taskId: Type.String({ pattern: '^[0-9a-f-]{36}$' }),
  directory: Type.Optional(Type.String()),
  sha: Type.Optional(Type.String({ pattern: '^[0-9a-f]{40,64}$' })),
  subdirectory: Type.Optional(Type.String()),
  systemPrompt: Type.Optional(Type.String()),
  args: Type.Optional(Type.Array(Type.String())),
  command: Type.Optional(Type.Unknown()),
  invocation: Type.Optional(Type.String()),
  sessionFile: Type.Optional(Type.String()),
});

async function git(repository, ...args) {
  return (await run('git', ['-C', repository, ...args])).stdout.trim();
}

async function machine(executor) {
  const machineId = (await readFile('/etc/machine-id', 'utf8')).trim();
  if (machineId !== executor.machineId) throw new Error('Remote machine identity differs from the configured executor.');
  const virtualization = (await run('systemd-detect-virt', ['--vm'])).stdout.trim();
  if (!virtualization || virtualization === 'none') throw new Error('Remote executor is not an independently virtualized machine.');
  try {
    await run('systemd-detect-virt', ['--container']);
    throw new Error('Container execution cannot satisfy VM isolation.');
  } catch (error) {
    if (error.code !== 1) throw error;
  }
  const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  return { machineId, hostname: hostname(), isolation: executor.isolation, virtualization, bootId };
}

async function start(request, executor, identity, directory) {
  if (!request.sha || !request.args || request.systemPrompt === undefined) throw new Error('Remote startup requires exact SHA, native arguments, and system prompt.');
  const cwdRoot = join(directory, 'worktree');
  if (request.sessionFile) {
    await assertNoWriter(directory);
    const sessionRoot = await realpath(join(directory, 'session'));
    const sessionFile = await realpath(request.sessionFile);
    if (sessionFile !== request.sessionFile || !sessionFile.startsWith(`${sessionRoot}/`)) throw new Error('Remote resume transcript is outside its owned job.');
  } else {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await git(executor.repository, 'worktree', 'add', '--detach', cwdRoot, request.sha);
  }
  const cwd = await realpath(resolve(cwdRoot, request.subdirectory ?? '.'));
  if (cwd !== cwdRoot && !cwd.startsWith(`${cwdRoot}/`)) throw new Error('Remote workspace escapes its checkout.');
  if ((await git(cwdRoot, 'rev-parse', 'HEAD')) !== request.sha) throw new Error('Remote checkout is not at the requested exact SHA.');
  const systemFile = join(directory, 'system.txt');
  await writeFile(systemFile, request.systemPrompt, { mode: 0o600 });
  const handle = await startDetachedRpc({ directory, cwd, agentDir: executor.agentDir, ownerId: request.taskId, headless: true, closeAfterSettle: true, args: [...request.args, '--append-system-prompt', systemFile, '--session-dir', join(directory, 'session'), ...(request.sessionFile ? ['--session', request.sessionFile] : [])] });
  try {
    const state = await handle.send({ type: 'get_state' });
    if (!state.success || state.command !== 'get_state' || !state.data.sessionFile) throw new Error('Remote Pi did not provide a durable session.');
    return { directory: handle.directory, cwd, sha: request.sha, executorId: executor.id, ...identity, sessionFile: state.data.sessionFile, sessionId: state.data.sessionId, model: state.data.model, thinkingLevel: state.data.thinkingLevel };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertNoWriter(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (!item.isDirectory() || !item.name.startsWith('rpc-')) continue;
    const status = await readRecord(join(directory, item.name, 'status.json'), statusSchema);
    const state = await openDetachedRpc(join(directory, item.name)).info();
    if (state.kind === 'starting' || state.kind === 'ready') throw new Error('Remote task already has a live transcript writer.');
    for (const pid of [state.pid, status?.kind === 'ready' ? status.childPid : undefined].filter(Number.isInteger)) {
      try {
        process.kill(pid, 0);
        throw new Error('Remote resume requires the old writer to exit.');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}

async function stopOrphan(handle, directory, taskId) {
  const status = await readRecord(join(handle.directory, 'status.json'), statusSchema);
  const current = await handle.info();
  if (status?.kind !== 'ready' || current.kind !== 'failed') return;
  await run('python3', [fileURLToPath(new URL('./remote-stop-orphan.py', import.meta.url)), directory, taskId, String(status.childPid)]);
}

async function lease(executor, taskId, action) {
  const directory = join(executor.agentDir, 'pstack-remote');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await run('flock', ['--exclusive', join(directory, 'machine.lock'), process.execPath, fileURLToPath(new URL('./remote-lease.mjs', import.meta.url)), directory, taskId, action]);
}

async function dispatch(request) {
  if (!Check(Request, request)) throw new Error('Invalid remote RPC request.');
  const executor = parseExecutor(request.executor);
  const identity = await machine(executor);
  const directory = join(executor.agentDir, 'pstack-remote', request.taskId);
  if (request.operation === 'start') {
    await lease(executor, request.taskId, 'claim');
    try {
      return await start(request, executor, identity, directory);
    } catch (error) {
      await lease(executor, request.taskId, 'release');
      throw error;
    }
  }
  if (!request.directory?.startsWith(`${directory}/rpc-`) || !/^rpc-[a-zA-Z0-9]+$/.test(basename(request.directory)) || (await realpath(request.directory)) !== request.directory) throw new Error('Remote RPC directory is outside its owned job.');
  const handle = openDetachedRpc(request.directory);
  if (request.operation === 'send') return handle.send(request.command, request.invocation);
  if (request.operation === 'close') await stopOrphan(handle, directory, request.taskId);
  const result = await handle[request.operation]();
  if (request.operation === 'close') await lease(executor, request.taskId, 'release');
  return result;
}

try {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new Error('Remote request exceeds the input limit.');
    chunks.push(chunk);
  }
  const result = await dispatch(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  process.stdout.write(`${JSON.stringify({ success: true, result: result ?? null })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
