#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');
const session = `agent-render-${process.pid}`;
const socket = `pstack-agent-render-${process.pid}`;
const checks = [];

const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;
const tmux = (args) => execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8', timeout: 10000 });
const screen = () => tmux(['capture-pane', '-p', '-S', '-', '-t', session]);

async function waitFor(label, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = screen();
    if (predicate(text)) return text;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error(`Timed out waiting for ${label}.\n${screen()}`);
}

async function start(directory) {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  await writeFile(join(directory, 'extensions', 'journey-provider.ts'), `export { default } from ${JSON.stringify(join(packageRoot, 'test', 'journey-provider.ts'))};`);
  const env = { PATH: process.env.PATH ?? '', HOME: directory, TMPDIR: directory, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: '1', TERM: 'xterm-256color', LANG: 'C.UTF-8' };
  const flags = ['--model journey-test/recorder', '--no-session', '--extension', quote(packageRoot), '--approve', '--no-context-files', '--offline'];
  const command = ['env -i', ...Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`), quote(process.execPath), quote(cli), ...flags].join(' ');
  tmux(['-f', '/dev/null', 'new-session', '-d', '-x', '120', '-y', '50', '-s', session, '-c', directory, command]);
  await waitFor('journey model in the Pi TUI', (text) => text.includes('recorder'));
}

async function run(directory) {
  await start(directory);
  tmux(['send-keys', '-l', '-t', session, 'JOURNEY:agentpair']);
  await waitFor('typed parallel Agent journey', (text) => text.includes('JOURNEY:agentpair'));
  tmux(['send-keys', '-t', session, 'Enter']);
  const running = await waitFor('grouped running Agent rows', (text) => text.includes('Running 2 agents…') && text.includes('└─ Agent pair two'));
  process.stdout.write(
    `RUNNING FRAME\n${running
      .split('\n')
      .filter((line) => line.trim())
      .slice(-14)
      .join('\n')}\n`,
  );
  checks.push(['parallel Agent calls share one Running 2 agents header', running.includes('Running 2 agents…')]);
  checks.push(['each grouped row shows the user-facing name and activity', running.includes('├─ Explore pair one') && running.includes('└─ Agent pair two')]);
  const panel = await waitFor('running agent task panel', (text) => text.includes('● Explore: pair one') && text.includes('● general-purpose: pair two')).catch(() => '');
  checks.push(['the agent task panel lists both running agents', panel !== '']);
  const finished = await waitFor('grouped Agent completion', (text) => text.includes('2 agents finished') && text.includes('recorded JOURNEY:agentpair'));
  checks.push(['the group header reports completion', finished.includes('2 agents finished')]);
  checks.push(['completed Agent rows summarise tool use and tokens', /Done · 1 tool use · \d+ tokens/.test(finished)]);
  process.stdout.write(
    `${finished
      .split('\n')
      .filter((line) => line.trim())
      .slice(-24)
      .join('\n')}\n`,
  );
}

const directory = await mkdtemp(join(tmpdir(), 'pi-pstack-agent-render-'));
try {
  await run(directory);
} catch (error) {
  checks.push([`harness: ${error instanceof Error ? error.message : String(error)}`, false]);
} finally {
  spawnSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
for (const [name, passed] of checks) process.stdout.write(`[${passed ? 'PASS' : 'FAIL'}] ${name}\n`);
if (checks.some(([, passed]) => !passed)) process.exitCode = 1;
