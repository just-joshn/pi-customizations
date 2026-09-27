import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'pi-pstack-cli-'));
const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');
const child = spawn(process.execPath, [cli, '--mode', 'rpc', '--no-session', '-e', root], {
  cwd: directory,
  env: { ...process.env, PI_CODING_AGENT_DIR: directory },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let output = '';
let stderr = '';
let sequence = 0;
const requests = new Map();
child.stderr.on('data', (data) => { stderr += data.toString(); });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (data) => {
  output += data;
  let boundary;
  while ((boundary = output.indexOf('\n')) >= 0) {
    const line = output.slice(0, boundary).replace(/\r$/, '');
    output = output.slice(boundary + 1);
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); }
    catch { continue; }
    if (record.type === 'response' && requests.has(record.id)) {
      const pending = requests.get(record.id);
      requests.delete(record.id);
      clearTimeout(pending.timer);
      if (record.success) pending.resolve(record.data);
      else pending.reject(new Error(record.error));
    }
  }
});
const ended = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    for (const pending of requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Pi exited ${code ?? signal}: ${stderr}`));
    }
    requests.clear();
    resolve(code);
  });
});
function send(command) {
  const id = `check-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`RPC timed out: ${command.type}. ${stderr}`)); }, 15000);
    requests.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
  });
}
try {
  const commands = await send({ type: 'get_commands' });
  for (const name of ['poteto-mode', 'setup-pstack', 'pstack', 'how', 'bro', 'deslop', 'control-cli', 'control-ui', 'verify-this', 'pr-review-canvas', 'thermo-nuclear-code-quality-review']) {
    assert.ok(commands.commands.some((command) => command.name === name), `CLI command ${name}`);
  }
  for (const name of ['how', 'bro', 'deslop', 'control-cli', 'control-ui']) {
    assert.equal(commands.commands.find((command) => command.name === name)?.source, 'prompt', `${name} must be a native prompt template`);
  }
  for (const name of ['poteto-mode', 'setup-pstack', 'pstack']) {
    assert.equal(commands.commands.find((command) => command.name === name)?.source, 'extension', `${name} requires runtime behavior`);
  }
  await send({ type: 'prompt', message: '/pstack' });
  const messages = await send({ type: 'get_messages' });
  assert.ok(messages.messages.some((message) => message.role === 'custom' && message.customType === 'pstack-status'));
  const status = messages.messages.find((message) => message.role === 'custom' && message.customType === 'pstack-status');
  assert.match(String(status.content), /64 skills, 63 prompt templates/);
  assert.match(String(status.content), /cursor-team-kit 1.2.0/);
  await send({ type: 'prompt', message: '/poteto-mode off' });
  child.stdin.end();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { assert.equal(await ended, 0); }
  finally { clearTimeout(timeout); }
  assert.doesNotMatch(stderr, /Failed to load extension|Extension error/);
  console.log('Verified installed Pi CLI package loading, RPC commands, status, mode off, and orderly shutdown without model calls.');
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  await ended;
  await rm(directory, { recursive: true, force: true });
}
