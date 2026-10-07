import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE = 'extensions/pi-pstack';
export const PROVIDER = fileURLToPath(new URL('./pstack-env-provider.js', import.meta.url));
export const OBSERVER = fileURLToPath(new URL('./pstack-tools-observer.js', import.meta.url));
const POLL_MS = 50;
const WAIT_MS = 30000;

export function writeRaw(context, name, value) {
  const path = join(context.rawDir, name);
  mkdirSync(context.rawDir, { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readIfExists(path) {
  try {
    return readJson(path);
  } catch {
    return undefined;
  }
}

export async function waitForValue(probe, { timeoutMs = WAIT_MS, description = 'a value' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await Promise.resolve()
      .then(() => probe())
      .catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export function prepareEnvAgentDir(context, name, settings = {}) {
  const agentDir = join(context.scratchDir, name);
  mkdirSync(join(agentDir, 'extensions'), { recursive: true });
  copyFileSync(PROVIDER, join(agentDir, 'extensions', 'provider.js'));
  const existing = readIfExists(join(agentDir, 'settings.json')) ?? {};
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify({ ...existing, extensions: ['extensions/provider.js'], ...settings }, null, 2)}\n`);
  return agentDir;
}

export function prepareBareAgentDir(context, name, settings = {}) {
  const agentDir = join(context.scratchDir, name);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify({ ...settings }, null, 2)}\n`);
  return agentDir;
}

export async function startEnv(context, name, options = {}) {
  const { env = {}, settings = {}, bare = false, ...rest } = options;
  const agentDir = options.agentDir ?? (bare ? prepareBareAgentDir(context, `${name}-agent`, settings) : prepareEnvAgentDir(context, `${name}-agent`, settings));
  const observerFile = join(context.rawDir, `observer-${name}.json`);
  const providerLog = join(context.rawDir, `provider-${name}.jsonl`);
  const session = context.startSession({
    packagePath: join(context.repoRoot, PACKAGE),
    agentDir,
    cwd: options.cwd ?? agentDir,
    capturePath: join(context.rawDir, `rpc-${name}.jsonl`),
    extraExtensions: [OBSERVER, PROVIDER],
    env: { PSTACK_TOOLS_OBSERVER_PATH: observerFile, PSTACK_ENV_PROVIDER_LOG: providerLog, ...env },
    ...rest,
  });
  await session.state();
  await waitForValue(() => (existsSync(observerFile) ? readJson(observerFile) : undefined), { description: `observer snapshot ${observerFile}` });
  await session.send({ type: 'set_model', provider: 'pstack-verify-env', modelId: 'scripted-env' });
  return { session, agentDir, observerFile, providerLog };
}

export function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  return (content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

export function lastToolResult(session, toolName) {
  return session
    .ofType('message_end')
    .map((record) => record.message)
    .filter((message) => message?.role === 'toolResult' && message.toolName === toolName)
    .at(-1);
}

export function toolResult(session, toolName) {
  const message = lastToolResult(session, toolName);
  if (!message) throw new Error(`no ${toolName} tool result recorded`);
  return { text: messageText(message), details: message.details, isError: message.isError === true };
}

export function notifications(session) {
  return session.uiRequests.filter((request) => request.method === 'notify').map((request) => String(request.message ?? ''));
}

export function widgets(session, key) {
  return session.uiRequests.filter((request) => request.method === 'setWidget' && (key === undefined || request.widgetKey === key));
}

export async function entriesOf(session) {
  return (await session.send({ type: 'get_entries' })).entries;
}

export async function taskEntries(session) {
  return (await entriesOf(session)).filter((entry) => entry.type === 'custom' && entry.customType === 'pstack-task').map((entry) => entry.data);
}

export function loadPackageModule(context, relative) {
  return import(new URL(`${PACKAGE}/${relative}`, `file://${context.repoRoot}/`).href);
}

export function providerCalls(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function gitRepo(path, remote) {
  mkdirSync(path, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'verify', GIT_AUTHOR_EMAIL: 'verify@example.invalid', GIT_COMMITTER_NAME: 'verify', GIT_COMMITTER_EMAIL: 'verify@example.invalid' };
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: path, env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  };
  run(['init', '-q']);
  run(['commit', '--allow-empty', '-q', '-m', 'fixture']);
  if (remote) run(['remote', 'add', 'origin', remote]);
  return path;
}

export function writeExecutable(path, content) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, { mode: 0o755 });
  return path;
}

export function writeFakeSsh(context, { slot, logPath, stateDir, executorId, machineId }) {
  const impl = join(context.scratchDir, `${slot}-impl.mjs`);
  writeFileSync(impl, fakeSshSource({ logPath, stateDir }));
  const binDir = join(context.scratchDir, `${slot}-bin`);
  writeExecutable(join(binDir, 'ssh'), `#!/bin/sh\nexec node ${JSON.stringify(impl)} ${JSON.stringify(executorId)} ${JSON.stringify(machineId)} "$@"\n`);
  return { binDir, logPath, stateDir, impl };
}

function fakeSshSource({ logPath, stateDir }) {
  return `import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOG = ${JSON.stringify(logPath)};
const STATE = ${JSON.stringify(stateDir)};
const [executorId, machineId, ...sshArgs] = process.argv.slice(2);
const taskFile = (id) => join(STATE, \`\${id}.json\`);
const load = (id) => { try { return JSON.parse(readFileSync(taskFile(id), 'utf8')); } catch { return {}; } };
const save = (id, value) => { mkdirSync(STATE, { recursive: true }); writeFileSync(taskFile(id), JSON.stringify(value)); };
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
appendFileSync(LOG, \`\${JSON.stringify(sshArgs)}\\n\`);
const request = JSON.parse(input);
const id = request.taskId;
let result = {};
if (request.operation === 'start') {
  const args = request.args ?? [];
  const flag = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  const record = { invocation: null, prompt: false };
  save(id, record);
  result = {
    directory: join(STATE, id),
    cwd: process.cwd(),
    sha: request.sha,
    executorId,
    machineId,
    hostname: 'fixture-vm',
    isolation: 'vm',
    virtualization: 'fixture',
    bootId: 'fixture-boot',
    sessionFile: join(STATE, id, 'session.jsonl'),
    sessionId: 'fixture-session',
    model: { provider: flag('--provider'), id: flag('--model') },
    thinkingLevel: flag('--thinking') ?? 'off',
  };
} else if (request.operation === 'send') {
  const record = load(id);
  if (request.command?.type === 'prompt') {
    record.invocation = request.invocation;
    record.prompt = true;
    save(id, record);
  }
  const data = request.command?.type === 'get_entries' ? { entries: [{ id: 'fixture-entry' }], leafId: 'fixture-entry' } : {};
  result = { type: 'response', command: request.command?.type, success: true, data };
} else if (request.operation === 'info') {
  const record = load(id);
  result = record.prompt ? { kind: 'exited', pid: 424242, code: 0 } : { kind: 'ready', pid: 424242, childPid: 424243 };
} else if (request.operation === 'snapshot') {
  const record = load(id);
  const entry = {
    id: 'remote-1',
    parentId: null,
    type: 'message',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'remote fixture reply' }],
      stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    },
  };
  result = { invocation: record.invocation, entries: [entry], leafId: 'remote-1' };
} else if (request.operation === 'activity') {
  result = { kind: 'settled', invocation: load(id).invocation };
}
process.stdout.write(JSON.stringify({ success: true, result }));
`;
}

export function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function shutdownTimer(context, directory) {
  const { timerAlive, timerCommand, timerRecord } = await loadPackageModule(context, 'scripts/timer-client.mjs');
  const status = await timerRecord(join(directory, 'status.json')).catch(() => undefined);
  if (status && timerAlive(status)) await timerCommand(directory, { type: 'shutdown' }).catch(() => {});
  await waitForValue(async () => (timerAlive(await timerRecord(join(directory, 'status.json')).catch(() => undefined)) ? undefined : true), { description: 'timer supervisor stop' }).catch(() => {});
  const root = await timerRecord(join(directory, 'root.json')).catch(() => undefined);
  if (root?.childPid && alive(root.childPid)) {
    process.kill(root.childPid, 'SIGTERM');
    await waitForValue(async () => (alive(root.childPid) ? undefined : true), { description: 'timer root stop', timeoutMs: 10000 }).catch(() => process.kill(root.childPid, 'SIGKILL'));
  }
}

export async function cleanupRoutine(context, directory) {
  if (!directory) return;
  const { disableRoutine } = await loadPackageModule(context, 'scripts/routine-client.mjs');
  if (existsSync(join(directory, 'status.json'))) await disableRoutine(directory).catch(() => {});
  const status = readIfExists(join(directory, 'status.json'));
  if (status?.pid && alive(status.pid)) {
    process.kill(status.pid, 'SIGTERM');
    await waitForValue(async () => (alive(status.pid) ? undefined : true), { description: 'routine supervisor stop', timeoutMs: 10000 }).catch(() => process.kill(status.pid, 'SIGKILL'));
  }
  if (status?.pid && alive(status.pid)) throw new Error(`routine supervisor ${status.pid} is still alive after cleanup`);
}
