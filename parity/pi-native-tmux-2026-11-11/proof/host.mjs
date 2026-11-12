#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const MAX_CONTROL = 65_536;
const MAX_RPC = 8 * 1024 * 1024;
const MAX_JOURNAL = 24 * 1024 * 1024;
const DEADLINE = 10_000;

export function assignmentAt(path) {
  const file = resolve(path);
  const bytes = readFileSync(file);
  const assignment = JSON.parse(bytes.toString('utf8'));
  if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) throw new Error('Invalid assignment');
  const keys = ['schemaVersion', 'id', 'root', 'piCommand', 'fixture'];
  if (Object.keys(assignment).some((key) => !keys.includes(key)) || keys.some((key) => !(key in assignment))) throw new Error('Invalid assignment fields');
  if (assignment.schemaVersion !== 1 || typeof assignment.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(assignment.id)) throw new Error('Unsafe worker identifier');
  if (typeof assignment.root !== 'string' || !isAbsolute(assignment.root) || realpathSync(assignment.root) !== assignment.root || file !== join(assignment.root, 'assignment.json')) throw new Error('Assignment must have a canonical private root');
  const owned = (target, directory) => {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error(`Not a private owned ${directory ? 'directory' : 'file'}: ${target}`);
  };
  owned(assignment.root, true);
  owned(file, false);
  for (const name of ['work', 'home', 'agent', 'sessions']) owned(join(assignment.root, name), true);
  if (!Array.isArray(assignment.piCommand) || assignment.piCommand.length < 1 || assignment.piCommand.length > 2 || assignment.piCommand.some((part) => typeof part !== 'string' || !isAbsolute(part) || part.includes('\0'))) throw new Error('Pi launch must be an absolute executable and optional script');
  if (typeof assignment.fixture !== 'string' || !isAbsolute(assignment.fixture) || !lstatSync(assignment.fixture).isFile()) throw new Error('Fixture must be an explicit file');
  const socket = join(assignment.root, 'control.sock');
  if (Buffer.byteLength(socket) > 100) throw new Error('Control socket path is too long');
  return Object.freeze({ ...assignment, file, socket, digest: createHash('sha256').update(bytes).digest('hex'), session: `pstack-proof-${assignment.id}` });
}

function validateControl(value, assignment, instance) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Control must be an object');
  const allowed = ['id', 'workerId', 'digest', 'instance', 'operation', 'text'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unknown control field');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)) throw new Error('Invalid command id');
  if (value.workerId !== assignment.id || value.digest !== assignment.digest) throw new Error('Assignment identity mismatch');
  if (!['inspect', 'prompt', 'steer', 'follow-up', 'cancel', 'shutdown'].includes(value.operation)) throw new Error('Unknown operation');
  if (value.operation !== 'inspect' && value.instance !== instance) throw new Error('Host instance mismatch');
  if (['prompt', 'steer', 'follow-up'].includes(value.operation)) {
    if (typeof value.text !== 'string' || value.text.length === 0 || Buffer.byteLength(value.text) > 32_768) throw new Error('Instruction must contain 1 to 32768 bytes');
  } else if ('text' in value) throw new Error('Unexpected instruction text');
  return value;
}

