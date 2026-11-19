import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { detectRuntime } from '../src/container.ts';
import pstack from '../src/index.ts';
import { list, tmuxSocket } from '../src/jobs.ts';

type Tool = { execute: (id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown) => Promise<unknown> };
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

/** These probes run in a real container, so they need a container runtime. Without one nothing here can run, and a job refuses to start. */
const runtimeAvailable = ((): boolean => {
  try {
    detectRuntime();
    return true;
  } catch {
    return false;
  }
})();
const owner = `parity${process.pid}`;
const socketPath = join(homedir(), `.pstack-probe-${process.pid}.sock`);
const abstractName = `pstack-probe-${process.pid}`;
const servers: Server[] = [];
let agentDir: string;
let repo: string;
let tools: Record<string, Tool>;
let handlers: Record<string, Handler>;
let ctx: Record<string, unknown>;

/** Every operation a job tries, as a shell command, and whether it succeeds inside the container. One table for every runtime. */
const probes: { name: string; command: string; allowed: boolean }[] = [
  { name: "write the container's own /tmp", command: 'echo x > /tmp/pstack-probe-$$', allowed: true },
  { name: 'write its private TMPDIR', command: 'echo x > "$TMPDIR/probe"', allowed: true },
  { name: 'write its checkout', command: 'echo x > probe.txt', allowed: true },
  { name: 'write the root filesystem', command: 'echo x > /etc/pstack-probe-$$', allowed: false },
  { name: 'write the real home directory', command: 'echo x > "$REAL_HOME/.pstack-probe-outside-$$"', allowed: false },
  { name: 'write git config', command: 'echo >> .git/config', allowed: true },
  { name: 'add a git hook', command: 'echo > .git/hooks/probe-hook', allowed: false },
  { name: 'write git info', command: 'echo > .git/info/probe', allowed: false },
  { name: 'create .git/config.worktree', command: 'echo > .git/config.worktree', allowed: true },
  { name: 'add a git worktree', command: 'git worktree add -q --detach "$TMPDIR/wt" HEAD', allowed: false },
  { name: 'create a submodule redirect', command: 'mkdir -p .git/modules/probe && echo > .git/modules/probe/config', allowed: false },
  { name: 'add Pi code at the checkout root', command: 'mkdir -p .pi/extensions && echo > .pi/extensions/probe.ts', allowed: true },
  { name: 'add Pi settings in a subdirectory', command: 'mkdir -p sub/.pi && echo {} > sub/.pi/settings.json', allowed: true },
  { name: 'add VS Code tasks', command: 'mkdir -p .vscode && echo {} > .vscode/tasks.json', allowed: true },
  { name: 'add a workspace file', command: 'echo {} > probe.code-workspace', allowed: true },
  { name: 'add harness hooks', command: 'echo {} > .cursor/hooks.json', allowed: true },
  { name: 'add Claude Code settings in a subdirectory', command: 'mkdir -p sub4/.claude && echo {} > sub4/.claude/settings.json', allowed: true },
  { name: 'write existing Claude Code settings', command: 'echo {} > .claude/settings.json', allowed: true },
  { name: 'add a Claude Code skill', command: 'mkdir -p .claude/skills/probe && echo x > .claude/skills/probe/SKILL.md', allowed: true },
  { name: 'add a harness rule', command: 'mkdir -p .cursor/rules && echo x > .cursor/rules/probe.mdc', allowed: true },
  { name: 'add a git pointer in a subdirectory', command: 'mkdir -p sub2 && echo "gitdir: /nowhere" > sub2/.git', allowed: true },
  { name: 'add a git repository in a subdirectory', command: 'git init -q sub3', allowed: true },
  { name: "write a nested repository's hooks", command: 'echo > nested/.git/hooks/probe', allowed: false },
  { name: 'write the real Pi agent directory', command: 'echo > "$REAL_AGENT_DIR/probe.txt"', allowed: false },
  { name: 'add a file to its own agent directory', command: 'echo > "$PI_CODING_AGENT_DIR/probe.txt"', allowed: true },
  { name: 'connect to a host service socket', command: `node -e "require('net').connect(process.argv[1]).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" "$SOCKET"`, allowed: false },
  { name: 'connect to a host abstract socket', command: `node -e "require('net').connect('\\0'+process.argv[1]).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" "$ABSTRACT"`, allowed: false },
  { name: 'find a container runtime socket', command: 'ls /var/run/docker.sock /run/podman/podman.sock /var/run/container-runtime 2>/dev/null | grep .', allowed: false },
  { name: 'start a tmux server of its own', command: 'tmux -S "$TMPDIR/t.sock" new-session -d "true" && tmux -S "$TMPDIR/t.sock" kill-server', allowed: false },
  { name: "write another worktree's git metadata", command: 'echo > ".git/worktrees/$(ls .git/worktrees | head -1)/probe"', allowed: false },
  { name: 'commit in its checkout', command: 'git -c user.name=t -c user.email=t@t commit -q --allow-empty -m probe', allowed: true },
  { name: "write a submodule's git directory", command: 'echo > .git/modules/existing/probe', allowed: false },
  { name: 'signal a process outside', command: 'kill -0 "$OUTSIDE_PID"', allowed: false },
  { name: 'run a child process with pipes', command: `node -e "require('child_process').execFileSync('true')"`, allowed: true },
];

