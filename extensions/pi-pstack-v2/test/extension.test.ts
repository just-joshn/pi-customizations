import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import pstack, { modelsFile } from '../src/index.ts';
import { tmuxSocket } from '../src/jobs.ts';

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Tool = {
  description?: string;
  parameters?: { properties: Record<string, { description?: string }> };
  execute: (id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown) => Promise<{ content: { text: string }[] }>;
};

const SKILL_PATH_PLACEHOLDER = '/<name>/SKILL.md';
const SESSION_FILE = '/sessions/run.jsonl';
const MODE_OFF_COMMAND = '/pstack-mode off';
const MODE_KEEPS_SKILL_TITLE = '/pstack-mode keeps a skill in the system prompt every turn until it is turned off';
const MODE_REFUSES_NAME_TITLE = '/pstack-mode refuses a name that is not a pstack skill and keeps the current mode';
const WAIT_SHORT_SECONDS = 10;
const WAIT_LONG_SECONDS = 15;
const WAIT_BUDGET_MS = 10_000;
const WAIT_DEFAULT_ELAPSED_MS = 301_000;
const INTERROGATE_TIMEOUT_MS = 30_000;
const owner = `ext${process.pid}`;
let agentDir: string;
let repo: string;
let handlers: Record<string, Handler>;
let tools: Record<string, Tool>;
let commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
let sendMessage: ReturnType<typeof vi.fn>;
let branch: { type: string; customType?: string; data?: unknown }[];
let ctx: Record<string, unknown>;

const jobs = () => {
  const root = join(agentDir, 'pstack-v2', 'jobs');
  return existsSync(root) ? readdirSync(root) : [];
};
const jobsRoot = () => join(agentDir, 'pstack-v2', 'jobs');
const call = (name: string, params: Record<string, unknown>) => tools[name]?.execute('call', params, undefined, undefined, ctx);

beforeEach(() => {
  agentDir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-agent-')));
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-repo-')));
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  handlers = {};
  tools = {};
  sendMessage = vi.fn();
  commands = {};
  branch = [];
  const api = {
    appendEntry: (customType: string, data?: unknown) => {
      branch = [...branch, { type: 'custom', customType, data }];
    },
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
      commands = { ...commands, [name]: command };
    },
    on: (event: string, handler: Handler) => {
      handlers = { ...handlers, [event]: handler };
    },
    registerTool: (tool: Tool & { name: string }) => {
      tools = { ...tools, [tool.name]: tool };
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
    sessionManager: { getSessionId: () => owner, getSessionFile: () => undefined, getBranch: () => branch },
    modelRegistry: {
      find: (provider: string, id: string) => (provider === 'prov' && (id === 'model' || id === 'no-credentials') ? {} : undefined),
      getAvailable: () => [{ provider: 'prov', id: 'model' }],
      getApiKeyAndHeaders: async () => ({}),
    },
    isProjectTrusted: () => true,
    isIdle: () => true,
    hasPendingMessages: () => false,
  };
});

