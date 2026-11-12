#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { assignmentAt } from './host.mjs';

const execute = promisify(execFile);
const hostFile = fileURLToPath(new URL('./host.mjs', import.meta.url));
export const TMUX_SOCKET = 'pstack-proof';

function exchange(assignment, control) {
  return new Promise((resolveExchange, reject) => {
    const socket = connect(assignment.socket);
    let bytes = Buffer.alloc(0);
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolveExchange(value);
    };
    const timer = setTimeout(() => finish(new Error('Control deadline expired; outcome unknown, do not retry mutations')), 12_000);
    socket.once('connect', () => socket.write(`${JSON.stringify(control)}\n`));
    socket.on('error', (error) => finish(error));
    socket.on('end', () => { if (!done) finish(new Error('Host disconnected; outcome unknown, do not retry mutations')); });
    socket.on('data', (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 65_536) return finish(new Error('Oversized host response'));
      const newline = bytes.indexOf(10);
      if (newline === -1) return;
      try {
        const response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, newline)));
        if (response.ok !== true) return finish(new Error(response.error ?? 'Host rejected control'));
        if (response.id !== control.id || response.workerId !== assignment.id || response.digest !== assignment.digest || typeof response.instance !== 'string') throw new Error('Host response identity mismatch');
        if (control.operation !== 'inspect' && response.instance !== control.instance) throw new Error('Host instance changed; outcome unknown');
        finish(undefined, response);
      } catch (error) { finish(error); }
    });
  });
}

function envelope(assignment, operation, fields = {}) {
  return { id: randomUUID(), workerId: assignment.id, digest: assignment.digest, operation, ...fields };
}

export async function inspectWorker(path) {
  const assignment = assignmentAt(path);
  try { return (await exchange(assignment, envelope(assignment, 'inspect'))).result; }
  catch (error) { return { phase: 'unavailable', workerId: assignment.id, reason: error.message }; }
}

export async function controlWorker(path, operation, text) {
  const assignment = assignmentAt(path);
  const handshake = await exchange(assignment, envelope(assignment, 'inspect'));
  return (await exchange(assignment, envelope(assignment, operation, { instance: handshake.instance, ...(text === undefined ? {} : { text }) }))).result;
}

export async function startWorker(path) {
  const assignment = assignmentAt(path);
  if (existsSync(resolve(assignment.root, 'claim'))) throw new Error('Assignment already claimed; replacement writer forbidden');
  await execute('tmux', ['-L', TMUX_SOCKET, 'new-session', '-d', '-s', assignment.session, '-c', assignment.root, process.execPath, hostFile, assignment.file]);
  const deadline = Date.now() + 15_000;
  let last;
  while (Date.now() < deadline) {
    last = await inspectWorker(path);
    if (last.phase === 'idle') return { ...last, attach: ['tmux', '-L', TMUX_SOCKET, 'attach-session', '-t', assignment.session] };
    if (last.phase === 'failed') throw new Error(`Worker failed: ${last.reason}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Worker startup deadline expired; do not restart this assignment: ${last?.reason}`);
}

export async function attachWorker(path) {
  const assignment = assignmentAt(path);
  const child = spawn('tmux', ['-L', TMUX_SOCKET, 'attach-session', '-t', assignment.session], { stdio: 'inherit' });
  return new Promise((resolveAttach, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveAttach() : reject(new Error(`tmux attach exited ${code}`)));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, path, action, text] = process.argv.slice(2);
  const main = async () => {
    if (operation === 'start') return startWorker(path);
    if (operation === 'inspect') return inspectWorker(path);
    if (operation === 'send') return controlWorker(path, action, text);
    if (operation === 'attach') return attachWorker(path);
    throw new Error('Usage: node worker.mjs start|inspect|attach <assignment.json> | send <assignment.json> prompt|steer|follow-up|cancel|shutdown [text]');
  };
  main().then((result) => { if (result !== undefined) console.log(JSON.stringify(result)); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
