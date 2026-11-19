import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import pstack from '../src/index.ts';
import { list, outputPath, tmuxSocket } from '../src/jobs.ts';

type Tool = { execute: (id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown) => Promise<unknown> };
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

const supported = process.platform === 'darwin' || process.platform === 'linux';
const owner = `parity${process.pid}`;
const socketPath = join(homedir(), `.pstack-probe-${process.pid}.sock`);
const abstractName = `pstack-probe-${process.pid}`;
let servers: readonly Server[] = [];
let agentDir: string;
let repo: string;
let tools: Record<string, Tool>;
let handlers: Record<string, Handler>;
let ctx: Record<string, unknown>;

/** Every operation a job tries, as a shell command, and whether a job may do it. One table for every platform. */
const probes: { name: string; command: string; allowed: boolean }[] = [
  { name: 'write the shared /tmp', command: 'echo x > /tmp/pstack-probe-$$', allowed: false },
  { name: 'write its private TMPDIR', command: 'echo x > "$TMPDIR/probe"', allowed: true },
  { name: 'write its checkout', command: 'echo x > probe.txt', allowed: true },
  { name: 'write outside the checkout', command: 'echo x > "$HOME/.pstack-probe-outside-$$"', allowed: false },
  { name: 'write git config', command: 'echo >> .git/config', allowed: false },
  { name: 'add a git hook', command: 'echo > .git/hooks/probe-hook', allowed: false },
  { name: 'write git info', command: 'echo > .git/info/probe', allowed: false },
  { name: 'create .git/config.worktree', command: 'echo > .git/config.worktree', allowed: false },
  { name: 'add a git worktree', command: 'git worktree add -q --detach "$TMPDIR/wt" HEAD', allowed: false },
  { name: 'create a submodule redirect', command: 'mkdir -p .git/modules/probe && echo > .git/modules/probe/config', allowed: false },
  { name: 'add Pi code at the checkout root', command: 'mkdir -p .pi/extensions && echo > .pi/extensions/probe.ts', allowed: false },
  { name: 'add Pi settings in a subdirectory', command: 'mkdir -p sub/.pi && echo {} > sub/.pi/settings.json', allowed: false },
  { name: 'add VS Code tasks', command: 'mkdir -p .vscode && echo {} > .vscode/tasks.json', allowed: false },
  { name: 'add a workspace file', command: 'echo {} > probe.code-workspace', allowed: false },
  { name: 'add harness hooks', command: 'echo {} > .cursor/hooks.json', allowed: false },
  { name: 'add Claude Code settings in a subdirectory', command: 'mkdir -p sub4/.claude && echo {} > sub4/.claude/settings.json', allowed: false },
  { name: 'write existing Claude Code settings', command: 'echo {} > .claude/settings.json', allowed: false },
  { name: 'add a Claude Code skill', command: 'mkdir -p .claude/skills/probe && echo x > .claude/skills/probe/SKILL.md', allowed: true },
  { name: 'add a harness rule', command: 'mkdir -p .cursor/rules && echo x > .cursor/rules/probe.mdc', allowed: true },
  { name: 'add a git pointer in a subdirectory', command: 'mkdir -p sub2 && echo "gitdir: /nowhere" > sub2/.git', allowed: false },
  { name: 'add a git repository in a subdirectory', command: 'git init -q sub3', allowed: false },
  { name: "write a nested repository's hooks", command: 'echo > nested/.git/hooks/probe', allowed: false },
  { name: 'write the real Pi agent directory', command: 'echo > "$REAL_AGENT_DIR/probe.txt"', allowed: false },
  { name: 'add a file to its own agent directory', command: 'echo > "$PI_CODING_AGENT_DIR/probe.txt"', allowed: false },
  { name: 'connect to a local service socket', command: `node -e "require('net').connect(process.argv[1]).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" "$SOCKET"`, allowed: false },
  { name: 'connect to an abstract socket', command: `[ "$(uname)" = Linux ] || exit 1; node -e "require('net').connect('\\0'+process.argv[1]).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" "$ABSTRACT"`, allowed: false },
  { name: 'listen on a local socket', command: `node -e "require('net').createServer().listen(process.argv[1],()=>process.exit(0)).on('error',()=>process.exit(1))" "$TMPDIR/own.sock"`, allowed: false },
  { name: 'start a tmux server of its own', command: 'tmux -S "$TMPDIR/t.sock" new-session -d "true" && tmux -S "$TMPDIR/t.sock" kill-server', allowed: false },
  { name: "write another worktree's git metadata", command: 'echo > ".git/worktrees/$(ls .git/worktrees | head -1)/probe"', allowed: false },
  { name: 'commit in its checkout', command: 'git -c user.name=t -c user.email=t@t commit -q --allow-empty -m probe', allowed: true },
  { name: "write a submodule's git directory", command: 'echo > .git/modules/existing/probe', allowed: false },
  { name: 'signal a process outside', command: 'kill -0 "$OUTSIDE_PID"', allowed: false },
  { name: 'run a child process with pipes', command: `node -e "require('child_process').execFileSync('true')"`, allowed: true },
];