afterEach(async () => {
  await handlers?.['session_shutdown']?.({}, ctx);
  vi.unstubAllEnvs();
  spawnSync('tmux', ['-S', tmuxSocket(owner), 'kill-server'], { stdio: 'ignore' });
  if (agentDir) rmSync(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('tmux_run', { timeout: 20_000 }, () => {
  test('an interactive session is woken once with the wake message and output, between tool calls rather than after its whole run', async () => {
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'echo', command: 'echo watched-output', wake: 'Re-check CI.' });
    await expect.poll(() => sendMessage.mock.calls.length, { timeout: 10_000 }).toBe(1);
    const [message, options] = sendMessage.mock.calls[0] ?? [];
    expect(message.content).toContain('Re-check CI.');
    expect(message.content).toContain('watched-output');
    expect(options).toEqual({ triggerTurn: true, deliverAs: 'steer' });
  });

  test('a cwd relative to the session runs the command there', async () => {
    mkdirSync(join(repo, 'sub'));
    await call('tmux_run', { name: 'sub', command: 'pwd', cwd: 'sub' });
    const [id] = jobs();
    await expect.poll(() => existsSync(join(jobsRoot(), id ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
    expect(readFileSync(join(jobsRoot(), id ?? '', 'output.log'), 'utf8').trim()).toBe(join(repo, 'sub'));
  });

  test('a cwd that is not a directory is refused before any job starts', async () => {
    await expect(call('tmux_run', { name: 'missing', command: 'true', cwd: 'nowhere' })).rejects.toThrow(/is not a directory/);
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
  const prompt = async () => {
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, ctx);
    return event.systemPromptOptions.sections['pstack-mode'];
  };

  test(MODE_KEEPS_SKILL_TITLE, async () => {
    expect(await prompt()).toBeUndefined();
    await commands['pstack-mode']?.handler('poteto-mode', ctx);
    const section = await prompt();
    expect(section).toContain('<skill name="poteto-mode"');
    expect(section).toContain('# Poteto mode');
    expect(section).toContain(MODE_OFF_COMMAND);
    expect(await prompt()).toBe(section);
    expect((ctx['ui'] as { setStatus: ReturnType<typeof vi.fn> }).setStatus).toHaveBeenLastCalledWith('pstack-mode', 'mode: poteto-mode');
    await commands['pstack-mode']?.handler('off', ctx);
    expect(await prompt()).toBeUndefined();
    expect((ctx['ui'] as { setStatus: ReturnType<typeof vi.fn> }).setStatus).toHaveBeenLastCalledWith('pstack-mode', undefined);
  });

  test('the mode comes back from the session branch when the session starts or the branch changes', async () => {
    branch = [...branch, { type: 'custom', customType: 'pstack-mode', data: { skill: 'how' } }];
    await handlers['session_start']?.({}, ctx);
    expect(await prompt()).toContain('<skill name="how"');
    branch = [];
    await handlers['session_tree']?.({}, ctx);
    expect(await prompt()).toBeUndefined();
  });

  test(MODE_REFUSES_NAME_TITLE, async () => {
    await commands['pstack-mode']?.handler('poteto-mode', ctx);
    await commands['pstack-mode']?.handler('../../etc', ctx);
    expect(await prompt()).toContain('<skill name="poteto-mode"');
    expect((ctx['ui'] as { notify: ReturnType<typeof vi.fn> }).notify).toHaveBeenLastCalledWith(expect.stringContaining('not a pstack skill'), 'error');
  });
});

describe('system prompt, roles and session', () => {
  test('carries the model roles when configured, and no team-kit rule, since pstack uses none', async () => {
    writeFileSync(modelsFile(agentDir), 'swarm workers: prov/model high\n');
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, ctx);
    expect(event.systemPromptOptions.promptGuidelines).toHaveLength(1);
    expect(event.systemPromptOptions.sections['pstack-models']).toContain('swarm workers: prov/model high');
  });

  test('says where every pstack skill lives, once, since Pi hides some from the skill list', async () => {
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, ctx);
    await handlers['before_agent_start']?.(event, ctx);
    const skills = event.systemPromptOptions.promptGuidelines.filter((rule) => rule.includes(SKILL_PATH_PLACEHOLDER));
    expect(skills).toHaveLength(1);
    expect(skills[0]).toContain(join(dirname(dirname(fileURLToPath(import.meta.url))), 'skills'));
    expect(skills[0]).toMatch(/read that file and follow it/);
  });

  test("names this session's transcript, since a worker cannot find the parent session by itself", async () => {
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, { ...ctx, sessionManager: { getSessionId: () => owner, getSessionFile: () => SESSION_FILE } });
    expect(event.systemPromptOptions.sections['pstack-session']).toContain(SESSION_FILE);
    const ephemeral = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(ephemeral, { ...ctx, sessionManager: { getSessionId: () => owner, getSessionFile: () => undefined } });
    expect(ephemeral.systemPromptOptions.sections['pstack-session']).toBeUndefined();
  });
});

const text = async (params: Record<string, unknown>) => (await call('tmux_jobs', params))?.content[0]?.text ?? '';

describe('tmux_jobs', { timeout: 20_000 }, () => {
  test('wait returns the report of a finished job and suppresses its wake', async () => {
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'quick', command: 'echo waited-output', wake: 'Next.' });
    const report = await text({ action: 'wait', timeout_seconds: WAIT_SHORT_SECONDS });
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

  test('wait with no ids skips servers started without a wake, which never exit on their own', async () => {
    await call('tmux_run', { name: 'server', command: 'sleep 30' });
    await call('tmux_run', { name: 'build', command: 'echo built-output', wake: 'Built.' });
    const started = Date.now();
    const report = await text({ action: 'wait', timeout_seconds: WAIT_LONG_SECONDS });
    expect(Date.now() - started).toBeLessThan(WAIT_BUDGET_MS);
    expect(report).toContain('built-output');
    expect(report).not.toContain('still running');
  });
});

describe('tmux_jobs, waiting and output', { timeout: 20_000 }, () => {
  test('wait hands the turn back as soon as the user sends a message', async () => {
    await call('tmux_run', { name: 'slow', command: 'sleep 30', wake: 'Slow.' });
    ctx = { ...ctx, hasPendingMessages: () => true };
    const started = Date.now();
    const report = await text({ action: 'wait', timeout_seconds: WAIT_LONG_SECONDS });
    expect(Date.now() - started).toBeLessThan(WAIT_BUDGET_MS);
    expect(report).toContain('still running');
  });

  test('wait without a timeout hands the turn back after five minutes, not thirty', async () => {
    await call('tmux_run', { name: 'slow', command: 'sleep 600', wake: 'Slow.' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      const waiting = text({ action: 'wait' });
      await vi.advanceTimersByTimeAsync(WAIT_DEFAULT_ELAPSED_MS);
      expect(await Promise.race([waiting, Promise.resolve('STILL WAITING')])).toContain('still running');
    } finally {
      vi.useRealTimers();
    }
  });

  test('stopping a job that is slow to end does not wake the session with a lost-job report', async () => {
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'stubborn', command: "trap '' TERM; touch ready; while :; do sleep 0.2; done", wake: 'Done.' });
    await expect.poll(() => existsSync(join(repo, 'ready')), { timeout: 10_000 }).toBe(true);
    await call('tmux_jobs', { action: 'stop', ids: [jobs()[0] ?? ''] });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('tmux_jobs, live sessions', { timeout: 20_000 }, () => {
  test("a job's output shows live in its tmux session, and list says how to attach to it", async () => {
    await call('tmux_run', { name: 'live', command: 'echo live-in-pane; sleep 30' });
    const [id] = jobs();
    const socket = tmuxSocket(owner);
    await expect.poll(() => execFileSync('tmux', ['-S', socket, 'capture-pane', '-p', '-t', id ?? ''], { encoding: 'utf8' }), { timeout: 10_000 }).toContain('live-in-pane');
    expect(await text({ action: 'list' })).toContain(`attach: tmux -S ${socket} attach -t ${id}`);
  });

  test('Ctrl-C in the attached session stops the job, which records that it was stopped', async () => {
    await call('tmux_run', { name: 'interrupt', command: 'touch ready; sleep 30' });
    const [id] = jobs();
    await expect.poll(() => existsSync(join(repo, 'ready')), { timeout: 10_000 }).toBe(true);
    execFileSync('tmux', ['-S', tmuxSocket(owner), 'send-keys', '-t', id ?? '', 'C-c']);
    await expect.poll(() => (existsSync(join(jobsRoot(), id ?? '', 'exit')) ? readFileSync(join(jobsRoot(), id ?? '', 'exit'), 'utf8').trim() : ''), { timeout: 10_000 }).toBe('143');
  });

  test('a job from another session is not visible', async () => {
    await call('tmux_run', { name: 'mine', command: 'true' });
    const [id] = jobs();
    ctx = { ...ctx, sessionManager: { getSessionId: () => 'someone-else' } };
    await expect(call('tmux_jobs', { action: 'output', ids: [id] })).rejects.toThrow(/No job/);
  });
});

describe('tmux_jobs, heartbeats', { timeout: 20_000 }, () => {
  test('a heartbeat keeps running after tmux_jobs wait returns its tick', async () => {
    await call('tmux_run', { name: 'tick', command: 'sleep 0.5', wake: 'Tick.', repeat: true });
    const [first] = jobs();
    await call('tmux_jobs', { action: 'wait', ids: [first], timeout_seconds: WAIT_SHORT_SECONDS });
    expect(jobs()).toHaveLength(2);
    await call('tmux_jobs', { action: 'stop', ids: [first] });
  });
});

const alive = (pid: number): boolean => spawnSync('kill', ['-0', String(pid)]).status === 0;

describe('tmux_jobs, process groups', { timeout: 20_000 }, () => {
  const jobDir = () => join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '');
  const exited = async () => expect.poll(() => existsSync(join(jobDir(), 'exit')), { timeout: 10_000 }).toBe(true);

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
});

describe('workers and the jobs they start', { timeout: INTERROGATE_TIMEOUT_MS }, () => {
  const exitOf = (dir: string) => (existsSync(join(dir, 'exit')) ? readFileSync(join(dir, 'exit'), 'utf8').trim() : undefined);

  test('a print-mode worker hears about a finished job while it works', async () => {
    ctx = { ...ctx, mode: 'print', hasUI: false, isIdle: () => false };
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'probe', command: 'echo probe-output', wake: 'Probe done.' });
    await expect.poll(() => sendMessage.mock.calls.length, { timeout: 10_000 }).toBe(1);
    expect(sendMessage.mock.calls[0]?.[0].content).toContain('probe-output');
    expect(await handlers['agent_before_settle']?.({ entries: [] }, ctx)).toBeUndefined();
  });

  test('tmux_run may run in a linked worktree of this repository, such as a worker checkout', async () => {
    const worktree = join(jobsRoot(), 'manual-000001', 'worktree');
    mkdirSync(dirname(worktree), { recursive: true });
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'side', worktree]);
    await call('tmux_run', { name: 'in-worktree', command: 'touch from-job', cwd: worktree });
    const id = jobs().find((name) => name.startsWith('in-worktree')) ?? '';
    await expect.poll(() => exitOf(join(jobsRoot(), id)), { timeout: 10_000 }).toBe('0');
    expect(existsSync(join(worktree, 'from-job'))).toBe(true);
  });
});