export async function runHost(assignmentFile) {
  const assignment = assignmentAt(assignmentFile);
  const root = assignment.root;
  const instance = randomUUID();
  mkdirSync(join(root, 'claim'), { mode: 0o700 });
  writeFileSync(join(root, 'claim', 'identity.json'), `${JSON.stringify({ digest: assignment.digest, instance, hostPid: process.pid })}\n`, { mode: 0o600, flag: 'wx' });
  let phase = 'starting';
  let reason;
  let exit;
  let piState;
  let stderr = '';
  let sequence = 0;
  let journalBytes = 0;
  let requestNumber = 0;
  let assistantFailure;
  let observedAbort = false;
  let childExited = false;
  let shuttingDown = false;
  let mutationPending = false;
  let server;
  let terminal;
  let lifespan;
  let fatalPromise;
  const waiting = new Map();
  const seen = new Set();
  const sockets = new Set();
  const childArgs = [...assignment.piCommand.slice(1), '--mode', 'rpc', '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-approve', '--extension', assignment.fixture, '--model', 'scripted/echo', '--tools', 'read,write,bash', '--session-dir', join(root, 'sessions')];
  const child = spawn(assignment.piCommand[0], childArgs, {
    cwd: join(root, 'work'),
    detached: true,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(root, 'home'), PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const observation = () => ({ phase, workerId: assignment.id, digest: assignment.digest, instance, hostPid: process.pid, piPid: child.pid, tmuxSession: assignment.session, model: piState?.model && { provider: piState.model.provider, id: piState.model.id }, sessionFile: piState?.sessionFile, sequence, reason, exit, stderrTail: stderr });
  const save = (kind, data) => {
    const line = `${JSON.stringify({ sequence: ++sequence, kind, data })}\n`;
    journalBytes += Buffer.byteLength(line);
    if (journalBytes > MAX_JOURNAL) throw new Error('Proof journal limit exceeded');
    appendFileSync(join(root, 'events.jsonl'), line, { mode: 0o600 });
    const temporary = join(root, 'state.json.tmp');
    writeFileSync(temporary, `${JSON.stringify(observation())}\n`, { mode: 0o600 });
    renameSync(temporary, join(root, 'state.json'));
  };
  const display = (kind, text) => process.stdout.write(`[${kind}] ${JSON.stringify(text)}\n`);
  const rejectWaiting = (error) => {
    for (const pending of waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    waiting.clear();
  };
  const signalChild = (signal) => {
    if (childExited || child.pid === undefined) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const closed = new Promise((resolveClosed) => {
    child.once('close', (code, signal) => {
      childExited = true;
      exit = { code, signal };
      rejectWaiting(new Error(`Pi exited (${code ?? signal}); outstanding command outcomes are unknown`));
      phase = shuttingDown ? 'unavailable' : 'failed';
      reason = shuttingDown ? 'Explicit shutdown' : 'Unexpected Pi exit';
      save('pi_exit', exit);
      display('host', observation());
      resolveClosed(exit);
    });
  });
  const writeRpc = (record) => new Promise((resolveWrite, reject) => {
    if (childExited || child.stdin.destroyed) return reject(new Error('Pi is unavailable; outcome unknown'));
    child.stdin.write(`${JSON.stringify(record)}\n`, (error) => error ? reject(error) : resolveWrite());
  });
  const request = (type, fields = {}) => new Promise((resolveRequest, reject) => {
    if (waiting.size >= 32) return reject(new Error('Too many pending RPC commands'));
    const id = `${instance}-${++requestNumber}`;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Pi ${type} deadline expired; outcome unknown, do not retry`)); }, DEADLINE);
    waiting.set(id, { timer, resolve: resolveRequest, reject });
    writeRpc({ id, type, ...fields }).catch((error) => {
      const pending = waiting.get(id);
      if (!pending) return;
      waiting.delete(id);
      clearTimeout(timer);
      reject(error);
    });
  });
  const closePi = async () => {
    if (childExited) return closed;
    child.stdin.end();
    const term = setTimeout(() => signalChild('SIGTERM'), 3_000);
    const kill = setTimeout(() => signalChild('SIGKILL'), 5_000);
    try { return await closed; } finally { clearTimeout(term); clearTimeout(kill); }
  };
  const finishHost = () => {
    clearTimeout(lifespan);
    terminal?.close();
    process.stdin.pause();
    server?.close(() => { process.exitCode = phase === 'failed' ? 1 : 0; });
    for (const socket of sockets) socket.end();
  };
  const fail = (error) => {
    if (fatalPromise) return fatalPromise;
    phase = 'failed';
    reason = error.message;
    display('host failure', reason);
    fatalPromise = (async () => {
      try { save('failure', { reason }); } catch { /* The original failure remains on stderr if storage is unavailable. */ }
      signalChild('SIGTERM');
      await closePi();
      phase = 'failed';
      finishHost();
    })();
    return fatalPromise;
  };
  child.once('error', (error) => { void fail(error); });
  child.stdin.on('error', (error) => { if (!shuttingDown && !childExited) void fail(error); });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8192);
    display('pi diagnostic', chunk.toString('utf8').slice(-8192));
  });
  let rpcBuffer = Buffer.alloc(0);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  child.stdout.on('data', (chunk) => {
    try {
      rpcBuffer = Buffer.concat([rpcBuffer, chunk]);
      let newline;
      while ((newline = rpcBuffer.indexOf(10)) !== -1) {
        if (newline > MAX_RPC) throw new Error('Pi record exceeds proof limit');
        let line = rpcBuffer.subarray(0, newline);
        rpcBuffer = rpcBuffer.subarray(newline + 1);
        if (line.at(-1) === 13) line = line.subarray(0, -1);
        const record = JSON.parse(decoder.decode(line));
        if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.type !== 'string') throw new Error('Malformed Pi RPC record');
        if (record.type === 'agent_start') { phase = 'running'; assistantFailure = undefined; observedAbort = false; }
        if (record.type === 'message_end' && record.message?.role === 'assistant') {
          if (['error', 'aborted'].includes(record.message.stopReason)) assistantFailure = record.message.errorMessage ?? record.message.stopReason;
          display('pi response', record.message);
        }
        if (record.type === 'tool_execution_start') display('pi tool', record.toolName);
        if (record.type === 'agent_settled') {
          observedAbort = record.aborted === true;
          if (!['cancelling', 'stopping'].includes(phase)) phase = observedAbort ? 'aborted' : assistantFailure ? 'failed' : 'idle';
          reason = assistantFailure;
          display('host settled', { phase, aborted: observedAbort, reason });
        }
        save('pi', record);
        if (record.type === 'response') {
          const pending = waiting.get(record.id);
          if (pending) {
            waiting.delete(record.id);
            clearTimeout(pending.timer);
            if (record.success === true) pending.resolve(record.data);
            else pending.reject(new Error(record.error ?? 'Pi rejected command'));
          }
        }
        if (record.type === 'extension_ui_request') {
          display('pi ui', record);
          if (['select', 'confirm', 'input', 'editor'].includes(record.method)) void writeRpc({ type: 'extension_ui_response', id: record.id, cancelled: true }).catch(fail);
        }
      }
      if (rpcBuffer.length > MAX_RPC) throw new Error('Unterminated Pi record exceeds proof limit');
    } catch (error) { void fail(error); }
  });
  const inspectPi = async () => {
    if (childExited) return observation();
    const fresh = await request('get_state');
    if (!fresh || fresh.model?.provider !== 'scripted' || fresh.model?.id !== 'echo' || typeof fresh.sessionFile !== 'string' || dirname(fresh.sessionFile) !== join(root, 'sessions')) throw new Error('Pi model or session identity mismatch');
    if (piState && fresh.sessionFile !== piState.sessionFile) throw new Error('Pi session changed unexpectedly');
    piState = fresh;
    return observation();
  };
  const dispatch = async (operation, text) => {
    if (operation === 'inspect') return inspectPi();
    if (mutationPending || shuttingDown || ['cancelling', 'stopping'].includes(phase)) throw new Error('Host control is busy; request rejected');
    if (childExited && operation !== 'shutdown') throw new Error('Pi has exited; request rejected');
    mutationPending = true;
    try {
      if (['prompt', 'steer', 'follow-up'].includes(operation)) {
        const result = await request(operation === 'follow-up' ? 'follow_up' : operation, { message: text });
        return { phase: 'accepted', disposition: result?.disposition, instance };
      }
      if (operation === 'cancel') {
        const before = await request('get_state');
        phase = 'cancelling';
        const removed = await request('clear_queue');
        await request('abort');
        const fresh = await request('get_state');
        if (fresh.isStreaming || fresh.isCompacting || fresh.pendingMessageCount !== 0 || (before.isStreaming && !observedAbort)) throw new Error('Cancellation did not establish aborted quiescence');
        phase = before.isStreaming ? 'aborted' : 'idle';
        save('cancelled', { removed, phase });
        return { phase: 'accepted', disposition: 'cancelled', removed, observation: observation() };
      }
      shuttingDown = true;
      phase = 'stopping';
      if (!childExited) {
        await request('clear_queue');
        await request('abort');
      }
      await closePi();
      save('shutdown', exit);
      return { phase: 'accepted', disposition: 'shutting-down', exit };
    } finally { mutationPending = false; }
  };
  try {
    save('launch', { command: [assignment.piCommand[0], ...childArgs], hostPid: process.pid, piPid: child.pid });
    await inspectPi();
    await request('set_auto_retry', { enabled: false });
    phase = 'idle';
    save('ready', observation());
    server = createServer((socket) => {
      if (sockets.size >= 8) { socket.destroy(); return; }
      sockets.add(socket);
      let buffer = Buffer.alloc(0);
      let received = false;
      const timeout = setTimeout(() => socket.destroy(), DEADLINE);
      socket.on('error', () => undefined);
      socket.once('close', () => { clearTimeout(timeout); sockets.delete(socket); });
      const respond = (value) => socket.end(`${JSON.stringify(value)}\n`);
      socket.on('data', (chunk) => {
        if (received) { socket.destroy(); return; }
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_CONTROL) { received = true; respond({ ok: false, error: 'Control record exceeds limit' }); return; }
        const newline = buffer.indexOf(10);
        if (newline === -1) return;
        received = true;
        void (async () => {
          let control;
          try {
            if (buffer.subarray(newline + 1).length !== 0) throw new Error('Only one control record per connection');
            control = validateControl(JSON.parse(decoder.decode(buffer.subarray(0, newline))), assignment, instance);
            if (seen.has(control.id)) throw new Error('Duplicate command id; request not replayed');
            if (seen.size >= 4096) throw new Error('Proof command limit reached');
            seen.add(control.id);
            const result = await dispatch(control.operation, control.text);
            respond({ ok: true, id: control.id, workerId: assignment.id, digest: assignment.digest, instance, result });
            if (control.operation === 'shutdown') finishHost();
          } catch (error) {
            respond({ ok: false, id: control?.id, error: error.message, outcome: /unknown/.test(error.message) ? 'unknown' : 'rejected' });
            if (shuttingDown) { await closePi(); finishHost(); }
          }
        })();
      });
    });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(assignment.socket, resolveListen); });
    chmodSync(assignment.socket, 0o600);
    display('host ready', observation());
    display('host help', 'prompt <text> | steer <text> | follow-up <text> | cancel | status | shutdown');
    terminal = createInterface({ input: process.stdin, crlfDelay: Infinity });
    terminal.on('line', (line) => {
      const space = line.indexOf(' ');
      const operation = (space === -1 ? line : line.slice(0, space)) === 'status' ? 'inspect' : space === -1 ? line : line.slice(0, space);
      const text = space === -1 ? undefined : line.slice(space + 1);
      try {
        validateControl({ id: randomUUID(), workerId: assignment.id, digest: assignment.digest, instance, operation, ...(text === undefined ? {} : { text }) }, assignment, instance);
        void dispatch(operation, text).then((result) => { display('operator receipt', result); if (operation === 'shutdown') finishHost(); }).catch((error) => display('operator error', error.message));
      } catch (error) { display('operator error', error.message); }
    });
    lifespan = setTimeout(() => { void fail(new Error('Proof duration limit reached')); }, 240_000);
    for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(signal, () => {
      if (shuttingDown) return;
      void dispatch('shutdown').then(finishHost).catch(fail);
    });
  } catch (error) { await fail(error); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHost(process.argv[2]).catch((error) => { console.error(`[host failure] ${error.message}`); process.exitCode = 1; });
}
