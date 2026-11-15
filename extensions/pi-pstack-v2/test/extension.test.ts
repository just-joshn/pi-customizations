import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import pstack, { modelsFile, serveRequests } from '../src/index.ts';
import { read, request, resultsDir, tmuxSocket } from '../src/jobs.ts';

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Tool = { execute: (id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown) => Promise<{ content: { text: string }[] }> };

const owner = `ext${process.pid}`;
let agentDir: string;
let repo: string;
let handlers: Record<string, Handler>;
let tools: Record<string, Tool>;
let commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
let sendMessage: ReturnType<typeof vi.fn>;
let ctx: Record<string, unknown>;
const savedArgv = process.argv[1] ?? '';

const jobs = () => {
  const root = join(agentDir, 'pstack-v2', 'jobs');
  return existsSync(root) ? readdirSync(root) : [];
};
const spec = (id: string) => JSON.parse(readFileSync(join(agentDir, 'pstack-v2', 'jobs', id, 'job.json'), 'utf8')) as { argv: string[] };
const call = (name: string, params: Record<string, unknown>) => tools[name]?.execute('call', params, undefined, undefined, ctx);

beforeEach(() => {
  agentDir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-agent-')));
  // Under home, not a temp directory, since every sandbox may write temp directories.
  repo = realpathSync(mkdtempSync(join(homedir(), '.pstack-repo-')));
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  vi.stubEnv('PSTACK_V2_SANDBOXED', '');
  const fakePi = join(agentDir, 'fake-pi.mjs');
  writeFileSync(fakePi, "process.stdout.write('fake worker report\\n');\n");
  process.argv[1] = fakePi;
  handlers = {};
  tools = {};
  sendMessage = vi.fn();
  commands = {};
  const api = {
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
      commands[name] = command;
    },
    on: (event: string, handler: Handler) => {
      handlers[event] = handler;
    },
    registerTool: (tool: Tool & { name: string }) => {
      tools[tool.name] = tool;
    },
    sendMessage,
  };
  pstack(api as unknown as ExtensionAPI);
  ctx = {
    mode: 'tui',
    hasUI: true,
    ui: { setStatus: vi.fn(), notify: vi.fn((message: string) => process.stderr.write(`NOTIFY: ${message}\n`)) },
    cwd: repo,
    model: undefined,
    sessionManager: { getSessionId: () => owner },
    modelRegistry: { find: (provider: string, id: string) => (provider === 'prov' && id === 'model' ? {} : undefined), getApiKeyAndHeaders: async () => ({}) },
    isProjectTrusted: () => true,
  };
});

