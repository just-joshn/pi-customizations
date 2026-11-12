#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { TMUX_SOCKET, controlWorker, inspectWorker, startWorker } from './worker.mjs';

const execute = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const option = (name) => resolve(process.argv[process.argv.indexOf(name) + 1]);
const pi = option('--pi');
const fixture = option('--fixture');
const evidence = option('--evidence');
const workerScript = new URL('./worker.mjs', import.meta.url).pathname;
mkdirSync(evidence, { recursive: true, mode: 0o700 });

function assignment(id) {
  const root = realpathSync(mkdtempSync('/tmp/pp-'));
  for (const name of ['work', 'home', 'agent', 'sessions']) mkdirSync(join(root, name), { mode: 0o700 });
  const file = join(root, 'assignment.json');
  writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, id, root, piCommand: [pi], fixture })}\n`, { mode: 0o600 });
  return { root, file };
}

function transcript(root) {
  const dir = join(root, 'sessions');
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  if (files.length !== 1) return { count: files.length, texts: [] };
  const entries = readFileSync(join(dir, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const texts = entries.filter((e) => e.type === 'message').map((e) => {
    const c = e.message.content;
    const text = typeof c === 'string' ? c : c.filter((p) => p.type === 'text').map((p) => p.text).join('');
    return `${e.message.role}:${text}`;
  });
  return { count: 1, texts };
}

async function until(file, predicate, ms = 15_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await inspectWorker(file);
    if (predicate(last)) return last;
    await sleep(100);
  }
  throw new Error(`timed out; last phase ${last?.phase}: ${last?.reason ?? ''}`);
}

const tmux = (...args) => execute('tmux', ['-L', TMUX_SOCKET, ...args]);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const results = [];
async function gate(name, body) {
  try {
    const receipts = await body();
    results.push({ gate: name, verdict: 'VERIFIED', receipts });
  } catch (error) {
    results.push({ gate: name, verdict: 'NOT VERIFIED', reason: error.message });
  }
  const r = results.at(-1);
  console.log(`${r.verdict}: ${name}${r.reason ? ` (${r.reason})` : ''}`);
}
const expect = (ok, what) => { if (!ok) throw new Error(what); };

const main = assignment('main');
let started;

await gate('real Pi, model and session', async () => {
  started = await startWorker(main.file);
  expect(started.phase === 'idle', `phase ${started.phase}`);
  expect(started.model?.provider === 'scripted' && started.model?.id === 'echo', 'model identity');
  expect(started.sessionFile?.startsWith(join(main.root, 'sessions') + '/'), 'native session path in assigned dir');
  const { stdout } = await execute('ps', ['-o', 'ppid=,command=', '-p', String(started.piPid)]);
  expect(/--mode rpc/.test(stdout) || /pi/.test(stdout), 'pi process present');
  return { piPid: started.piPid, hostPid: started.hostPid, sessionFile: started.sessionFile, ps: stdout.trim() };
});

await gate('host is not a child of the controller', async () => {
  const { stdout } = await execute('ps', ['-o', 'ppid=', '-p', String(started.hostPid)]);
  const ppid = Number(stdout.trim());
  const { stdout: parent } = await execute('ps', ['-o', 'command=', '-p', String(ppid)]);
  expect(ppid !== process.pid, 'host parent is the proof driver');
  expect(/tmux/.test(parent), `host parent is not tmux: ${parent.trim()}`);
  return { hostParent: parent.trim() };
});

await gate('native tool write and transcript', async () => {
  const script = JSON.stringify([{ tool: 'write', args: { path: 'out.txt', content: 'written-by-worker' } }]);
  await controlWorker(main.file, 'prompt', `@@script ${script}`);
  await until(main.file, (s) => s.phase === 'idle' && transcript(main.root).texts.some((t) => t.startsWith('assistant:RESULTS:') && t.includes('[write]')));
  const body = readFileSync(join(main.root, 'work', 'out.txt'), 'utf8');
  expect(body === 'written-by-worker', `file body ${body}`);
  expect(existsSync(started.sessionFile), 'native session file written after first prompt');
  return { file: body, tail: transcript(main.root).texts.slice(-2) };
});

await gate('controller loss and reconnect', async () => {
  const before = await inspectWorker(main.file);
  const child = spawn(process.execPath, [workerScript, 'send', main.file, 'prompt', '@@sleep 2500 SURVIVED'], { stdio: 'ignore' });
  await new Promise((r) => child.once('exit', r));
  const afterExit = await inspectWorker(main.file);
  expect(afterExit.phase === 'running', `phase after controller exit ${afterExit.phase}`);
  const done = await until(main.file, (s) => s.phase === 'idle' && transcript(main.root).texts.includes('assistant:SURVIVED'));
  expect(done.instance === before.instance && done.sessionFile === before.sessionFile, 'same host instance and session');
  return { instance: done.instance, controllerExited: true };
});

await gate('steering delivery and response', async () => {
  await controlWorker(main.file, 'prompt', '@@sleep 2000 FIRST');
  await until(main.file, (s) => s.phase === 'running');
  const receipt = await controlWorker(main.file, 'steer', '@@say STEERED');
  await until(main.file, (s) => s.phase === 'idle' && transcript(main.root).texts.includes('assistant:STEERED'));
  const texts = transcript(main.root).texts;
  expect(texts.includes('user:@@say STEERED'), 'steer recorded as user message');
  return { receipt, tail: texts.slice(-4) };
});

await gate('terminal screen and operator input', async () => {
  const session = `pstack-proof-main`;
  await tmux('send-keys', '-t', session, 'prompt @@say OPERATOR', 'Enter');
  await until(main.file, (s) => s.phase === 'idle' && transcript(main.root).texts.includes('assistant:OPERATOR'));
  const { stdout } = await tmux('capture-pane', '-p', '-t', session, '-S', '-200');
  expect(/operator receipt/.test(stdout) && /OPERATOR/.test(stdout), 'pane shows receipt and response');
  writeFileSync(join(evidence, 'pane.txt'), stdout);
  return { pane: 'pane.txt' };
});

await gate('clear queue and abort active run', async () => {
  await controlWorker(main.file, 'prompt', '@@sleep 4000 NEVER');
  await until(main.file, (s) => s.phase === 'running');
  await controlWorker(main.file, 'follow-up', '@@say QUEUED-NEVER');
  const receipt = await controlWorker(main.file, 'cancel');
  await sleep(4500);
  const texts = transcript(main.root).texts;
  expect(!texts.includes('assistant:NEVER') && !texts.includes('assistant:QUEUED-NEVER'), 'cancelled work absent from transcript');
  expect(receipt.observation.phase === 'aborted', `phase ${receipt.observation.phase}`);
  return { receipt };
});

await gate('unexpected Pi exit is failure, not success', async () => {
  const other = assignment('crash');
  const s = await startWorker(other.file);
  process.kill(s.piPid, 'SIGKILL');
  const after = await until(other.file, (x) => x.phase !== 'idle', 8000);
  expect(after.phase === 'failed' || after.phase === 'unavailable', `phase ${after.phase}`);
  const state = JSON.parse(readFileSync(join(other.root, 'state.json'), 'utf8'));
  expect(state.phase === 'failed', `persisted phase ${state.phase}`);
  return { live: after.phase, persisted: state.phase, reason: state.reason };
});

await gate('host loss is unavailable and forbids a second writer', async () => {
  const other = assignment('hostloss');
  const s = await startWorker(other.file);
  process.kill(s.hostPid, 'SIGKILL');
  await sleep(300);
  const after = await inspectWorker(other.file);
  expect(after.phase === 'unavailable', `phase ${after.phase}`);
  let refused = false;
  try { await startWorker(other.file); } catch (error) { refused = /claimed/.test(error.message); }
  expect(refused, 'restart of claimed assignment refused');
  const orphan = alive(s.piPid);
  if (orphan) process.kill(-s.piPid, 'SIGKILL');
  return { inspect: after.phase, restartRefused: refused, piOrphanedAfterHostKill: orphan };
});

await gate('control validation and endpoint permissions', async () => {
  const mode = (await execute('stat', ['-f', '%Lp', join(main.root, 'control.sock')])).stdout.trim();
  expect(mode === '600', `socket mode ${mode}`);
  let rejected = false;
  try { await controlWorker(main.file, 'rm -rf', 'x'); } catch (error) { rejected = /Unknown operation/.test(error.message); }
  expect(rejected, 'unknown operation rejected');
  return { socketMode: mode, unknownOperationRejected: rejected };
});

await gate('orderly shutdown and scoped cleanup', async () => {
  const before = await inspectWorker(main.file);
  const receipt = await controlWorker(main.file, 'shutdown');
  await sleep(1000);
  expect(!alive(before.piPid) && !alive(before.hostPid), 'pi and host exited');
  const { stdout } = await tmux('list-sessions', '-F', '#{session_name}').catch(() => ({ stdout: '' }));
  expect(!stdout.split('\n').includes('pstack-proof-main'), 'main tmux session gone');
  return { receipt, remainingSessions: stdout.trim().split('\n').filter(Boolean) };
});

await tmux('kill-server').catch(() => undefined);
writeFileSync(join(evidence, 'proof-results.json'), `${JSON.stringify({ pi, fixture, results }, null, 2)}\n`);
process.exitCode = results.every((r) => r.verdict === 'VERIFIED') ? 0 : 1;