/**
 * What a container cannot block at runtime, since it can only mount a directory that exists and cannot guard a file. Each
 * of these succeeds inside the job and is undone after it: Pi, editor, and harness code and `.git` entries that appear
 * are moved out by the sweep, and a changed git config or harness settings file is put back from its launch-time copy.
 */
const containerCannotBlockAtRuntime = new Set([
  'write git config',
  'create .git/config.worktree',
  'add Pi code at the checkout root',
  'add Pi settings in a subdirectory',
  'add VS Code tasks',
  'add a workspace file',
  'add harness hooks',
  'add Claude Code settings in a subdirectory',
  'write existing Claude Code settings',
  'add a git pointer in a subdirectory',
  'add a git repository in a subdirectory',
]);

/** What the host holds after the job ended, where a write inside the container must not have landed. */
const hostState = (): Record<string, boolean> => ({
  '.pi/extensions': existsSync(join(repo, '.pi', 'extensions')),
  '.vscode': existsSync(join(repo, '.vscode')),
  'probe.code-workspace': existsSync(join(repo, 'probe.code-workspace')),
  '.cursor/hooks.json': existsSync(join(repo, '.cursor', 'hooks.json')),
  'sub/.pi/settings.json': existsSync(join(repo, 'sub', '.pi', 'settings.json')),
  'sub4/.claude/settings.json': existsSync(join(repo, 'sub4', '.claude', 'settings.json')),
  'sub2/.git': existsSync(join(repo, 'sub2', '.git')),
  'sub3/.git': existsSync(join(repo, 'sub3', '.git')),
  '.git/config.worktree': existsSync(join(repo, '.git', 'config.worktree')),
});

beforeAll(async () => {
  if (!runtimeAvailable) return;
  const listen = (address: string) =>
    new Promise<void>((resolve) => {
      const server = createServer((socket) => socket.end());
      servers.push(server);
      server.listen(address, () => resolve());
    });
  await listen(socketPath);
  if (process.platform === 'linux') await listen(`\0${abstractName}`);
});

afterAll(() => {
  for (const server of servers) server.close();
  rmSync(socketPath, { force: true });
});