afterEach(async () => {
  await handlers['session_shutdown']?.({}, ctx);
  process.argv[1] = savedArgv;
  vi.unstubAllEnvs();
  try {
    execFileSync('tmux', ['-S', tmuxSocket(owner, {}), 'kill-server'], { stdio: 'ignore' });
  } catch {
    // No server was started.
  }
  rmSync(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('pi_spawn', () => {
  test('an unknown model is rejected before any job is created', async () => {
    await expect(call('pi_spawn', { name: 'x', brief: 'hi', model: 'nope/none' })).rejects.toThrow(/Unknown model "nope\/none"/);
    expect(jobs()).toEqual([]);
  });

  test('a bad worktree base leaves no job directory or worktree', async () => {
    await expect(call('pi_spawn', { name: 'x', brief: 'hi', worktree: 'probe', base: 'no-such-ref' })).rejects.toThrow(/invalid reference/);
    expect(jobs()).toEqual([]);
    expect(execFileSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' }).trim().split('\n')).toHaveLength(1);
  });

  test('a readonly worker loses the edit and write tools and cannot write the checkout', async () => {
    await call('pi_spawn', { name: 'ro', brief: 'hi', readonly: true, model: 'prov/model', thinking: 'high' });
    const [id] = jobs();
    const argv = spec(id ?? '').argv;
    expect(argv).toEqual(expect.arrayContaining(['--exclude-tools', 'edit,write', '--model', 'prov/model', '--thinking', 'high', '--approve']));
    if (argv[0] === 'sandbox-exec') expect(argv[2]).not.toContain(`(subpath "${repo}")`);
  });

  test('a worktree worker runs in a new branch checkout it may write', async () => {
    await call('pi_spawn', { name: 'wt', brief: 'hi', worktree: 'feature-x' });
    const [id] = jobs();
    const worktree = join(agentDir, 'pstack-v2', 'jobs', id ?? '', 'worktree');
    expect(execFileSync('git', ['-C', worktree, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('feature-x');
    if (spec(id ?? '').argv[0] === 'sandbox-exec') expect(spec(id ?? '').argv[2]).toContain(`(subpath "${worktree}")`);
  });

  test('a print-mode run waits for its workers and continues with their reports', async () => {
    ctx = { ...ctx, mode: 'print', hasUI: false };
    await call('pi_spawn', { name: 'w', brief: 'hi' });
    const result = (await handlers['agent_before_settle']?.({ entries: [] }, ctx)) as { entries: { content: string }[]; continue: boolean };
    expect(result.continue).toBe(true);
    expect(result.entries.map((entry) => entry.content).join('\n')).toContain('fake worker report');
  });
});

describe('tmux_run', () => {
  test('an interactive session is woken once with the wake message and output', async () => {
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'echo', command: 'echo watched-output', wake: 'Re-check CI.' });
    await expect.poll(() => sendMessage.mock.calls.length, { timeout: 10_000 }).toBe(1);
    const [message, options] = sendMessage.mock.calls[0] ?? [];
    expect(message.content).toContain('Re-check CI.');
    expect(message.content).toContain('watched-output');
    expect(options).toEqual({ triggerTurn: true, deliverAs: 'followUp' });
  });

  test('a directory outside the project is refused', async () => {
    await expect(call('tmux_run', { name: 'out', command: 'true', cwd: '/' })).rejects.toThrow(/inside this project/);
    await expect(call('pi_spawn', { name: 'out', brief: 'hi', cwd: '..' })).rejects.toThrow(/inside this project/);
    expect(jobs()).toEqual([]);
  });

  test('a failing heartbeat wakes once and is not restarted', async () => {
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'tick', command: 'exit 1', wake: 'Tick.', repeat: true });
    await expect.poll(() => sendMessage.mock.calls.length, { timeout: 10_000 }).toBe(1);
    expect(sendMessage.mock.calls[0]?.[0].content).toContain('not restarted');
    expect(jobs()).toHaveLength(1);
  });

  test('stopping a heartbeat by its first id stops the later runs too', async () => {
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'tick', command: 'sleep 0.2', wake: 'Tick.', repeat: true });
    const [first] = jobs();
    await expect.poll(() => jobs().length, { timeout: 10_000 }).toBe(2);
    await call('tmux_jobs', { action: 'stop', ids: [first] });
    const listing = (await call('tmux_jobs', { action: 'list' }))?.content[0]?.text ?? '';
    expect(listing).not.toContain('running');
  });

  test('repeat without a wake message is refused', async () => {
    await expect(call('tmux_run', { name: 'tick', command: 'sleep 1', repeat: true })).rejects.toThrow(/repeat needs a wake/);
  });
});

describe('system prompt', () => {
  test('carries the team-kit rules once and the model roles when configured', async () => {
    writeFileSync(modelsFile(agentDir), 'swarm workers: prov/model high\n');
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, ctx);
    await handlers['before_agent_start']?.(event, ctx);
    expect(event.systemPromptOptions.promptGuidelines.filter((rule) => rule.includes('never'))).toHaveLength(1);
    expect(event.systemPromptOptions.promptGuidelines.some((rule) => rule.includes('top of the module'))).toBe(true);
    expect(event.systemPromptOptions.sections['pstack-models']).toContain('swarm workers: prov/model high');
  });
});

describe('tmux_jobs', () => {
  const text = async (params: Record<string, unknown>) => (await call('tmux_jobs', params))?.content[0]?.text ?? '';

  test('wait returns the report of a finished job and suppresses its wake', async () => {
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'quick', command: 'echo waited-output', wake: 'Next.' });
    const report = await text({ action: 'wait', timeout_seconds: 10 });
    expect(report).toContain('exited with code 0');
    expect(report).toContain('waited-output');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('stop ends a running job, and list shows it stopped with a way to follow its output', async () => {
    await call('tmux_run', { name: 'server', command: 'sleep 30' });
    const [id] = jobs();
    expect(await text({ action: 'list' })).toContain('running');
    await text({ action: 'stop', ids: [id] });
    const listing = await text({ action: 'list' });
    expect(listing).toContain('exited 143');
    expect(listing).toContain(`follow: tail -f ${join(agentDir, 'pstack-v2', 'jobs', id ?? '', 'output.log')}`);
  });

  test('a job from another session is not visible', async () => {
    await call('tmux_run', { name: 'mine', command: 'true' });
    const [id] = jobs();
    ctx = { ...ctx, sessionManager: { getSessionId: () => 'someone-else' } };
    await expect(call('tmux_jobs', { action: 'output', ids: [id] })).rejects.toThrow(/No job/);
  });
});

