#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const provider = join(packageRoot, 'test', 'journey-provider.ts');
const progressFixture = join(packageRoot, 'test', 'fixtures', 'task-progress-sentinel.txt');
const session = `progress-${process.pid}`;
const socket = `pstack-progress-${process.pid}`;
const STATUS_CENSUS = '73 skills, 71 prompt templates';
const checks = [];
let directory;
let panePid;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function tmux(args) {
  return execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8', timeout: 10000 });
}

function flatten(text) {
  return text.replace(/\s+/g, ' ');
}

function check(name, condition) {
  checks.push({ name, condition });
}

function resolvePi() {
  if (process.env.PI_BIN) return process.env.PI_BIN;
  return execFileSync('sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim();
}

async function waitFor(label, predicate, timeoutMs = 30000, includeScrollback = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const screen = tmux(['capture-pane', '-p', ...(includeScrollback ? ['-S', '-'] : []), '-t', session]);
    if (predicate(flatten(screen))) return screen;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function prepare() {
  execFileSync('tmux', ['-V'], { encoding: 'utf8' });
  const pi = resolvePi();
  const version = execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim();
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const testedVersion = manifest.devDependencies['@earendil-works/pi-coding-agent'];
  if (version !== testedVersion) throw new Error(`Pi ${testedVersion} is required for this TUI check. Found ${version}`);

  directory = await mkdtemp(join(tmpdir(), 'pi-pstack-progress-tui-'));
  const log = join(directory, 'requests');
  await mkdir(join(directory, 'extensions'), { recursive: true });
  await mkdir(log, { recursive: true });
  await writeFile(join(directory, 'extensions', 'journey-provider.ts'), `export { default } from ${JSON.stringify(provider)};`);
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: directory,
    TMPDIR: directory,
    PI_CODING_AGENT_DIR: directory,
    PI_OFFLINE: '1',
    PSTACK_JOURNEY_LOG: log,
    PSTACK_PROGRESS_FIXTURE: progressFixture,
    TERM: 'xterm-256color',
    LANG: 'C.UTF-8',
  };
  return { pi, env, version };
}

function startTui(pi, env, cwd) {
  const command = [
    'env -i',
    ...Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`),
    shellQuote(pi),
    '--model journey-test/recorder',
    '--no-session',
    '--extension',
    shellQuote(packageRoot),
    '--approve',
    '--no-context-files',
    '--offline',
  ].join(' ');
  tmux(['-f', '/dev/null', 'new-session', '-d', '-x', '120', '-y', '40', '-s', session, '-c', cwd, command]);
  panePid = Number(tmux(['display-message', '-p', '-t', session, '#{pane_pid}']));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function waitForExit(pid, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  if (isAlive(pid)) throw new Error(`Pi process ${pid} still running ${timeoutMs}ms after the tmux server was killed.`);
}

async function showStatus() {
  await waitFor('journey model in the Pi TUI', (screen) => screen.includes('recorder') && screen.includes('Extensions'));
  tmux(['send-keys', '-l', '-t', session, '/pstack status']);
  const hasSuggestion = (screen) => screen.includes('→ status Show pstack status');
  await waitFor('/pstack subcommand suggestion', hasSuggestion);
  tmux(['send-keys', '-t', session, 'Enter']);
  await waitFor('accepted suggestion closing the menu', (screen) => screen.includes('/pstack status') && !hasSuggestion(screen));
  tmux(['send-keys', '-t', session, 'Enter']);
  const screen = await waitFor('/pstack status output', (text) => text.includes(STATUS_CENSUS), 30000, true);
  check('/pstack status renders in the installed Pi TUI', flatten(screen).includes(STATUS_CENSUS));
}

async function childRequestCount(log) {
  const files = (await readdir(log)).filter((name) => name.startsWith('requests-') && name.endsWith('.jsonl'));
  const lines = (await Promise.all(files.map((name) => readFile(join(log, name), 'utf8')))).flatMap((text) => text.split('\n').filter(Boolean));
  return lines.map((line) => JSON.parse(line)).filter((request) => request.messages?.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('JOURNEY:progress-child'))).length;
}

async function showProgress(log) {
  tmux(['send-keys', '-l', '-t', session, 'JOURNEY:progress']);
  await waitFor('typed progress journey', (screen) => screen.includes('JOURNEY:progress'));
  tmux(['send-keys', '-t', session, 'Enter']);
  let startFrame = '';
  let finishFrame = '';
  const observedActivities = new Set();
  const deadline = Date.now() + 30000;
  let finalScreen = '';
  while (Date.now() < deadline) {
    finalScreen = tmux(['capture-pane', '-p', '-S', '-', '-t', session]);
    const screen = flatten(finalScreen);
    const activity = screen.match(/Active tools: [A-Za-z0-9,_. -]*\. Latest: [A-Za-z0-9,_. /-]*\./)?.[0];
    if (activity) observedActivities.add(activity);
    if (!startFrame && /Task [0-9a-f-]{36} running\. Active tools: bash\. Latest: bash started\./.test(screen)) startFrame = finalScreen;
    if (!finishFrame && /Task [0-9a-f-]{36} running\. Active tools: none\. Latest: read finished\./.test(screen)) finishFrame = finalScreen;
    if (screen.includes('recorded JOURNEY:progress')) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  if (!flatten(finalScreen).includes('recorded JOURNEY:progress')) throw new Error('The deterministic Task journey did not complete.');
  check('Task row renders child shell start progress', Boolean(startFrame));
  check('Task row renders child read finish progress', Boolean(finishFrame));
  check('JOURNEY:progress completes in the real TUI', flatten(finalScreen).includes('recorded JOURNEY:progress'));
  const childTurns = await childRequestCount(log);
  check('deterministic child read journey reaches its final turn', childTurns === 3);
  return { startFrame, finishFrame, observedActivities: [...observedActivities], childTurns };
}

function progressText(frame) {
  if (!frame) return '<missing progress snapshot>';
  const match = flatten(frame).match(/Task [0-9a-f-]{36} running\. Active tools: (?:bash|none)\. Latest: bash started\.|Task [0-9a-f-]{36} running\. Active tools: none\. Latest: read finished\./);
  return match?.[0].replace(/Task [0-9a-f-]{36}/, 'Task <task>') ?? '<missing progress snapshot>';
}

function report(progress, version) {
  process.stdout.write(`Installed Pi version: ${version}\n`);
  process.stdout.write(`Start snapshot: ${progressText(progress.startFrame)}\n`);
  process.stdout.write(`Finish snapshot: ${progressText(progress.finishFrame)}\n`);
  process.stdout.write(`Deterministic child provider turns: ${progress.childTurns}\n`);
  for (const activity of progress.observedActivities) process.stdout.write(`Observed safe activity: ${activity}\n`);
  for (const result of checks) process.stdout.write(`[${result.condition ? 'PASS' : 'FAIL'}] ${result.name}\n`);
  if (checks.some((result) => !result.condition)) process.exitCode = 1;
}

async function run() {
  const { pi, env, version } = await prepare();
  startTui(pi, env, directory);
  await showStatus();
  const progress = await showProgress(env.PSTACK_JOURNEY_LOG);
  report(progress, version);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`TUI harness failure: ${message}\n`);
  process.exitCode = 1;
} finally {
  spawnSync('tmux', ['-L', socket, 'kill-session', '-t', session], { stdio: 'ignore' });
  spawnSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
  if (panePid) await waitForExit(panePid);
  if (directory) await rm(directory, { recursive: true, force: true });
}
