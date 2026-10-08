import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_IDLE_TIMEOUT_MS = 120000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 20;
const SILENT_UI_METHODS = new Set(['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultAnswer(request) {
  if (request.method === 'select') return request.options?.[0];
  if (request.method === 'confirm') return true;
  if (request.method === 'input') return '';
  return request.prefill ?? '';
}

function responseFor(request, value) {
  if (request.method === 'confirm') return { type: 'extension_ui_response', id: request.id, confirmed: Boolean(value) };
  return { type: 'extension_ui_response', id: request.id, value };
}

export function createRpcSession(options = {}) {
  const { packagePath, agentDir, capturePath = null, persistSession = false, answers = {}, env = {}, allowGlobalExtensions = false, extraExtensions = [] } = options;
  if (!packagePath) throw new Error('createRpcSession requires packagePath');
  if (!agentDir) throw new Error('createRpcSession requires agentDir');
  const cwd = options.cwd ?? agentDir;
  const piBin = options.piBin ?? process.env.PI_BIN ?? 'pi';
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  let sessionId = options.sessionId;

  if (capturePath) mkdirSync(dirname(capturePath), { recursive: true });

  const records = [];
  const dialogLog = [];
  const pending = new Map();
  let child = null;
  let exitPromise = null;
  let buffer = '';
  let stderr = '';
  let requestSeq = 0;
  let settleCount = 0;
  let closedError = null;
  let closed = false;
  let closePromise = null;
  let stoppingPromise = null;

  function spawnArgs() {
    const args = ['--mode', 'rpc'];
    if (!allowGlobalExtensions) args.push('--no-extensions');
    args.push('-e', packagePath);
    for (const extensionPath of extraExtensions) args.push('-e', extensionPath);
    if (sessionId) args.push('--session-id', sessionId);
    if (!persistSession) args.push('--no-session');
    return args;
  }

  function failPending(error) {
    closedError ??= error;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(closedError);
      pending.delete(id);
    }
  }

  function settleFailure(id, error) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.reject(error);
  }

  function writeLine(payload) {
    if (!child || child.stdin.destroyed) return false;
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  function ingest(line) {
    const trimmed = line.replace(/\r$/, '');
    if (!trimmed) return;
    if (capturePath) appendFileSync(capturePath, `${trimmed}\n`);
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      records.push({ type: 'unparsed', line: trimmed });
      return;
    }
    records.push(record);
    receive(record);
  }

  function receive(record) {
    if (record?.type === 'response') {
      const entry = record.id === undefined ? undefined : pending.get(record.id);
      if (entry) {
        pending.delete(record.id);
        clearTimeout(entry.timer);
        if (record.success) entry.resolve(record.data ?? null);
        else entry.reject(new Error(record.error ?? `RPC ${record.command ?? 'request'} failed`));
      }
      return;
    }
    if (record?.type === 'extension_ui_request') {
      answerUiRequest(record);
      return;
    }
    if (record?.type === 'agent_settled') settleCount += 1;
  }

  function answerUiRequest(request) {
    const entry = { request, answered: false, usedDefault: false, answer: undefined };
    if (!SILENT_UI_METHODS.has(request.method)) {
      const supplied = typeof answers[request.method] === 'function' ? answers[request.method](request) : answers[request.method];
      const usedDefault = supplied === undefined;
      const value = usedDefault ? defaultAnswer(request) : supplied;
      entry.answered = true;
      entry.usedDefault = usedDefault;
      entry.answer = value;
      writeLine(responseFor(request, value));
    }
    dialogLog.push(entry);
  }

  function onData(chunk) {
    buffer += chunk;
    let boundary = buffer.indexOf('\n');
    while (boundary >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      ingest(line);
      boundary = buffer.indexOf('\n');
    }
  }

  function startChild() {
    closedError = null;
    buffer = '';
    const spawned = spawn(piBin, spawnArgs(), {
      cwd,
      env: { ...process.env, ...env, PI_CODING_AGENT_DIR: agentDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = spawned;
    spawned.stdin.on('error', (error) => failPending(error));
    spawned.stdout.setEncoding('utf8');
    spawned.stdout.on('data', onData);
    spawned.stderr.setEncoding('utf8');
    spawned.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    spawned.on('error', (error) => failPending(error));
    exitPromise = new Promise((resolve) => {
      spawned.once('close', (code, signal) => {
        if (buffer.trim()) ingest(buffer);
        buffer = '';
        if (child === spawned) failPending(new Error(`pi exited code=${code} signal=${signal}: ${stderr}`));
        resolve({ code, signal });
      });
    });
  }

  function send(command) {
    if (closed) return Promise.reject(new Error('RPC session is closed'));
    if (stoppingPromise) return Promise.reject(new Error('RPC session is stopping'));
    if (closedError) return Promise.reject(closedError);
    if (!child) return Promise.reject(new Error('RPC session has no child process'));
    return request(command);
  }

  function request(command, timeoutMs = requestTimeoutMs) {
    const id = command.id ?? `req-${++requestSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC request '${command.type}' timed out after ${timeoutMs}ms (id=${id}): ${stderr}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
          if (error) settleFailure(id, error);
        });
      } catch (error) {
        settleFailure(id, error);
      }
    });
  }

  async function waitForSettle(before) {
    const deadline = Date.now() + idleTimeoutMs;
    while (settleCount <= before) {
      if (closedError) throw closedError;
      if (Date.now() > deadline) throw new Error(`RPC prompt did not settle within ${idleTimeoutMs}ms (agent_settled count stayed at ${settleCount})`);
      await delay(POLL_INTERVAL_MS);
    }
  }

  async function waitForIdle(timeoutMs = idleTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    for (;;) {
      last = await state();
      if (!last.isStreaming && last.pendingMessageCount === 0) return last;
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for Pi RPC idle; last state: isStreaming=${last.isStreaming} pendingMessageCount=${last.pendingMessageCount} isCompacting=${last.isCompacting} sessionId=${last.sessionId}`);
      }
      await delay(POLL_INTERVAL_MS);
    }
  }

  async function prompt(message) {
    const before = settleCount;
    const result = await send({ type: 'prompt', message });
    if (result?.disposition === 'started') await waitForSettle(before);
    await waitForIdle();
    return result;
  }

  async function waitFor(predicate, { timeoutMs = idleTimeoutMs, description = 'an RPC record' } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = records.find(predicate);
      if (match) return match;
      if (closedError) throw closedError;
      if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
      await delay(POLL_INTERVAL_MS);
    }
  }

  function stopChild() {
    if (stoppingPromise) return stoppingPromise;
    const finishing = child;
    if (!finishing) return Promise.resolve();
    const done = exitPromise;
    const deadline = performance.now() + shutdownTimeoutMs;
    let forced = false;
    const kill = (error = new Error('RPC shutdown deadline reached')) => {
      if (forced) return;
      records.push({ type: 'rpc_shutdown_error', error: error.message });
      forced = true;
      if (finishing.exitCode === null && finishing.signalCode === null) finishing.kill('SIGKILL');
    };
    const timer = setTimeout(kill, shutdownTimeoutMs);
    const lifecycleRequest = (command) => {
      const remaining = deadline - performance.now();
      if (forced || remaining <= 0) return Promise.reject(new Error('RPC shutdown deadline reached'));
      if (closedError) return Promise.reject(closedError);
      return request(command, Math.min(requestTimeoutMs, remaining));
    };
    stoppingPromise = (async () => {
      try {
        if (finishing.exitCode === null && finishing.signalCode === null) {
          try {
            await lifecycleRequest({ type: 'abort' });
            for (;;) {
              const snapshot = await lifecycleRequest({ type: 'get_state' });
              if (forced || performance.now() >= deadline) break;
              if (snapshot?.isStreaming === false && snapshot.isCompacting === false && snapshot.pendingMessageCount === 0) {
                if (!finishing.stdin.destroyed) finishing.stdin.end();
                break;
              }
              await delay(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - performance.now())));
            }
          } catch (error) {
            kill(error);
          }
        }
        await done;
      } finally {
        clearTimeout(timer);
        if (child === finishing) child = null;
        stoppingPromise = null;
      }
    })();
    return stoppingPromise;
  }

  async function restart() {
    if (closed) throw new Error('RPC session is closed');
    if (persistSession && !sessionId) {
      try {
        sessionId = (await state()).sessionId;
      } catch {
        sessionId = undefined;
      }
    }
    await stopChild();
    if (closed) throw new Error('RPC session is closed');
    startChild();
  }

  function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = stopChild();
    return closePromise;
  }

  function state() {
    return send({ type: 'get_state' });
  }

  async function commands() {
    return (await send({ type: 'get_commands' })).commands;
  }

  async function messages() {
    return (await send({ type: 'get_messages' })).messages;
  }

  async function models() {
    return (await send({ type: 'get_available_models' })).models;
  }

  function bash(command) {
    return send({ type: 'bash', command });
  }

  startChild();

  return {
    capturePath,
    piBin,
    get pid() {
      return child?.pid ?? null;
    },
    get stderr() {
      return stderr;
    },
    get records() {
      return [...records];
    },
    get uiRequests() {
      return records.filter((record) => record.type === 'extension_ui_request');
    },
    get notifications() {
      return records.filter((record) => record.type === 'extension_ui_request' && record.method === 'notify');
    },
    get dialogs() {
      return [...dialogLog];
    },
    get entries() {
      return records.filter((record) => record.type === 'entry_appended').map((record) => record.entry);
    },
    get customMessages() {
      return records.filter((record) => record.type === 'message_end' && record.message?.role === 'custom').map((record) => record.message);
    },
    ofType(type) {
      return records.filter((record) => record.type === type);
    },
    send,
    prompt,
    waitForSettle,
    waitForIdle,
    waitFor,
    restart,
    close,
    state,
    commands,
    messages,
    models,
    bash,
  };
}