/**
 * What bubblewrap cannot close, since it binds only paths that exist and cannot filter by name. Pi, editor, and harness
 * code and .git entries that appear during the job are moved out by the sweep after it. The job's agent directory must take Pi's lock
 * directories, so on Linux it is a private copy in memory where other new files also land, and vanish when the job ends.
 */
const linuxCannotBlock = new Set([
  'add Pi code at the checkout root',
  'add Pi settings in a subdirectory',
  'add VS Code tasks',
  'add a workspace file',
  'add harness hooks',
  'add Claude Code settings in a subdirectory',
  'add a git pointer in a subdirectory',
  'add a git repository in a subdirectory',
  'add a file to its own agent directory',
]);

const expected = (name: string, allowed: boolean): boolean => (process.platform === 'linux' && linuxCannotBlock.has(name) ? true : allowed);

beforeAll(async () => {
  if (!supported) return;
  const listen = (address: string) =>
    new Promise<void>((resolve) => {
      const server = createServer((socket) => socket.end());
      servers = [...servers, server];
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
  vi.stubEnv('PSTACK_V2_SANDBOXED', '');
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

describe.runIf(supported)('the sandbox blocks the same operations on every platform', { timeout: 60_000 }, () => {
  test('each probe is allowed or denied as the shared table says', async () => {
    const script = join(agentDir, 'probe.sh');
    const lines = probes.map(({ name, command }) => `if ( ${command} ) >/dev/null 2>&1; then echo "ALLOW ${name}"; else echo "DENY ${name}"; fi`);
    writeFileSync(script, `export REAL_AGENT_DIR='${agentDir}' SOCKET='${socketPath}' ABSTRACT='${abstractName}' OUTSIDE_PID='${process.pid}'\n${lines.join('\n')}\necho PROBES-DONE\n`);
    await tools['tmux_run']?.execute('call', { name: 'probe', command: `bash ${script}` }, undefined, undefined, ctx);
    const output = () => {
      const job = list(join(agentDir, 'pstack-v2', 'jobs'), owner)[0];
      return job && existsSync(outputPath(job.spec.out)) ? readFileSync(outputPath(job.spec.out), 'utf8') : '';
    };
    await expect.poll(output, { timeout: 30_000 }).toContain('PROBES-DONE');
    const seen = Object.fromEntries(
      output()
        .split('\n')
        .filter((line) => /^(ALLOW|DENY) /.test(line))
        .map((line) => [line.slice(line.indexOf(' ') + 1), line.startsWith('ALLOW')]),
    );
    expect(seen).toEqual(Object.fromEntries(probes.map(({ name, allowed }) => [name, expected(name, allowed)])));
  });
});
