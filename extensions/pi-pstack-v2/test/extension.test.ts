import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import pstack, { modelsFile } from '../src/index.ts';
import { tmuxSocket } from '../src/jobs.ts';
import { externalTempCases } from './fixtures/temp-mutations.ts';

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Tool = {
  description?: string;
  parameters?: { properties: Record<string, { description?: string }> };
  execute: (id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown) => Promise<{ content: { text: string }[] }>;
};

const ROOT_DIR = '/';
const SHARED_TMP_DIR = '/tmp';
const SKILL_PATH_PLACEHOLDER = '/<name>/SKILL.md';
const SESSION_FILE = '/sessions/run.jsonl';
const MODE_OFF_COMMAND = '/pstack-mode off';
const MODE_KEEPS_SKILL_TITLE = '/pstack-mode keeps a skill in the system prompt every turn until it is turned off';
const MODE_REFUSES_NAME_TITLE = '/pstack-mode refuses a name that is not a pstack skill and keeps the current mode';
const authSchema = z.record(z.string(), z.record(z.string(), z.unknown()));
const WAIT_SHORT_SECONDS = 10;
const WAIT_LONG_SECONDS = 15;
const WAIT_BUDGET_MS = 10_000;
const WAIT_DEFAULT_ELAPSED_MS = 301_000;
const MACOS_TOOL_POLL_TIMEOUT_MS = 45_000;
const MACOS_SANDBOX_TIMEOUT_MS = 60_000;
const INTERROGATE_TIMEOUT_MS = 30_000;
const RANDOM_SUFFIX_BYTES = 3;
const PNPM_MIN_MAJOR = 11;
const askedSchema = z.object({ brokered: z.boolean(), argv: z.array(z.unknown()) });
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
const wrapperEnv = (dir: string) => {
  const wrapper = readFileSync(join(dir, 'wrapper.sh'), 'utf8');
  const pick = (name: string) => new RegExp(`${name}='([^']*)'`).exec(wrapper)?.[1];
  return { job: pick('PSTACK_V2_JOB_DIR'), top: pick('PSTACK_V2_TOP_DIR') };
};
const jobsRoot = () => join(agentDir, 'pstack-v2', 'jobs');
const call = (name: string, params: Record<string, unknown>) => tools[name]?.execute('call', params, undefined, undefined, ctx);