beforeEach(() => {
  agentDir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-parity-agent-')));
  repo = realpathSync(mkdtempSync(join(homedir(), '.pstack-parity-repo-')));
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', `${repo}-other`]);
  execFileSync('git', ['init', '-q', '--bare', join(repo, '.git', 'modules', 'existing')]);
  execFileSync('git', ['init', '-q', join(repo, 'nested')]);
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'settings.json'), '{}');
  mkdirSync(join(repo, '.cursor'));
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  vi.stubEnv('PSTACK_V2_CONTAINED', '');
  tools = {};
  handlers = {};
  const api = {
    registerCommand: () => {},
    on: (event: string, handler: Handler) => {
      handlers[event] = handler;
    },
    registerTool: (tool: Tool & { name: string }) => {
      tools[tool.name] = tool;
    },
    sendMessage: vi.fn(),
  };
  pstack(api as unknown as ExtensionAPI);
  ctx = {
    mode: 'print',
    hasUI: false,
    cwd: repo,
    model: undefined,
    sessionManager: { getSessionId: () => owner, getSessionFile: () => undefined, getBranch: () => [] },
    modelRegistry: { find: () => undefined },
    isProjectTrusted: () => true,
  };
});

afterEach(async () => {
  await handlers['session_shutdown']?.({}, ctx);
  vi.unstubAllEnvs();
  try {
    execFileSync('tmux', ['-S', tmuxSocket(owner), 'kill-server'], { stdio: 'ignore' });
  } catch {
    // No server was started.
  }
  rmSync(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(`${repo}-other`, { recursive: true, force: true });
});

describe.runIf(runtimeAvailable)('the container blocks the same operations on every runtime', { timeout: 300_000 }, () => {
  test('each probe is allowed or denied as the shared table says, and what the container cannot block is undone after the job', async () => {
    const outsideHome = join(homedir(), `.pstack-probe-outside-${process.pid}`);
    const config = readFileSync(join(repo, '.git', 'config'), 'utf8');
    const script = join(agentDir, 'probe.sh');
    const lines = probes.map(({ name, command }) => `if ( ${command} ) >/dev/null 2>&1; then echo "ALLOW ${name}"; else echo "DENY ${name}"; fi`);
    // A host socket and a host path no mount reaches, so the probes that try them prove the container cannot see the host.
    writeFileSync(script, `export REAL_HOME='${homedir()}' REAL_AGENT_DIR='${agentDir}' SOCKET='${socketPath}' ABSTRACT='${abstractName}' OUTSIDE_PID='${process.pid}'\n${lines.join('\n')}\n`);
    await tools['tmux_run']?.execute('call', { name: 'probe', command: `bash ${script}` }, undefined, undefined, ctx);
    const job = () => list(join(agentDir, 'pstack-v2', 'jobs'), owner)[0];
    // The exit file is written after the container stopped and the sweep ran, so the host state below is final.
    await expect.poll(() => existsSync(join(job()?.spec.out ?? '/none', 'exit')), { timeout: 280_000 }).toBe(true);
    const output = readFileSync(join(job()?.spec.out ?? '', 'output.log'), 'utf8');
    const seen = Object.fromEntries(
      output
        .split('\n')
        .filter((line) => /^(ALLOW|DENY) /.test(line))
        .map((line) => [line.slice(line.indexOf(' ') + 1), line.startsWith('ALLOW')]),
    );
    expect(seen).toEqual(Object.fromEntries(probes.map(({ name, allowed }) => [name, allowed])));
    expect(Object.values(hostState())).toEqual(Object.values(hostState()).map(() => false));
    expect([readFileSync(join(repo, '.git', 'config'), 'utf8'), readFileSync(join(repo, '.claude', 'settings.json'), 'utf8')]).toEqual([config, '{}']);
    // A write the container cannot block is allowed inside it, and still never reaches the host's shared directories.
    expect([existsSync(outsideHome), readdirTmp().some((name) => name.startsWith('pstack-probe-'))]).toEqual([false, false]);
    expect([...containerCannotBlockAtRuntime].every((name) => probes.some((probe) => probe.name === name && probe.allowed))).toBe(true);
  });
});

const readdirTmp = (): string[] => {
  try {
    return execFileSync('ls', ['/tmp'], { encoding: 'utf8' }).split('\n');
  } catch {
    return [];
  }
};
