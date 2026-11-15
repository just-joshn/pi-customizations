import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import pstack, { modelsFile } from '../src/index.ts';
import { tmuxSocket } from '../src/jobs.ts';

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Tool = { execute: (id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown) => Promise<{ content: { text: string }[] }> };

const owner = `ext${process.pid}`;
let agentDir: string;
let repo: string;
let handlers: Record<string, Handler>;
let tools: Record<string, Tool>;
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
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-repo-')));
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
  const api = {
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
    ui: { setStatus: vi.fn() },
    cwd: repo,
    model: undefined,
    sessionManager: { getSessionId: () => owner },
    modelRegistry: { find: (provider: string, id: string) => (provider === 'prov' && id === 'model' ? {} : undefined) },
    isProjectTrusted: () => true,
  };
});

afterEach(async () => {
  await handlers['session_shutdown']?.({}, ctx);
  process.argv[1] = savedArgv;
  vi.unstubAllEnvs();
  try {
    execFileSync('tmux', ['-L', tmuxSocket(owner), 'kill-server'], { stdio: 'ignore' });
  } catch {
    // No server was started.
  }
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
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

  test('stop ends a running job, and list shows it stopped with its attach command', async () => {
    await call('tmux_run', { name: 'server', command: 'sleep 30' });
    const [id] = jobs();
    expect(await text({ action: 'list' })).toContain('running');
    await text({ action: 'stop', ids: [id] });
    const listing = await text({ action: 'list' });
    expect(listing).toContain('exited 143');
    expect(listing).toContain(`tmux -L ${tmuxSocket(owner)} attach -t ${id}`);
  });

  test('a job from another session is not visible', async () => {
    await call('tmux_run', { name: 'mine', command: 'true' });
    const [id] = jobs();
    ctx = { ...ctx, sessionManager: { getSessionId: () => 'someone-else' } };
    await expect(call('tmux_jobs', { action: 'output', ids: [id] })).rejects.toThrow(/No job/);
  });
});