beforeEach(() => {
  agentDir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-agent-')));
  // Under home, not a temp directory, since every sandbox may write temp directories.
  repo = realpathSync(mkdtempSync(join(homedir(), '.pstack-repo-')));
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  vi.stubEnv('PSTACK_V2_SANDBOXED', '');
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

describe('launch paths and the nesting limit', { timeout: 20_000 }, () => {
  test('a root tmux_run runs as its own top-level job', async () => {
    await call('tmux_run', { name: 'c', command: 'true' });
    expect(jobs()).toHaveLength(1);
    for (const id of jobs()) {
      const { job, top } = wrapperEnv(join(jobsRoot(), id));
      expect([job, top]).toEqual([join(jobsRoot(), id), join(jobsRoot(), id)]);
    }
  });
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

  test('a directory outside the project is refused', async () => {
    await expect(call('tmux_run', { name: 'out', command: 'true', cwd: ROOT_DIR })).rejects.toThrow(/inside this project/);
    expect(jobs()).toEqual([]);
  });

  test("a checkout of another repository placed inside the project is refused, since the job would be handed that repository's git directory", async () => {
    const other = realpathSync(mkdtempSync(join(homedir(), '.pstack-other-')));
    try {
      execFileSync('git', ['init', '-q', other]);
      execFileSync('git', ['-C', other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
      const planted = join(repo, 'scratch', 'other-checkout');
      execFileSync('git', ['-C', other, 'worktree', 'add', '-q', '-b', 'side', planted]);
      await expect(call('tmux_run', { name: 'foreign', command: 'true', cwd: planted })).rejects.toThrow(/another repository/);
      expect(jobs()).toEqual([]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
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

  test("names this session's transcript, since a worker's agent directory is its job's and holds no parent session", async () => {
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, { ...ctx, sessionManager: { getSessionId: () => owner, getSessionFile: () => SESSION_FILE } });
    expect(event.systemPromptOptions.sections['pstack-session']).toContain(SESSION_FILE);
    const ephemeral = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(ephemeral, { ...ctx, sessionManager: { getSessionId: () => owner, getSessionFile: () => undefined } });
    expect(ephemeral.systemPromptOptions.sections['pstack-session']).toBeUndefined();
  });
});

describe('sandbox guidance', () => {
  test('a worker is told the shared /tmp is read-only and its own temp directory is $TMPDIR', async () => {
    vi.stubEnv('PSTACK_V2_SANDBOXED', '1');
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, ctx);
    expect(event.systemPromptOptions.sections['pstack-sandbox']).toMatch(/\/tmp.*read-only.*\$TMPDIR/s);
  });

  test('the root session gets no sandbox section, since its own shell is not sandboxed', async () => {
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, ctx);
    expect(event.systemPromptOptions.sections['pstack-sandbox']).toBeUndefined();
  });

  test('tmux_run tells the model its command must keep temp files in $TMPDIR', () => {
    expect(tools['tmux_run']?.description).toMatch(/\/tmp.*read-only.*\$TMPDIR/s);
  });

  test('a worker is told what the sandbox refuses that scripts assume: process listings, and here-documents in a checkout it cannot write', async () => {
    vi.stubEnv('PSTACK_V2_SANDBOXED', '1');
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, ctx);
    const note = event.systemPromptOptions.sections['pstack-sandbox'];
    expect(note).toMatch(/`ps`.*`top`.*`uptime`/s);
    expect(note).toMatch(/here-document.*\$TMPDIR/s);
  });

  test('a worker is told why SSH pushes and config writes fail, so it does not retry them', async () => {
    vi.stubEnv('PSTACK_V2_SANDBOXED', '1');
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, ctx);
    const note = event.systemPromptOptions.sections['pstack-sandbox'];
    expect(note).toMatch(/Unix sockets.*ssh-agent.*HTTPS remote/s);
    expect(note).toMatch(/\.git\/hooks.*\.vscode.*\.claude.*quarantine/s);
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

describe('nested jobs', { timeout: 20_000 }, () => {
  test('a sandboxed worker writes a request instead of launching', async () => {
    vi.stubEnv('PSTACK_V2_SANDBOXED', '1');
    vi.stubEnv('PSTACK_V2_JOB_DIR', join(agentDir, 'fake-worker'));
    vi.stubEnv('PSTACK_V2_TOP_DIR', join(agentDir, 'fake-worker'));
    await call('tmux_run', { name: 'asked', command: 'true' });
    const nested = join(agentDir, 'fake-worker', 'nested');
    const [id] = readdirSync(nested);
    const asked = askedSchema.parse(JSON.parse(readFileSync(join(nested, id ?? '', 'job.json'), 'utf8')));
    expect([asked.brokered, asked.argv]).toEqual([true, []]);
    expect(existsSync(join(nested, id ?? '', 'launched'))).toBe(false);
  });
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
    const alive = (): boolean => spawnSync('kill', ['-0', String(sleeper)]).status === 0;
    await expect.poll(alive, { timeout: 5_000 }).toBe(false);
  });
});

describe('cleanup a job cannot dodge, stop and heartbeat', { timeout: 20_000 }, () => {
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
    await call('tmux_jobs', { action: 'wait', ids: [first], timeout_seconds: WAIT_SHORT_SECONDS });
    expect(jobs()).toHaveLength(2);
    await call('tmux_jobs', { action: 'stop', ids: [first] });
  });
});

describe('round five', { timeout: 20_000 }, () => {
  const exited = async () => expect.poll(() => existsSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
  const output = () => readFileSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'output.log'), 'utf8');

  test('a job cannot write shared temp directories, where unsandboxed programs cache code, but has its own', async () => {
    const shared = process.platform === 'darwin' ? realpathSync(tmpdir()) : SHARED_TMP_DIR;
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

const alive = (pid: number): boolean => spawnSync('kill', ['-0', String(pid)]).status === 0;

describe('round four', { timeout: 20_000 }, () => {
  const jobDir = () => join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '');
  const exited = async () => expect.poll(() => existsSync(join(jobDir(), 'exit')), { timeout: 10_000 }).toBe(true);

  test('a job may not write a directory that holds Pi itself', async () => {
    ctx = { ...ctx, cwd: dirname(agentDir) };
    await expect(call('tmux_run', { name: 'home', command: 'true' })).rejects.toThrow(/contains Pi's agent directory/);
  });

  test('a job cannot signal a process outside its sandbox, such as the wrapper or Pi', async () => {
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

  test('a job cannot connect to a local service socket', async () => {
    const socket = join(homedir(), `.pstack-svc-${process.pid}.sock`);
    const server = (await import('node:net')).createServer((connection) => connection.end('reached\n')).listen(socket);
    await new Promise((done) => server.once('listening', done));
    await call('tmux_run', { name: 'connect', command: `node -e "require('net').connect('${socket}').on('data',d=>{console.log(String(d).trim());process.exit()}).on('error',()=>{console.log('refused');process.exit()})"` });
    await exited();
    expect(readFileSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'output.log'), 'utf8').trim()).toBe('refused');
    server.close();
  });
});

describe('a sweep a job cannot switch off', { timeout: 20_000 }, () => {
  const exited = async () => expect.poll(() => existsSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);

  test.for([
    ['an unreadable directory', 'mkdir zz && touch zz/f && chmod 444 zz'],
    ['an unlistable directory', 'mkdir zz && chmod 000 zz'],
    ['a hidden directory holding the code', 'mkdir -p hide/.pix/extensions && echo evil > hide/.pix/extensions/h.ts && mv hide/.pix hide/.pi && chmod 000 hide'],
    ['an unlistable .pi itself', 'mkdir -p hide/.pix/extensions && echo evil > hide/.pix/extensions/h.ts && mv hide/.pix hide/.pi && chmod 000 hide/.pi'],
  ])('renamed-in Pi code is still quarantined behind %s', async ([, trap]) => {
    await call('tmux_run', { name: 'trap', command: `mkdir -p packages/app/.pix/extensions && echo evil > packages/app/.pix/extensions/evil.ts && mv packages/app/.pix packages/app/.pi; ${trap}` });
    await exited();
    expect([existsSync(join(repo, 'packages', 'app', '.pi', 'extensions', 'evil.ts')), existsSync(join(repo, 'hide', '.pi', 'extensions'))]).toEqual([false, false]);
  });
});

describe('interrogate round', { timeout: INTERROGATE_TIMEOUT_MS }, () => {
  const jobsRootLocal = () => join(agentDir, 'pstack-v2', 'jobs');

  test('a job cannot write your credentials at all', async () => {
    const auth = join(agentDir, 'auth.json');
    writeFileSync(auth, JSON.stringify({ plain: { type: 'api_key', key: 'sk-x' } }));
    await call('tmux_run', { name: 'plant', command: `printf '{"evil":{"type":"api_key","key":"!touch /tmp/pwned"}}' > ${auth}; echo rc=$?` });
    await expect.poll(() => existsSync(join(jobsRootLocal(), jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
    expect(authSchema.parse(JSON.parse(readFileSync(auth, 'utf8')))).toEqual({ plain: { type: 'api_key', key: 'sk-x' } });
  });

  test('Pi code planted very deep is swept', async () => {
    const deep = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o';
    await call('tmux_run', { name: 'deep', command: `mkdir -p ${deep}/.pix/extensions && echo x > ${deep}/.pix/extensions/evil.ts && mv ${deep}/.pix ${deep}/.pi` });
    await expect.poll(() => existsSync(join(jobsRootLocal(), jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
    expect(existsSync(join(repo, deep, '.pi', 'extensions', 'evil.ts'))).toBe(false);
  });
});

describe('a job agent directory', { timeout: 20_000 }, () => {
  test('lets a job keep its credentials copy current but not change what Pi loads', async () => {
    writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ plain: { type: 'api_key', key: 'sk-x' } }));
    mkdirSync(join(agentDir, 'extensions'));
    await call('tmux_run', {
      name: 'agent',
      command:
        'cd "$PI_CODING_AGENT_DIR" && echo \'{"plain":{"type":"api_key","key":"sk-y"}}\' > auth.json && mkdir auth.json.lock && rmdir auth.json.lock && echo COPY-OK; rm -f extensions; mkdir extensions 2>/dev/null; echo evil > extensions/e.ts 2>/dev/null && echo PLANTED; echo "{}" > settings.json 2>/dev/null && echo SETTINGS-WRITTEN',
    });
    const dir = join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '');
    await expect.poll(() => existsSync(join(dir, 'exit')), { timeout: 10_000 }).toBe(true);
    // On Linux a write elsewhere in the directory lands in the job's own throwaway view, so the check is on what persists.
    const shared = join(dir, 'agent');
    expect(readFileSync(join(dir, 'output.log'), 'utf8')).toContain('COPY-OK');
    expect([lstatSync(join(shared, 'extensions')).isSymbolicLink(), existsSync(join(shared, 'settings.json')), existsSync(join(agentDir, 'extensions', 'e.ts'))]).toEqual([true, false, false]);
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

const firefox = (() => {
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (process.platform !== 'darwin' || !existsSync(cache)) return undefined;
  const dir = readdirSync(cache).find((name) => name.startsWith('firefox-'));
  const binary = dir && join(cache, dir, 'firefox', 'Nightly.app', 'Contents', 'MacOS', 'firefox');
  return binary && existsSync(binary) ? binary : undefined;
})();
const pnpmVersion = (() => {
  const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8', cwd: tmpdir() });
  return result.status === 0 ? result.stdout.trim() : undefined;
})();

const run = async (command: string) => {
  await call('tmux_run', { name: 'tool', command });
  const dir = join(jobsRoot(), jobs()[0] ?? '');
  await expect.poll(() => existsSync(join(dir, 'exit')), { timeout: MACOS_TOOL_POLL_TIMEOUT_MS }).toBe(true);
  return readFileSync(join(dir, 'output.log'), 'utf8').trim();
};

describe('the macOS sandbox and the tools jobs run', { timeout: MACOS_SANDBOX_TIMEOUT_MS }, () => {
  test.skipIf(process.platform !== 'darwin')('a job cannot start an app it wrote outside the sandbox through LaunchServices', async () => {
    const marker = join(agentDir, 'escaped');
    const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Probe</string><key>CFBundleIdentifier</key><string>dev.pstack.probe${Date.now()}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`;
    await run(
      `A="$TMPDIR/Probe.app"; mkdir -p "$A/Contents/MacOS"; printf '#!/bin/sh\\necho escaped > ${marker}\\n' > "$A/Contents/MacOS/Probe"; chmod +x "$A/Contents/MacOS/Probe"; echo '${plist}' > "$A/Contents/Info.plist"; open -g -j -a "$A" 2>/dev/null; sleep 3`,
    );
    expect(existsSync(marker)).toBe(false);
  });

  test.skipIf(!firefox)('a job can run headless Firefox', async () => {
    expect(await run(`mkdir -p "$TMPDIR/ff"; '${firefox}' -headless -no-remote -profile "$TMPDIR/ff" -screenshot "$TMPDIR/shot.png" 'data:text/html,hi' >/dev/null 2>&1; test -s "$TMPDIR/shot.png" && echo SHOT`)).toBe('SHOT');
  });

  test.skipIf(process.platform !== 'darwin').each(['.com.google.Chrome.', '.com.google.Chrome.pstack-long-', 'pstack-other-'])('a job cannot create %s names in the per-user temp directory', async (prefix) => {
    const shared = execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).trim();
    const fixture = join(shared, prefix + randomBytes(RANDOM_SUFFIX_BYTES).toString('hex'));
    expect(existsSync(fixture)).toBe(false);
    try {
      expect(await run(`printf x > '${fixture}' && echo TEMP-CREATED`)).not.toContain('TEMP-CREATED');
      expect(readFileSync(join(jobsRoot(), jobs()[0] ?? '', 'exit'), 'utf8').trim()).not.toBe('0');
      expect(existsSync(fixture)).toBe(false);
    } finally {
      rmSync(fixture, { force: true });
    }
  });
});

describe('the macOS sandbox, temp directories and shells', { timeout: MACOS_SANDBOX_TIMEOUT_MS }, () => {
  test('top-level commands point Chromium at their private temp directory', async () => {
    const output = await run('printf "%s|%s" "$TMPDIR" "$MAC_CHROMIUM_TMPDIR"');
    const tmp = join(jobsRoot(), jobs()[0] ?? '', 'tmp');
    expect(output).toBe(`${tmp}|${tmp}`);
  });

  test.skipIf(process.platform !== 'darwin')('mktemp lands in the job temp directory, bare, with a prefix, and with a template', async () => {
    expect(
      await run(
        'd=$(mktemp -d) && [ -d "$d" ] && case "$d" in "$TMPDIR"/*) echo DIR ;; esac; f=$(mktemp -t pre) && case "$f" in "$TMPDIR"/pre.*) echo PREFIX ;; esac; t=$(mktemp "$TMPDIR/x.XXXXXX") && [ -f "$t" ] && echo TEMPLATE; q=$(mktemp) && [ -f "$q" ] && echo FILE',
      ),
    ).toBe('DIR\nPREFIX\nTEMPLATE\nFILE');
  });

  test.skipIf(process.platform !== 'darwin')('a zsh here-document works in a job', async () => {
    expect(await run("zsh -c 'cat <<EOF\nzsh-heredoc\nEOF'")).toBe('zsh-heredoc');
  });

  test.skipIf(process.platform !== 'darwin').each(externalTempCases)('a job cannot $operation an external $browser temp file', async ({ browser, statement }) => {
    const shared = execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).trim();
    const fixture = join(shared, `.${browser}.${randomBytes(RANDOM_SUFFIX_BYTES).toString('hex')}`);
    const original = Buffer.from('outside-original\n');
    writeFileSync(fixture, original, { flag: 'wx' });
    try {
      const script = `const fs = require("node:fs"); const file = ${JSON.stringify(fixture)}; const destination = ${JSON.stringify(join(repo, 'renamed-external-temp'))}; console.log("MUTATION-ATTEMPTED"); ${statement}`;
      const output = await run(`'${process.execPath}' -e '${script}'`);
      expect(output).toContain('MUTATION-ATTEMPTED');
      const dir = join(jobsRoot(), jobs()[0] ?? '');
      expect(readFileSync(join(dir, 'exit'), 'utf8').trim()).not.toBe('0');
      expect(readFileSync(fixture)).toEqual(original);
      expect(existsSync(join(repo, 'renamed-external-temp'))).toBe(false);
    } finally {
      rmSync(fixture, { force: true });
    }
  });

  test.skipIf(!pnpmVersion || Number(pnpmVersion.split('.')[0]) < PNPM_MIN_MAJOR)('pnpm runs a script in a project that pins another pnpm version', async () => {
    const pinned = pnpmVersion === '10.0.0' ? '10.0.1' : '10.0.0';
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'probe', packageManager: `pnpm@${pinned}`, scripts: { hi: 'echo hi-ran' } }));
    expect(await run('pnpm run hi 2>&1')).toContain('hi-ran');
  });
});