describe('nested jobs on macOS', { timeout: 20_000 }, () => {
  const topJob = async () => {
    const slowPi = join(agentDir, 'slow-pi.mjs');
    writeFileSync(slowPi, 'setTimeout(() => {}, 30_000);\n');
    process.argv[1] = slowPi;
    ctx = { ...ctx, mode: 'print', hasUI: false };
    await handlers['session_start']?.({}, ctx);
    await call('pi_spawn', { name: 'top', brief: 'hi', wake: false });
    const [id] = jobs();
    const dir = join(agentDir, 'pstack-v2', 'jobs', id ?? '');
    return { dir, granted: spec(id ?? '') as unknown as { policy: { writable: string[] } } };
  };
  const nestedRequest = (topDir: string, name: string, writable: string[], command: string) => {
    const id = `${name}-000001`;
    vi.stubEnv('PSTACK_V2_TOP_DIR', topDir);
    request(join(topDir, 'nested'), {
      id,
      name,
      kind: 'command',
      cwd: repo,
      argv: [],
      command: ['bash', '-c', command],
      policy: { writable, protect: [], lock: [], gitDirs: [], checkouts: [], agentDir, jobDir: join(topDir, 'nested', id) },
      brokered: true,
      owner: 'top-worker',
      wake: 'done',
      repeat: false,
      series: id,
      socket: '',
      sweep: { roots: [], protect: [] },
      out: '',
      createdAt: new Date().toISOString(),
    });
    return resultsDir(topDir, join(topDir, 'nested', id));
  };
  const exitOf = (out: string) => (existsSync(join(out, 'exit')) ? readFileSync(join(out, 'exit'), 'utf8').trim() : undefined);

  test('the root launches a sandboxed worker request inside what it granted', async () => {
    const top = await topJob();
    const dir = nestedRequest(top.dir, 'inner', [repo], `touch ${repo}/brokered.txt`);
    await expect.poll(() => exitOf(dir), { timeout: 10_000 }).toBe('0');
    expect(existsSync(join(repo, 'brokered.txt'))).toBe(true);
  });

  test('the root refuses a request that writes outside what it granted', async () => {
    const top = await topJob();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-outside-')));
    const dir = nestedRequest(top.dir, 'greedy', [outside], `touch ${outside}/escaped.txt`);
    await expect.poll(() => exitOf(dir), { timeout: 10_000 }).toBe('126');
    expect(readFileSync(join(dir, 'output.log'), 'utf8')).toContain('refused');
    expect(existsSync(join(outside, 'escaped.txt'))).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  test('a request is launched under its own narrower sandbox', async () => {
    const top = await topJob();
    expect(top.granted.policy.writable).toEqual(expect.arrayContaining([repo]));
    const dir = nestedRequest(top.dir, 'narrow', [join(top.dir, 'nested')], `touch ${repo}/narrow.txt`);
    await expect.poll(() => exitOf(dir), { timeout: 10_000 }).toBe('1');
    expect(existsSync(join(repo, 'narrow.txt'))).toBe(false);
  });

  test('the root never writes through links a worker plants in its request', async () => {
    const top = await topJob();
    const victim = join(repo, 'victim.txt');
    writeFileSync(victim, 'original\n');
    const out = nestedRequest(top.dir, 'linky', [join(top.dir, 'nested')], 'echo attacker-bytes');
    const requestDir = join(top.dir, 'nested', 'linky-000001');
    for (const name of ['output.log', 'exit', 'launched', 'stderr.log']) symlinkSync(victim, join(requestDir, name));
    await expect.poll(() => exitOf(out), { timeout: 10_000 }).toBe('0');
    expect(readFileSync(victim, 'utf8')).toBe('original\n');
  });

  test('a malformed request does not stop the next one', async () => {
    const top = await topJob();
    mkdirSync(join(top.dir, 'nested', 'aaa-broken'), { recursive: true });
    writeFileSync(join(top.dir, 'nested', 'aaa-broken', 'job.json'), JSON.stringify({ brokered: true, kind: 'command', cwd: repo, command: ['true'], policy: { writable: [1] } }));
    const out = nestedRequest(top.dir, 'zzz-good', [join(top.dir, 'nested')], 'true');
    await expect.poll(() => exitOf(out), { timeout: 10_000 }).toBe('0');
  });

  test.runIf(process.platform === 'darwin')('a sandboxed macOS worker writes a request instead of launching', async () => {
    vi.stubEnv('PSTACK_V2_SANDBOXED', '1');
    vi.stubEnv('PSTACK_V2_JOB_DIR', join(agentDir, 'fake-worker'));
    vi.stubEnv('PSTACK_V2_TOP_DIR', join(agentDir, 'fake-worker'));
    await call('tmux_run', { name: 'asked', command: 'true' });
    const nested = join(agentDir, 'fake-worker', 'nested');
    const [id] = readdirSync(nested);
    const asked = JSON.parse(readFileSync(join(nested, id ?? '', 'job.json'), 'utf8')) as { brokered: boolean; argv: string[] };
    expect([asked.brokered, asked.argv]).toEqual([true, []]);
    expect(existsSync(join(nested, id ?? '', 'launched'))).toBe(false);
  });
});

test('a request from a worker that has finished is never launched', { timeout: 20_000 }, async () => {
  ctx = { ...ctx, mode: 'print', hasUI: false };
  await call('pi_spawn', { name: 'done', brief: 'hi', wake: false });
  const [id] = jobs();
  const root = join(agentDir, 'pstack-v2', 'jobs');
  await expect.poll(() => read(root, id ?? '', owner)?.status.state, { timeout: 10_000 }).toBe('exited');
  const top = read(root, id ?? '', owner);
  if (!top) throw new Error('top job missing');
  const reqId = 'late-000001';
  vi.stubEnv('PSTACK_V2_TOP_DIR', top.dir);
  request(join(top.dir, 'nested'), {
    id: reqId,
    name: 'late',
    kind: 'command',
    cwd: repo,
    argv: [],
    command: ['bash', '-c', `touch ${repo}/late.txt`],
    policy: { writable: [repo], protect: [], lock: [], gitDirs: [], checkouts: [], agentDir, jobDir: join(top.dir, 'nested', reqId) },
    brokered: true,
    owner: 'w',
    wake: null,
    repeat: false,
    series: reqId,
    socket: '',
    sweep: { roots: [], protect: [] },
    out: '',
    createdAt: '',
  });
  serveRequests(top, tmuxSocket(owner, {}), join(top.dir, 'nested'), true);
  expect(existsSync(join(resultsDir(top.dir, join(top.dir, 'nested', reqId)), 'launched'))).toBe(false);
});

describe('git cannot be repointed at planted hooks', { timeout: 20_000 }, () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const finished = async () => {
    const [id] = jobs();
    await expect.poll(() => existsSync(join(agentDir, 'pstack-v2', 'jobs', id ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
  };
  // The job builds its own gitdir with a pre-commit hook, then tries to make the checkout use it.
  const plant = (fake: string, marker: string) =>
    `mkdir -p ${fake}/hooks && cp -R .git/objects .git/refs .git/HEAD ${fake}/ 2>/dev/null; cp -R $(git rev-parse --git-common-dir)/objects $(git rev-parse --git-common-dir)/refs ${fake}/ 2>/dev/null; printf 'ref: refs/heads/main\\n' > ${fake}/HEAD; printf '#!/bin/sh\\ntouch ${marker}\\n' > ${fake}/hooks/pre-commit; chmod +x ${fake}/hooks/pre-commit`;

  test('a job in a linked worktree cannot repoint its .git file', async () => {
    git(repo, 'branch', '-m', 'main');
    const worktree = join(repo, 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'side', worktree);
    ctx = { ...ctx, cwd: worktree };
    const marker = join(homedir(), `.pstack-hook-fired-${process.pid}`);
    await call('tmux_run', {
      name: 'repoint',
      command: `${plant(join(worktree, '.fake'), marker)}; printf 'gitdir: ${join(worktree, '.fake')}\\n' > .git; for f in commondir gitdir; do echo ${join(worktree, '.fake')} > $(git rev-parse --absolute-git-dir)/$f; done`,
    });
    await finished();
    git(worktree, 'commit', '-q', '--allow-empty', '-m', 'after');
    expect(existsSync(marker)).toBe(false);
    rmSync(marker, { force: true });
  });

  test('a job cannot repoint another linked worktree at planted hooks', async () => {
    git(repo, 'branch', '-m', 'main');
    const sibling = join(repo, 'sibling');
    git(repo, 'worktree', 'add', '-q', '-b', 'other', sibling);
    const marker = join(homedir(), `.pstack-hook-fired-sibling-${process.pid}`);
    await call('tmux_run', { name: 'sibling', command: `${plant(join(repo, '.fake'), marker)}; echo ${join(repo, '.fake')} > .git/worktrees/sibling/commondir` });
    await finished();
    git(sibling, 'commit', '-q', '--allow-empty', '-m', 'after');
    expect(existsSync(marker)).toBe(false);
    rmSync(marker, { force: true });
  });

  test('a job in the main checkout cannot swap out its .git directory', async () => {
    const marker = join(homedir(), `.pstack-hook-fired-main-${process.pid}`);
    await call('tmux_run', { name: 'swap', command: `${plant(join(repo, '.fake'), marker)}; mv .git .git-old && mv .fake .git` });
    await finished();
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'after');
    expect(existsSync(marker)).toBe(false);
    rmSync(marker, { force: true });
  });
});

describe('cleanup a job cannot dodge', { timeout: 20_000 }, () => {
  const settledJob = async () => {
    const [id] = jobs();
    await expect.poll(() => existsSync(join(agentDir, 'pstack-v2', 'jobs', id ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
  };

  test('a .pi linked elsewhere is removed as a link and its target is left alone', async () => {
    const victim = realpathSync(mkdtempSync(join(homedir(), '.pstack-victim-')));
    mkdirSync(join(victim, 'extensions'));
    writeFileSync(join(victim, 'settings.json'), '{}');
    await call('tmux_run', { name: 'link', command: `ln -s ${victim} .pi` });
    await settledJob();
    expect([existsSync(join(repo, '.pi')), existsSync(join(victim, 'extensions')), existsSync(join(victim, 'settings.json'))]).toEqual([false, true, true]);
    rmSync(victim, { recursive: true, force: true });
  });

  test('a .pi/extensions renamed into place is removed', async () => {
    await call('tmux_run', { name: 'rename', command: 'mkdir -p built/extensions && echo planted > built/extensions/x.ts && mv built .pi' });
    await settledJob();
    expect(existsSync(join(repo, '.pi', 'extensions'))).toBe(false);
  });

  test('stopping a job ends its processes and still removes what it planted', async () => {
    await call('tmux_run', { name: 'planter', command: 'mkdir -p built/extensions && echo planted > built/extensions/x.ts && mv built .pi && sleep 30 & echo $! > sleeper.pid; wait' });
    const [id] = jobs();
    await expect.poll(() => existsSync(join(repo, 'sleeper.pid')) && existsSync(join(repo, '.pi', 'extensions', 'x.ts')), { timeout: 10_000 }).toBe(true);
    const sleeper = Number(readFileSync(join(repo, 'sleeper.pid'), 'utf8'));
    await call('tmux_jobs', { action: 'stop', ids: [id] });
    await expect.poll(() => existsSync(join(repo, '.pi', 'extensions')), { timeout: 10_000 }).toBe(false);
    const alive = (): boolean => {
      try {
        process.kill(sleeper, 0);
        return true;
      } catch {
        return false;
      }
    };
    await expect.poll(alive, { timeout: 5_000 }).toBe(false);
  });

  test('stop does not touch a tmux server a job points its socket at', async () => {
    const victim = join(tmpdir(), `pstack-victim-${process.pid}.sock`);
    execFileSync('tmux', ['-S', victim, 'new-session', '-d', '-s', 'victim', 'sleep 30']);
    await call('tmux_run', { name: 'pointer', command: 'sleep 30' });
    const [id] = jobs();
    const dir = join(agentDir, 'pstack-v2', 'jobs', id ?? '');
    mkdirSync(join(dir, 'nested'), { recursive: true });
    symlinkSync(victim, join(dir, 'nested', 'tmux.sock'));
    await call('tmux_jobs', { action: 'stop', ids: [id] });
    expect(execFileSync('tmux', ['-S', victim, 'ls'], { encoding: 'utf8' })).toContain('victim');
    execFileSync('tmux', ['-S', victim, 'kill-server']);
  });

  test('a heartbeat keeps running after tmux_jobs wait returns its tick', async () => {
    await call('tmux_run', { name: 'tick', command: 'sleep 0.5', wake: 'Tick.', repeat: true });
    const [first] = jobs();
    await call('tmux_jobs', { action: 'wait', ids: [first], timeout_seconds: 10 });
    expect(jobs()).toHaveLength(2);
    await call('tmux_jobs', { action: 'stop', ids: [first] });
  });
});

describe('credentials', { timeout: 20_000 }, () => {
  const auth = () => join(agentDir, 'auth.json');
  const read = () => JSON.parse(readFileSync(auth(), 'utf8')) as Record<string, { type?: string; key?: string }>;
  const plant = (code: string) => call('tmux_run', { name: 'plant', command: `node -e "const f='${auth()}';const a=JSON.parse(require('fs').readFileSync(f));${code};require('fs').writeFileSync(f,JSON.stringify(a))"` });
  const exited = async () => expect.poll(() => existsSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);

  test('a planted credential command is removed and an approved one is kept', async () => {
    writeFileSync(auth(), JSON.stringify({ mine: { type: 'api_key', key: '!echo mine' }, plain: { type: 'api_key', key: 'sk-x' } }));
    await handlers['session_start']?.({}, ctx);
    await plant("a.evil={type:'api_key',key:'!touch /tmp/pwned'}");
    await exited();
    await expect.poll(() => read()['evil'], { timeout: 10_000 }).toBeUndefined();
    expect([read()['mine']?.key, read()['plain']?.key]).toEqual(['!echo mine', 'sk-x']);
    expect(readFileSync(join(agentDir, 'pstack-v2', 'auth-removed.json'), 'utf8')).toContain('!touch /tmp/pwned');
  });

  test('an approved command a job replaces is put back, not deleted', async () => {
    writeFileSync(auth(), JSON.stringify({ mine: { type: 'api_key', key: '!echo mine' } }));
    await handlers['session_start']?.({}, ctx);
    await plant("a.mine={type:'api_key',key:'!touch /tmp/pwned'}");
    await exited();
    await expect.poll(() => read()['mine']?.key, { timeout: 10_000 }).toBe('!echo mine');
  });

  test('a command you approve stays', async () => {
    writeFileSync(auth(), JSON.stringify({}));
    await handlers['session_start']?.({}, ctx);
    writeFileSync(auth(), JSON.stringify({ added: { type: 'api_key', key: '!op read secret' } }));
    await commands['pstack-approve-credentials']?.handler('', ctx);
    await handlers['turn_start']?.({}, ctx);
    expect(read()['added']?.key).toBe('!op read secret');
  });

  test('credentials a job garbles are restored from the last good copy', async () => {
    writeFileSync(auth(), JSON.stringify({ plain: { type: 'api_key', key: 'sk-x' } }));
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'garble', command: `printf 'not json' > ${auth()}` });
    await exited();
    await expect.poll(() => readFileSync(auth(), 'utf8'), { timeout: 10_000 }).not.toBe('not json');
    expect(read()).toEqual({ plain: { type: 'api_key', key: 'sk-x' } });
  });
});

describe('round five', { timeout: 20_000 }, () => {
  const exited = async () => expect.poll(() => existsSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
  const output = () => readFileSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'output.log'), 'utf8');

  test('a job cannot write shared temp directories, where unsandboxed programs cache code, but has its own', async () => {
    const shared = process.platform === 'darwin' ? realpathSync(tmpdir()) : '/tmp';
    await call('tmux_run', { name: 'tmp', command: `touch ${shared}/pstack-shared-${process.pid} 2>/dev/null && echo SHARED-WRITTEN; touch "$TMPDIR/own" && echo OWN-WRITTEN` });
    await exited();
    // On Linux the write lands in the job's private /tmp, so what matters is that the shared one is untouched.
    expect(output()).toContain('OWN-WRITTEN');
    expect(existsSync(join(shared, `pstack-shared-${process.pid}`))).toBe(false);
  });

  test('your own .pi symlink survives a job', async () => {
    // A target inside the project, where the job may write, so the protected paths under it are watched.
    mkdirSync(join(repo, 'mypi'));
    symlinkSync(join(repo, 'mypi'), join(repo, '.pi'));
    await call('tmux_run', { name: 'benign', command: 'echo hi' });
    await exited();
    expect(lstatSync(join(repo, '.pi')).isSymbolicLink()).toBe(true);
  });
});

test('a worker that fails at startup reports its stderr', { timeout: 20_000 }, async () => {
  const failing = join(agentDir, 'failing-pi.mjs');
  writeFileSync(failing, "process.stderr.write('No API key for provider\\n'); process.exit(1);\n");
  process.argv[1] = failing;
  ctx = { ...ctx, mode: 'print', hasUI: false };
  await call('pi_spawn', { name: 'broken', brief: 'hi' });
  const result = (await handlers['agent_before_settle']?.({ entries: [] }, ctx)) as { entries: { content: string }[] };
  expect(result.entries[0]?.content).toContain('No API key for provider');
});

describe('round four', { timeout: 20_000 }, () => {
  const jobDir = () => join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '');
  const exited = async () => expect.poll(() => existsSync(join(jobDir(), 'exit')), { timeout: 10_000 }).toBe(true);
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  test('a job may not write a directory that holds Pi itself', async () => {
    ctx = { ...ctx, cwd: dirname(agentDir) };
    await expect(call('tmux_run', { name: 'home', command: 'true' })).rejects.toThrow(/contains Pi's agent directory/);
  });

  test.runIf(process.platform === 'darwin')('a job cannot signal a process outside its sandbox, such as the wrapper or Pi', async () => {
    const outside = spawn('sleep', ['30'], { stdio: 'ignore' });
    await call('tmux_run', { name: 'killer', command: `kill -9 ${outside.pid} 2>/dev/null && echo KILLED || echo DENIED` });
    await exited();
    expect([readFileSync(join(jobDir(), 'output.log'), 'utf8').trim(), alive(outside.pid ?? 0)]).toEqual(['DENIED', true]);
    outside.kill();
  });

  test('a job that ignores TERM is still ended by stop', async () => {
    await call('tmux_run', { name: 'stubborn', command: "trap '' TERM; echo $$ > stubborn.pid; while :; do sleep 0.2; done" });
    await expect.poll(() => existsSync(join(repo, 'stubborn.pid')), { timeout: 10_000 }).toBe(true);
    const pid = Number(readFileSync(join(repo, 'stubborn.pid'), 'utf8'));
    await call('tmux_jobs', { action: 'stop', ids: [jobs()[0] ?? ''] });
    expect(alive(pid)).toBe(false);
  });

  test('a child left running when the job exits is ended with it', async () => {
    await call('tmux_run', { name: 'leaver', command: '(sleep 30) & echo $! > child.pid; exit 0' });
    await exited();
    const pid = Number(readFileSync(join(repo, 'child.pid'), 'utf8'));
    await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  });

  test('a protected path that appears during a job is quarantined, not deleted', async () => {
    await call('tmux_run', { name: 'idle', command: `while [ ! -e ${repo}/.go ]; do sleep 0.1; done` });
    mkdirSync(join(repo, '.pi'), { recursive: true });
    writeFileSync(join(repo, '.pi', 'settings.json'), '{"mine":true}');
    writeFileSync(join(repo, '.go'), '');
    await exited();
    const quarantine = join(jobDir(), 'quarantine');
    expect(existsSync(join(repo, '.pi', 'settings.json'))).toBe(false);
    expect(readdirSync(quarantine).some((name) => readFileSync(join(quarantine, name), 'utf8') === '{"mine":true}')).toBe(true);
  });

  test('project-installed Pi packages and the main config.worktree stay read-only', async () => {
    mkdirSync(join(repo, '.pi', 'npm'), { recursive: true });
    writeFileSync(join(repo, '.git', 'config.worktree'), '');
    await call('tmux_run', { name: 'packages', command: 'echo evil > .pi/npm/x.js; printf "[core]\\n\\tfsmonitor = touch pwned\\n" > .git/config.worktree' });
    await exited();
    expect([existsSync(join(repo, '.pi', 'npm', 'x.js')), readFileSync(join(repo, '.git', 'config.worktree'), 'utf8')]).toEqual([false, '']);
  });
});

describe('renames, pointers, sockets, and loops', { timeout: 20_000 }, () => {
  const exited = async () => expect.poll(() => existsSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);

  test('an existing .pi cannot be renamed away and replaced with new extensions', async () => {
    mkdirSync(join(repo, '.pi', 'extensions'), { recursive: true });
    writeFileSync(join(repo, '.pi', 'extensions', 'mine.ts'), 'mine');
    await call('tmux_run', { name: 'swap', command: 'mv .pi .pi.bak; mkdir -p built/extensions && echo evil > built/extensions/e.ts && mv built .pi; echo evil > .pi/extensions/e.ts' });
    await exited();
    expect([existsSync(join(repo, '.pi', 'extensions', 'e.ts')), readFileSync(join(repo, '.pi', 'extensions', 'mine.ts'), 'utf8')]).toEqual([false, 'mine']);
  });

  test('Pi code planted in a subdirectory .pi does not survive the job', async () => {
    await call('tmux_run', { name: 'deep', command: 'mkdir -p pkg/.pi/extensions; echo evil > pkg/.pi/extensions/x.ts; mkdir -p built/.pi/extensions && echo evil > built/.pi/extensions/y.ts && mv built pkg2' });
    await exited();
    expect([existsSync(join(repo, 'pkg', '.pi', 'extensions', 'x.ts')), existsSync(join(repo, 'pkg2', '.pi', 'extensions', 'y.ts'))]).toEqual([false, false]);
  });

  test('a git pointer file is neither repointed nor planted', async () => {
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(repo, 'sub', '.git'), 'gitdir: ../.git/modules/sub\n');
    await call('tmux_run', { name: 'pointer', command: 'echo "gitdir: /tmp/evil" > sub/.git; mkdir -p built && echo "gitdir: /tmp/evil" > built/.git && mv built sub2' });
    await exited();
    expect([readFileSync(join(repo, 'sub', '.git'), 'utf8'), existsSync(join(repo, 'sub2', '.git'))]).toEqual(['gitdir: ../.git/modules/sub\n', false]);
  });

  test.runIf(process.platform === 'darwin')('a job cannot connect to a local service socket', async () => {
    const socket = join(homedir(), `.pstack-svc-${process.pid}.sock`);
    const server = (await import('node:net')).createServer((connection) => connection.end('reached\n')).listen(socket);
    await new Promise((done) => server.once('listening', done));
    await call('tmux_run', { name: 'connect', command: `node -e "require('net').connect('${socket}').on('data',d=>{console.log(String(d).trim());process.exit()}).on('error',()=>{console.log('refused');process.exit()})"` });
    await exited();
    expect(readFileSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'output.log'), 'utf8').trim()).toBe('refused');
    server.close();
  });

  test('a worker cannot freeze the root with a loop of nested links', async () => {
    const root = join(agentDir, 'pstack-v2', 'jobs');
    await call('pi_spawn', { name: 'top', brief: 'hi', wake: false });
    const top = read(root, jobs()[0] ?? '', owner);
    if (!top) throw new Error('top job missing');
    for (const name of ['a', 'b', 'c']) {
      mkdirSync(join(top.dir, 'nested', name), { recursive: true });
      writeFileSync(join(top.dir, 'nested', name, 'job.json'), JSON.stringify({ brokered: true, kind: 'command', cwd: repo, command: ['true'], policy: { writable: [], protect: [], lock: [], gitDirs: [] } }));
      symlinkSync(join(top.dir, 'nested'), join(top.dir, 'nested', name, 'nested'));
    }
    const started = Date.now();
    serveRequests(top, tmuxSocket(owner, {}), join(top.dir, 'nested'), true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('logging in over an approved credential command sticks', async () => {
    const auth = join(agentDir, 'auth.json');
    writeFileSync(auth, JSON.stringify({ mine: { type: 'api_key', key: '!echo mine' } }));
    await handlers['session_start']?.({}, ctx);
    writeFileSync(auth, JSON.stringify({ mine: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 } }));
    await handlers['turn_start']?.({}, ctx);
    expect(JSON.parse(readFileSync(auth, 'utf8'))).toEqual({ mine: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 } });
  });
});
