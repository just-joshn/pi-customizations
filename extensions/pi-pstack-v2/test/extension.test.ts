import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type ContainerPolicy, detectRuntime, mountsForPolicy } from '../src/container.ts';
import pstack, { modelsFile, serveRequests } from '../src/index.ts';
import { read, request, resultsDir, tmuxSocket } from '../src/jobs.ts';

// Without a container runtime a job cannot start, so the tests that run real processes need one. The rest build and
// check jobs against a stand-in runtime, which a launch never reaches, since a wrapper that finds none exits at once.
const unit = vi.hoisted(() => ({ live: false }));
vi.mock('../src/container.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/container.ts')>();
  try {
    actual.detectRuntime();
    unit.live = true;
  } catch {
    unit.live = false;
  }
  return {
    ...actual,
    detectRuntime: (...args: Parameters<typeof actual.detectRuntime>) => (unit.live ? actual.detectRuntime(...args) : { bin: 'docker' as const, image: 'pstack-test' }),
    ensureImage: (...args: Parameters<typeof actual.ensureImage>) => (unit.live ? actual.ensureImage(...args) : undefined),
  };
});
const liveTest = test.runIf(unit.live);
const liveDescribe = describe.runIf(unit.live);
/** Leftover job containers, by name, as the runtime lists them. */
const containers = (): string[] => {
  const { bin } = detectRuntime();
  const out = execFileSync(bin, bin === 'container' ? ['ls', '-a', '-q'] : ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' });
  return out.split('\n').filter((name) => name.startsWith('pstack-'));
};

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Tool = {
  description?: string;
  parameters?: { properties: Record<string, { description?: string }> };
  execute: (id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown) => Promise<{ content: { text: string }[] }>;
};

const owner = `ext${process.pid}`;
let agentDir: string;
let repo: string;
let handlers: Record<string, Handler>;
let tools: Record<string, Tool>;
let commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
let sendMessage: ReturnType<typeof vi.fn>;
let branch: { type: string; customType?: string; data?: unknown }[];
let ctx: Record<string, unknown>;
const savedArgv = process.argv[1] ?? '';

const jobs = () => {
  const root = join(agentDir, 'pstack-v2', 'jobs');
  return existsSync(root) ? readdirSync(root) : [];
};
const spec = (id: string) => JSON.parse(readFileSync(join(agentDir, 'pstack-v2', 'jobs', id, 'job.json'), 'utf8')) as { argv: string[]; command: string[]; policy: ContainerPolicy };
const wrapperEnv = (dir: string) => {
  const wrapper = readFileSync(join(dir, 'wrapper.sh'), 'utf8');
  const pick = (name: string) => new RegExp(`${name}=([^']*)'`).exec(wrapper)?.[1];
  return { job: pick('PSTACK_V2_JOB_DIR'), top: pick('PSTACK_V2_TOP_DIR') };
};
const jobsRoot = () => join(agentDir, 'pstack-v2', 'jobs');
/** The policy a worker writes in a request. The root reads only its writable paths, and works out the rest itself. */
const asked = (writable: string[], jobDir: string): ContainerPolicy => ({
  writable,
  protect: [],
  guardFiles: [],
  checkouts: [],
  gitDirs: [],
  agentDir,
  credsDir: '',
  jobDir,
  cwd: repo,
  name: 'pstack-asked',
  cidFile: '',
  readonly: false,
  network: 'default',
});
/** Serves a top-level job's requests as if it were still running, for a stand-in runtime whose top-level job exits at once. */
const serveNow = (topDir: string) => {
  const top = read(jobsRoot(), basename(topDir), owner);
  if (!top) throw new Error('top job missing');
  serveRequests(top, tmuxSocket(owner), join(topDir, 'nested'), false);
};
const call = (name: string, params: Record<string, unknown>) => tools[name]?.execute('call', params, undefined, undefined, ctx);

beforeEach(() => {
  agentDir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-agent-')));
  // Under home, not a temp directory, so a path outside the job's mounts is not under the temp directory the tests keep their own files in.
  repo = realpathSync(mkdtempSync(join(homedir(), '.pstack-repo-')));
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  vi.stubEnv('PSTACK_V2_CONTAINED', '');
  const fakePi = join(agentDir, 'fake-pi.mjs');
  writeFileSync(fakePi, "process.stdout.write('fake worker report\\n');\n");
  process.argv[1] = fakePi;
  handlers = {};
  tools = {};
  sendMessage = vi.fn();
  commands = {};
  branch = [];
  const api = {
    appendEntry: (customType: string, data?: unknown) => {
      branch.push({ type: 'custom', customType, data });
    },
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
  await handlers['session_shutdown']?.({}, ctx);
  process.argv[1] = savedArgv;
  vi.unstubAllEnvs();
  try {
    execFileSync('tmux', ['-S', tmuxSocket(owner), 'kill-server'], { stdio: 'ignore' });
  } catch {
    // No server was started.
  }
  rmSync(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('pi_spawn', { timeout: 20_000 }, () => {
  test('the agent parameter tells the model what each role is for', () => {
    const description = tools['pi_spawn']?.parameters?.properties['agent']?.description ?? '';
    expect(description).toContain('ci-watcher: Watch PR CI for the current branch');
    expect(description).toContain('comment-sicko: A deranged comment-hater');
  });

  test('the base parameter says it defaults to the session HEAD', () => {
    expect(tools['pi_spawn']?.parameters?.properties['base']?.description).toMatch(/current HEAD.*default branch/s);
  });

  test('an unknown model is rejected before any job is created', async () => {
    await expect(call('pi_spawn', { name: 'x', brief: 'hi', model: 'nope/none' })).rejects.toThrow(/Unavailable model "nope\/none"/);
    // The error lists the valid models, so a skill's fallback can pick from it.
    await expect(call('pi_spawn', { name: 'x', brief: 'hi', model: 'nope/none' })).rejects.toThrow(/Valid models: prov\/model\./);
    expect(jobs()).toEqual([]);
  });

  test('a model Pi knows but holds no credentials for is rejected like an unknown one', async () => {
    // Only a usable model passes, and any other fails at the call, which a skill's fallback relies on.
    await expect(call('pi_spawn', { name: 'x', brief: 'hi', model: 'prov/no-credentials', worktree: 'seat-1' })).rejects.toThrow(/Valid models: prov\/model\./);
    expect(jobs()).toEqual([]);
    expect(execFileSync('git', ['-C', repo, 'branch', '--list', 'seat-1'], { encoding: 'utf8' })).toBe('');
  });

  test('a bad worktree base leaves no job directory or worktree', async () => {
    await expect(call('pi_spawn', { name: 'x', brief: 'hi', worktree: 'probe', base: 'no-such-ref' })).rejects.toThrow(/invalid reference|not a valid object name/);
    expect(jobs()).toEqual([]);
    expect(execFileSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' }).trim().split('\n')).toHaveLength(1);
  });

  test('a readonly worker loses the edit and write tools and cannot write the checkout', async () => {
    await call('pi_spawn', { name: 'ro', brief: 'hi', readonly: true, model: 'prov/model', thinking: 'high' });
    const [id] = jobs();
    const argv = spec(id ?? '').argv;
    expect(argv).toEqual(expect.arrayContaining(['--exclude-tools', 'edit,write', '--model', 'prov/model', '--thinking', 'high', '--approve']));
    // The checkout is mounted read-only, and nothing in or around it is writable.
    const { policy } = spec(id ?? '');
    const mounts = mountsForPolicy(policy, []);
    expect(policy.readonly).toBe(true);
    expect(mounts).toContainEqual({ path: repo, readonly: true });
    expect(mounts.filter((mount) => !mount.readonly && (mount.path === repo || mount.path.startsWith(`${repo}/`)))).toEqual([]);
  });

  test('a worktree worker runs in a new branch checkout it may write', async () => {
    await call('pi_spawn', { name: 'wt', brief: 'hi', worktree: 'feature-x' });
    const [id] = jobs();
    const worktree = join(agentDir, 'pstack-v2', 'jobs', id ?? '', 'worktree');
    expect(execFileSync('git', ['-C', worktree, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('feature-x');
    const { policy } = spec(id ?? '');
    const mounts = mountsForPolicy(policy, []);
    expect(policy.cwd).toBe(worktree);
    expect(mounts).toContainEqual({ path: worktree, readonly: false });
    // The job writes its own worktree's git directory inside the read-only worktrees directory, and the checkout it branched from not at all.
    const own = execFileSync('git', ['-C', worktree, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
    expect(mounts).toEqual(
      expect.arrayContaining([
        { path: join(repo, '.git', 'worktrees'), readonly: true },
        { path: own, readonly: false },
      ]),
    );
    expect(mounts.findIndex((mount) => mount.path === own)).toBeGreaterThan(mounts.findIndex((mount) => mount.path === join(repo, '.git', 'worktrees')));
    expect(mounts.filter((mount) => !mount.readonly && mount.path === repo)).toEqual([]);
  });

  liveTest('a print-mode run waits for its workers and continues with their reports', async () => {
    ctx = { ...ctx, mode: 'print', hasUI: false };
    await call('pi_spawn', { name: 'w', brief: 'hi' });
    const result = (await handlers['agent_before_settle']?.({ entries: [] }, ctx)) as { entries: { content: string }[]; continue: boolean };
    expect(result.continue).toBe(true);
    expect(result.entries.map((entry) => entry.content).join('\n')).toContain('fake worker report');
  });
});

describe('pi_spawn resume and reports', { timeout: 20_000 }, () => {
  const finished = async (id: string) => {
    await expect.poll(() => read(jobsRoot(), id, owner)?.status.state, { timeout: 10_000 }).toBe('exited');
  };

  test('a resumed worker keeps its model, thinking, role, and readonly unless the call overrides them', async () => {
    await call('pi_spawn', { name: 'first', brief: 'one', agent: 'ci-watcher', readonly: true, model: 'prov/model', thinking: 'high' });
    const [first = ''] = jobs();
    await finished(first);
    await call('pi_spawn', { name: 'second', brief: 'two', resume: first });
    const second = jobs().find((id) => id !== first) ?? '';
    const resumed = spec(second);
    expect(resumed.command).toEqual(expect.arrayContaining(['--continue', '--model', 'prov/model', '--thinking', 'high', '--exclude-tools', 'edit,write', '--append-system-prompt', join(jobsRoot(), second, 'agent.md')]));
    expect(readFileSync(join(jobsRoot(), second, 'agent.md'), 'utf8')).toBe(readFileSync(join(jobsRoot(), first, 'agent.md'), 'utf8'));
    await finished(second);
    await call('pi_spawn', { name: 'third', brief: 'three', resume: second, thinking: 'low', readonly: false });
    const third = spec(jobs().find((id) => id !== first && id !== second) ?? '');
    expect(third.command).toEqual(expect.arrayContaining(['--thinking', 'low', '--model', 'prov/model']));
    expect(third.command).not.toContain('--exclude-tools');
    expect(third.command).toEqual(expect.arrayContaining(['--session-dir', join(jobsRoot(), first, 'session')]));
  });

  liveTest('a long report keeps the verdict at its head and the end of the output, without splitting a character', async () => {
    writeFileSync(process.argv[1] ?? '', "process.stdout.write('PASS verdict\\n' + '€'.repeat(20000) + 'END');\n");
    await call('pi_spawn', { name: 'long', brief: 'hi' });
    const [id = ''] = jobs();
    const report = (await call('tmux_jobs', { action: 'wait', ids: [id], timeout_seconds: 10 }))?.content[0]?.text ?? '';
    const body = /<output>\n([\s\S]*)\n<\/output>/.exec(report)?.[1] ?? '';
    expect(body.startsWith('PASS verdict')).toBe(true);
    expect(body.endsWith('END')).toBe(true);
    expect(body).toMatch(/\[\.\.\. \d+ bytes omitted, full output at .*output\.log \.\.\.\]/);
    expect(body).not.toContain('\uFFFD');
  });
});

describe('launch paths and the nesting limit', { timeout: 20_000 }, () => {
  test('a root pi_spawn and tmux_run each run as their own top-level job', async () => {
    await call('pi_spawn', { name: 'w', brief: 'hi' });
    await call('tmux_run', { name: 'c', command: 'true' });
    expect(jobs()).toHaveLength(2);
    for (const id of jobs()) {
      const { job, top } = wrapperEnv(join(jobsRoot(), id));
      expect([job, top]).toEqual([join(jobsRoot(), id), join(jobsRoot(), id)]);
    }
  });
});

describe('who may start workers', () => {
  const registered = (jobDir: string, topDir: string) => {
    vi.stubEnv('PSTACK_V2_CONTAINED', '1');
    vi.stubEnv('PSTACK_V2_JOB_DIR', jobDir);
    vi.stubEnv('PSTACK_V2_TOP_DIR', topDir);
    const names: string[] = [];
    pstack({ registerCommand: () => {}, on: () => {}, registerTool: (tool: { name: string }) => names.push(tool.name), sendMessage } as unknown as ExtensionAPI);
    return names;
  };

  test('a worker the root started can start workers', () => {
    expect(registered(join(agentDir, 'top'), join(agentDir, 'top'))).toContain('pi_spawn');
  });

  test('a worker started by another worker cannot, but can still run commands', () => {
    expect(registered(join(agentDir, 'top', 'nested', 'child'), join(agentDir, 'top'))).toEqual(expect.arrayContaining(['tmux_run', 'tmux_jobs']));
    expect(registered(join(agentDir, 'top', 'nested', 'child'), join(agentDir, 'top'))).not.toContain('pi_spawn');
  });
});

describe('tmux_run', { timeout: 20_000 }, () => {
  liveTest('an interactive session is woken once with the wake message and output, between tool calls rather than after its whole run', async () => {
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'echo', command: 'echo watched-output', wake: 'Re-check CI.' });
    await expect.poll(() => sendMessage.mock.calls.length, { timeout: 10_000 }).toBe(1);
    const [message, options] = sendMessage.mock.calls[0] ?? [];
    expect(message.content).toContain('Re-check CI.');
    expect(message.content).toContain('watched-output');
    expect(options).toEqual({ triggerTurn: true, deliverAs: 'steer' });
  });

  test('a directory outside the project is refused', async () => {
    await expect(call('tmux_run', { name: 'out', command: 'true', cwd: '/' })).rejects.toThrow(/inside this project/);
    await expect(call('pi_spawn', { name: 'out', brief: 'hi', cwd: '..' })).rejects.toThrow(/inside this project.*pass worktree/s);
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
      await expect(call('pi_spawn', { name: 'foreign', brief: 'hi', cwd: planted })).rejects.toThrow(/another repository/);
      expect(jobs()).toEqual([]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  liveTest('a failing heartbeat wakes once and is not restarted', async () => {
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'tick', command: 'exit 1', wake: 'Tick.', repeat: true });
    await expect.poll(() => sendMessage.mock.calls.length, { timeout: 10_000 }).toBe(1);
    expect(sendMessage.mock.calls[0]?.[0].content).toContain('not restarted');
    expect(jobs()).toHaveLength(1);
  });

  liveTest('stopping a heartbeat by its first id stops the later runs too', async () => {
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

  test('/pstack-mode keeps a skill in the system prompt every turn until it is turned off', async () => {
    expect(await prompt()).toBeUndefined();
    await commands['pstack-mode']?.handler('poteto-mode', ctx);
    const section = await prompt();
    expect(section).toContain('<skill name="poteto-mode"');
    expect(section).toContain('# Poteto mode');
    expect(section).toContain('/pstack-mode off');
    expect(await prompt()).toBe(section);
    expect((ctx['ui'] as { setStatus: ReturnType<typeof vi.fn> }).setStatus).toHaveBeenLastCalledWith('pstack-mode', 'mode: poteto-mode');
    await commands['pstack-mode']?.handler('off', ctx);
    expect(await prompt()).toBeUndefined();
    expect((ctx['ui'] as { setStatus: ReturnType<typeof vi.fn> }).setStatus).toHaveBeenLastCalledWith('pstack-mode', undefined);
  });

  test('the mode comes back from the session branch when the session starts or the branch changes', async () => {
    branch.push({ type: 'custom', customType: 'pstack-mode', data: { skill: 'how' } });
    await handlers['session_start']?.({}, ctx);
    expect(await prompt()).toContain('<skill name="how"');
    branch.length = 0;
    await handlers['session_tree']?.({}, ctx);
    expect(await prompt()).toBeUndefined();
  });

  test('/pstack-mode refuses a name that is not a pstack skill and keeps the current mode', async () => {
    await commands['pstack-mode']?.handler('poteto-mode', ctx);
    await commands['pstack-mode']?.handler('../../etc', ctx);
    expect(await prompt()).toContain('<skill name="poteto-mode"');
    expect((ctx['ui'] as { notify: ReturnType<typeof vi.fn> }).notify).toHaveBeenLastCalledWith(expect.stringContaining('not a pstack skill'), 'error');
  });

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
    const skills = event.systemPromptOptions.promptGuidelines.filter((rule) => rule.includes('/<name>/SKILL.md'));
    expect(skills).toHaveLength(1);
    expect(skills[0]).toContain(join(dirname(dirname(fileURLToPath(import.meta.url))), 'skills'));
    expect(skills[0]).toMatch(/read that file and follow it/);
  });

  test("names this session's transcript, since a worker's agent directory is its job's and holds no parent session", async () => {
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, { ...ctx, sessionManager: { getSessionId: () => owner, getSessionFile: () => '/sessions/run.jsonl' } });
    expect(event.systemPromptOptions.sections['pstack-session']).toContain('/sessions/run.jsonl');
    const ephemeral = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(ephemeral, { ...ctx, sessionManager: { getSessionId: () => owner, getSessionFile: () => undefined } });
    expect(ephemeral.systemPromptOptions.sections['pstack-session']).toBeUndefined();
  });
});

describe('container guidance', () => {
  const noteFor = async (): Promise<string | undefined> => {
    const event = { systemPromptOptions: { promptGuidelines: [] as string[], sections: {} as Record<string, string> } };
    await handlers['before_agent_start']?.(event, ctx);
    return event.systemPromptOptions.sections['pstack-container'];
  };

  test('a worker is told the root filesystem is read-only, /tmp is private and lost, and its own temp directory is $TMPDIR', async () => {
    vi.stubEnv('PSTACK_V2_CONTAINED', '1');
    expect(await noteFor()).toMatch(/read-only root filesystem.*\/tmp is a small private tmpfs.*\$TMPDIR/s);
  });

  test('the root session gets no container section, since its own shell is not in a container', async () => {
    expect(await noteFor()).toBeUndefined();
  });

  test('tmux_run tells the model its command must keep temp files in $TMPDIR', () => {
    expect(tools['tmux_run']?.description).toMatch(/\/tmp is small, private, and lost.*\$TMPDIR/s);
  });

  test('a worker is told which host tools and the home directory are not there', async () => {
    vi.stubEnv('PSTACK_V2_CONTAINED', '1');
    expect(await noteFor()).toMatch(/Xcode, simulators, `open`.*host \$HOME/s);
  });

  test('a worker is told why SSH pushes and config writes fail, so it does not retry them', async () => {
    vi.stubEnv('PSTACK_V2_CONTAINED', '1');
    const note = await noteFor();
    expect(note).toMatch(/Unix sockets.*ssh-agent.*HTTPS remote/s);
    expect(note).toMatch(/\.git\/hooks.*\.vscode.*\.claude.*quarantine/s);
  });

  test('pi_spawn tells the model a worker has a private /tmp, so a brief names $TMPDIR', () => {
    expect(tools['pi_spawn']?.description).toMatch(/isolated Linux container.*\/tmp is small, private, and lost.*\$TMPDIR/s);
  });
});

liveDescribe('tmux_jobs', { timeout: 20_000 }, () => {
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

  test('wait with no ids skips servers started without a wake, which never exit on their own', async () => {
    await call('tmux_run', { name: 'server', command: 'sleep 30' });
    await call('tmux_run', { name: 'build', command: 'echo built-output', wake: 'Built.' });
    const started = Date.now();
    const report = await text({ action: 'wait', timeout_seconds: 15 });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(report).toContain('built-output');
    expect(report).not.toContain('still running');
  });

  test('wait hands the turn back as soon as the user sends a message', async () => {
    await call('tmux_run', { name: 'slow', command: 'sleep 30', wake: 'Slow.' });
    ctx = { ...ctx, hasPendingMessages: () => true };
    const started = Date.now();
    const report = await text({ action: 'wait', timeout_seconds: 15 });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(report).toContain('still running');
  });

  test('wait without a timeout hands the turn back after five minutes, not thirty', async () => {
    await call('tmux_run', { name: 'slow', command: 'sleep 600', wake: 'Slow.' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      const waiting = text({ action: 'wait' });
      await vi.advanceTimersByTimeAsync(301_000);
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
  const nestedRequest = (topDir: string, name: string, writable: string[], command: string, kind: 'pi' | 'command' = 'command', nested = join(topDir, 'nested')) => {
    const id = `${name}-000001`;
    vi.stubEnv('PSTACK_V2_TOP_DIR', topDir);
    request(nested, {
      id,
      name,
      kind,
      cwd: repo,
      argv: [],
      command: ['bash', '-c', command],
      policy: asked(writable, join(nested, id)),
      brokered: true,
      owner: 'top-worker',
      wake: 'done',
      repeat: false,
      series: id,
      socket: '',
      sweep: { roots: [], protect: [], guardFiles: [] },
      out: '',
      createdAt: new Date().toISOString(),
    });
    return resultsDir(topDir, join(nested, id));
  };
  const exitOf = (out: string) => (existsSync(join(out, 'exit')) ? readFileSync(join(out, 'exit'), 'utf8').trim() : undefined);

  liveTest('the root launches a contained worker request inside what it granted', async () => {
    const top = await topJob();
    const dir = nestedRequest(top.dir, 'inner', [repo], `touch ${repo}/brokered.txt`);
    await expect.poll(() => exitOf(dir), { timeout: 10_000 }).toBe('0');
    expect(existsSync(join(repo, 'brokered.txt'))).toBe(true);
    const requestDir = join(top.dir, 'nested', 'inner-000001');
    expect(wrapperEnv(dir)).toEqual({ job: requestDir, top: top.dir });
  });

  test('the root refuses a request that writes outside what it granted', async () => {
    const top = await topJob();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-outside-')));
    const dir = nestedRequest(top.dir, 'greedy', [outside], `touch ${outside}/escaped.txt`);
    serveNow(top.dir);
    await expect.poll(() => exitOf(dir), { timeout: 10_000 }).toBe('126');
    expect(readFileSync(join(dir, 'output.log'), 'utf8')).toContain('refused');
    expect(existsSync(join(outside, 'escaped.txt'))).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  liveTest('a request is launched under its own narrower container', async () => {
    const top = await topJob();
    expect(top.granted.policy.writable).toEqual(expect.arrayContaining([repo]));
    const dir = nestedRequest(top.dir, 'narrow', [join(top.dir, 'nested')], `touch ${repo}/narrow.txt`);
    await expect.poll(() => exitOf(dir), { timeout: 10_000 }).toBe('1');
    expect(existsSync(join(repo, 'narrow.txt'))).toBe(false);
  });

  liveTest('the root never writes through links a worker plants in its request', async () => {
    const top = await topJob();
    const victim = join(repo, 'victim.txt');
    writeFileSync(victim, 'original\n');
    const out = nestedRequest(top.dir, 'linky', [join(top.dir, 'nested')], 'echo attacker-bytes');
    const requestDir = join(top.dir, 'nested', 'linky-000001');
    for (const name of ['output.log', 'exit', 'launched', 'stderr.log']) symlinkSync(victim, join(requestDir, name));
    await expect.poll(() => exitOf(out), { timeout: 10_000 }).toBe('0');
    expect(readFileSync(victim, 'utf8')).toBe('original\n');
  });

  liveTest('a worker started by another worker cannot get a Pi worker launched, but can get a command launched', async () => {
    const top = await topJob();
    nestedRequest(top.dir, 'child', [join(top.dir, 'nested')], 'sleep 20');
    const grandchildNested = join(top.dir, 'nested', 'child-000001', 'nested');
    await expect.poll(() => existsSync(join(resultsDir(top.dir, join(top.dir, 'nested', 'child-000001')), 'launched')), { timeout: 10_000 }).toBe(true);
    const pi = nestedRequest(top.dir, 'grandchild', [grandchildNested], 'true', 'pi', grandchildNested);
    const command = nestedRequest(top.dir, 'tick', [grandchildNested], 'true', 'command', grandchildNested);
    await expect.poll(() => exitOf(pi), { timeout: 10_000 }).toBe('126');
    expect(readFileSync(join(pi, 'output.log'), 'utf8')).toContain('cannot start workers of its own');
    await expect.poll(() => exitOf(command), { timeout: 10_000 }).toBe('0');
  });

  liveTest('the root ignores a temp directory a worker names outside what it may write', async () => {
    const top = await topJob();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-outside-')));
    const out = nestedRequest(top.dir, 'tmpgrab', [join(top.dir, 'nested')], 'echo x > "$TMPDIR/own"');
    const job = join(top.dir, 'nested', 'tmpgrab-000001', 'job.json');
    writeFileSync(job, JSON.stringify({ ...JSON.parse(readFileSync(job, 'utf8')), tmp: outside }));
    await expect.poll(() => exitOf(out), { timeout: 10_000 }).toBe('0');
    expect(readdirSync(outside)).toEqual([]);
    rmSync(outside, { recursive: true, force: true });
  });

  test('a malformed request does not stop the next one', async () => {
    const top = await topJob();
    mkdirSync(join(top.dir, 'nested', 'aaa-broken'), { recursive: true });
    writeFileSync(join(top.dir, 'nested', 'aaa-broken', 'job.json'), JSON.stringify({ brokered: true, kind: 'command', cwd: repo, command: ['true'], policy: { writable: [1] } }));
    const out = nestedRequest(top.dir, 'zzz-next', [join(tmpdir(), 'pstack-nowhere')], 'true');
    serveNow(top.dir);
    expect(exitOf(out)).toBe('126');
  });

  test('a request for a mount outside what it was granted is refused before any container starts', async () => {
    const top = await topJob();
    const out = nestedRequest(top.dir, 'sneaky', [join(top.dir, 'nested', 'sneaky-000001', 'session'), join(repo, '..')], 'true');
    serveNow(top.dir);
    expect(exitOf(out)).toBe('126');
    expect(existsSync(join(out, 'cid'))).toBe(false);
  });

  test('a sandboxed worker writes a request instead of launching', async () => {
    vi.stubEnv('PSTACK_V2_CONTAINED', '1');
    vi.stubEnv('PSTACK_V2_JOB_DIR', join(agentDir, 'fake-worker'));
    vi.stubEnv('PSTACK_V2_TOP_DIR', join(agentDir, 'fake-worker'));
    await call('tmux_run', { name: 'asked', command: 'true' });
    const nested = join(agentDir, 'fake-worker', 'nested');
    const [id] = readdirSync(nested);
    const asked = JSON.parse(readFileSync(join(nested, id ?? '', 'job.json'), 'utf8')) as { brokered: boolean; argv: string[] };
    expect([asked.brokered, asked.argv]).toEqual([true, []]);
    expect(existsSync(join(nested, id ?? '', 'launched'))).toBe(false);
  });

  const workerWorktreeSpawn = async (params: Record<string, unknown>, edit: (job: Record<string, unknown>, requestDir: string) => void = () => {}) => {
    const top = await topJob();
    const child = join(agentDir, 'committer-pi.mjs');
    writeFileSync(
      child,
      `import { execFileSync } from 'node:child_process';
      import fs from 'node:fs';
      fs.writeFileSync('from-child.txt', 'x');
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'from-child.txt']);
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'child']);\n`,
    );
    process.argv[1] = child;
    const metadata = join(repo, '.git', 'worktrees');
    mkdirSync(metadata, { recursive: true });
    chmodSync(metadata, 0o555);
    vi.stubEnv('PSTACK_V2_CONTAINED', '1');
    vi.stubEnv('PSTACK_V2_JOB_DIR', top.dir);
    vi.stubEnv('PSTACK_V2_TOP_DIR', top.dir);
    let made: { requestDir: string; text: string };
    try {
      const result = await call('pi_spawn', { name: 'adversary', brief: 'hi', worktree: 'interrogate-slug-1', base: 'HEAD', ...params });
      const [id] = readdirSync(join(top.dir, 'nested'));
      const requestDir = join(top.dir, 'nested', id ?? '');
      const job = JSON.parse(readFileSync(join(requestDir, 'job.json'), 'utf8')) as Record<string, unknown>;
      edit(job, requestDir);
      writeFileSync(join(requestDir, 'job.json'), JSON.stringify(job));
      made = { requestDir, text: result?.content[0]?.text ?? '' };
    } finally {
      vi.stubEnv('PSTACK_V2_CONTAINED', '');
      chmodSync(metadata, 0o755);
    }
    // The watcher serves a running top-level job. A stand-in runtime ends it at once, so the request is served here.
    if (!unit.live) serveNow(top.dir);
    return { out: resultsDir(top.dir, made.requestDir), text: made.text };
  };
  const branches = (cwd: string) => execFileSync('git', ['-C', cwd, 'branch', '--format=%(refname:short)'], { encoding: 'utf8' }).trim().split('\n');
  const worktrees = (cwd: string) => execFileSync('git', ['-C', cwd, 'worktree', 'list'], { encoding: 'utf8' }).trim().split('\n');

  liveTest("a worker's pi_spawn with a worktree gets a checkout on that branch its job may write", async () => {
    const { out, text } = await workerWorktreeSpawn({});
    const worktree = join(out, 'worktree');
    expect(text).toContain(`cwd: ${worktree}`);
    await expect.poll(() => exitOf(out), { timeout: 10_000 }).toBe('0');
    expect(execFileSync('git', ['-C', worktree, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('interrogate-slug-1');
    expect(execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s', 'interrogate-slug-1'], { encoding: 'utf8' }).trim()).toBe('child');
  });

  liveTest("a readonly worker's worktree is created but its job cannot write it", async () => {
    const { out } = await workerWorktreeSpawn({ readonly: true });
    await expect.poll(() => exitOf(out), { timeout: 10_000 }).toBe('1');
    expect(execFileSync('git', ['-C', join(out, 'worktree'), 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('interrogate-slug-1');
    expect(existsSync(join(out, 'worktree', 'from-child.txt'))).toBe(false);
  });

  test('a worktree request naming its own request directory, where the worker could swap in a link, is refused and leaves no worktree or branch', async () => {
    const { out } = await workerWorktreeSpawn({}, (job, requestDir) => {
      job['cwd'] = join(requestDir, 'worktree');
    });
    await expect.poll(() => exitOf(out), { timeout: 10_000 }).toBe('126');
    expect(readFileSync(join(out, 'output.log'), 'utf8')).toContain('refused');
    expect([branches(repo).includes('interrogate-slug-1'), worktrees(repo).length]).toEqual([false, 1]);
  });

  test('a worktree request naming another repository is refused and leaves no worktree or branch in either', async () => {
    const other = realpathSync(mkdtempSync(join(homedir(), '.pstack-other-')));
    execFileSync('git', ['init', '-q', other]);
    execFileSync('git', ['-C', other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    try {
      const { out } = await workerWorktreeSpawn({}, (job) => {
        job['cwd'] = other;
        job['policy'] = { ...(job['policy'] as object), writable: [other, join(other, '.git')] };
      });
      await expect.poll(() => exitOf(out), { timeout: 10_000 }).toBe('126');
      expect(readFileSync(join(out, 'output.log'), 'utf8')).toContain('refused');
      for (const checkout of [repo, other]) expect([branches(checkout).includes('interrogate-slug-1'), worktrees(checkout).length]).toEqual([false, 1]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
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
    policy: asked([repo], join(top.dir, 'nested', reqId)),
    brokered: true,
    owner: 'w',
    wake: null,
    repeat: false,
    series: reqId,
    socket: '',
    sweep: { roots: [], protect: [], guardFiles: [] },
    out: '',
    createdAt: '',
  });
  serveRequests(top, tmuxSocket(owner), join(top.dir, 'nested'), true);
  expect(existsSync(join(resultsDir(top.dir, join(top.dir, 'nested', reqId)), 'launched'))).toBe(false);
});

liveDescribe('git cannot be repointed at planted hooks', { timeout: 20_000 }, () => {
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

  // Open gap, measured on Apple container 1.7.1 (design probe 5): a directory that only holds mounts can be renamed, so a job
  // can move `.git` aside and move a repository it built into its place. The container no longer locks the parent, as
  // Seatbelt and bubblewrap did, and the sweep keeps no record of which directory was the original.
  test.todo('a job in the main checkout cannot swap out its .git directory');
});

liveDescribe('cleanup a job cannot dodge', { timeout: 20_000 }, () => {
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

  test('stopping a job ends its container and still removes what it planted', async () => {
    await call('tmux_run', { name: 'planter', command: 'mkdir -p built/extensions && echo planted > built/extensions/x.ts && mv built .pi && sleep 30 & echo $! > sleeper.pid; wait' });
    const [id] = jobs();
    await expect.poll(() => existsSync(join(repo, 'sleeper.pid')) && existsSync(join(repo, '.pi', 'extensions', 'x.ts')), { timeout: 10_000 }).toBe(true);
    expect(containers()).toContain(`pstack-${id}`);
    await call('tmux_jobs', { action: 'stop', ids: [id] });
    await expect.poll(() => existsSync(join(repo, '.pi', 'extensions')), { timeout: 10_000 }).toBe(false);
    await expect.poll(containers, { timeout: 10_000 }).not.toContain(`pstack-${id}`);
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

liveDescribe('round five', { timeout: 20_000 }, () => {
  const exited = async () => expect.poll(() => existsSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
  const output = () => readFileSync(join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '', 'output.log'), 'utf8');

  test('a job cannot write the shared temp directories of the host, where uncontained programs cache code, but has its own', async () => {
    const shared = process.platform === 'darwin' ? realpathSync(tmpdir()) : '/tmp';
    await call('tmux_run', { name: 'tmp', command: `touch ${shared}/pstack-shared-${process.pid} 2>/dev/null && echo SHARED-WRITTEN; touch "$TMPDIR/own" && echo OWN-WRITTEN` });
    await exited();
    // The container's own /tmp is private, so what matters is that the host's shared one is untouched.
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

liveTest('a worker that fails at startup reports its stderr', { timeout: 20_000 }, async () => {
  const failing = join(agentDir, 'failing-pi.mjs');
  writeFileSync(failing, "process.stderr.write('No API key for provider\\n'); process.exit(1);\n");
  process.argv[1] = failing;
  ctx = { ...ctx, mode: 'print', hasUI: false };
  await call('pi_spawn', { name: 'broken', brief: 'hi' });
  const result = (await handlers['agent_before_settle']?.({ entries: [] }, ctx)) as { entries: { content: string }[] };
  expect(result.entries[0]?.content).toContain('No API key for provider');
});

test('a job may not write a directory that holds Pi itself', async () => {
  ctx = { ...ctx, cwd: dirname(agentDir) };
  await expect(call('tmux_run', { name: 'home', command: 'true' })).rejects.toThrow(/contains Pi's agent directory/);
});

liveDescribe('round four', { timeout: 20_000 }, () => {
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

  test('a job cannot signal a process outside its container, such as the wrapper or Pi', async () => {
    const outside = spawn('sleep', ['30'], { stdio: 'ignore' });
    await call('tmux_run', { name: 'killer', command: `kill -0 ${outside.pid} 2>/dev/null && echo SIGNALED || echo DENIED` });
    await exited();
    expect([readFileSync(join(jobDir(), 'output.log'), 'utf8').trim(), alive(outside.pid ?? 0)]).toEqual(['DENIED', true]);
    outside.kill();
  });

  test('a job that ignores TERM is still ended by stop, and its container is gone', async () => {
    await call('tmux_run', { name: 'stubborn', command: "trap '' TERM; touch ready; while :; do sleep 0.2; done" });
    const [id = ''] = jobs();
    await expect.poll(() => existsSync(join(repo, 'ready')), { timeout: 10_000 }).toBe(true);
    await call('tmux_jobs', { action: 'stop', ids: [id] });
    await expect.poll(containers, { timeout: 10_000 }).not.toContain(`pstack-${id}`);
  });

  test('a child left running when the job exits goes with its container', async () => {
    await call('tmux_run', { name: 'leaver', command: '(sleep 30) & exit 0' });
    const [id = ''] = jobs();
    await exited();
    await expect.poll(containers, { timeout: 10_000 }).not.toContain(`pstack-${id}`);
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

  // Open gap, like swapping .git: a directory that only holds mounts can be renamed away and a built one moved in.
  test.todo('an existing .pi cannot be renamed away and replaced with new extensions');

  liveTest('Pi code planted in a subdirectory .pi does not survive the job', async () => {
    await call('tmux_run', { name: 'deep', command: 'mkdir -p pkg/.pi/extensions; echo evil > pkg/.pi/extensions/x.ts; mkdir -p built/.pi/extensions && echo evil > built/.pi/extensions/y.ts && mv built pkg2' });
    await exited();
    expect([existsSync(join(repo, 'pkg', '.pi', 'extensions', 'x.ts')), existsSync(join(repo, 'pkg2', '.pi', 'extensions', 'y.ts'))]).toEqual([false, false]);
  });

  liveTest('a git pointer file is neither repointed nor planted', async () => {
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(repo, 'sub', '.git'), 'gitdir: ../.git/modules/sub\n');
    await call('tmux_run', { name: 'pointer', command: 'echo "gitdir: /tmp/evil" > sub/.git; mkdir -p built && echo "gitdir: /tmp/evil" > built/.git && mv built sub2' });
    await exited();
    expect([readFileSync(join(repo, 'sub', '.git'), 'utf8'), existsSync(join(repo, 'sub2', '.git'))]).toEqual(['gitdir: ../.git/modules/sub\n', false]);
  });

  liveTest('a job cannot connect to a local service socket', async () => {
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
      writeFileSync(join(top.dir, 'nested', name, 'job.json'), JSON.stringify({ brokered: true, kind: 'command', cwd: repo, command: ['true'], policy: { writable: [], protect: [], gitDirs: [] } }));
      symlinkSync(join(top.dir, 'nested'), join(top.dir, 'nested', name, 'nested'));
    }
    const started = Date.now();
    serveRequests(top, tmuxSocket(owner), join(top.dir, 'nested'), true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

liveDescribe('a sweep a job cannot switch off', { timeout: 20_000 }, () => {
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

liveDescribe('interrogate round', { timeout: 30_000 }, () => {
  const jobsRoot = () => join(agentDir, 'pstack-v2', 'jobs');
  const exitIn = (out: string) => (existsSync(join(out, 'exit')) ? readFileSync(join(out, 'exit'), 'utf8').trim() : undefined);

  test('a readonly worker cannot hand its own nested job more than it was granted', async () => {
    const slowPi = join(agentDir, 'slow-pi.mjs');
    writeFileSync(slowPi, 'setTimeout(() => {}, 60_000);\n');
    process.argv[1] = slowPi;
    ctx = { ...ctx, mode: 'print', hasUI: false };
    await handlers['session_start']?.({}, ctx);
    await call('pi_spawn', { name: 'writer', brief: 'hi', wake: false });
    const top = read(jobsRoot(), jobs()[0] ?? '', owner);
    if (!top) throw new Error('top job missing');
    const brokered = (dir: string, id: string, writable: string[], command: string) => {
      vi.stubEnv('PSTACK_V2_TOP_DIR', top.dir);
      request(dir, {
        id,
        name: id,
        kind: 'command',
        cwd: repo,
        argv: [],
        command: ['bash', '-c', command],
        policy: asked(writable, join(dir, id)),
        brokered: true,
        owner: 'w',
        wake: null,
        repeat: false,
        series: id,
        socket: '',
        sweep: { roots: [], protect: [], guardFiles: [] },
        out: '',
        createdAt: '',
      });
      return join(dir, id);
    };
    const readonlyWorker = brokered(join(top.dir, 'nested'), 'readonly-000001', [join(top.dir, 'nested', 'readonly-000001', 'nested')], 'sleep 60');
    await expect.poll(() => existsSync(join(resultsDir(top.dir, readonlyWorker), 'launched')), { timeout: 10_000 }).toBe(true);
    const forged = brokered(join(readonlyWorker, 'nested'), 'forged-000001', [repo], `touch ${repo}/PWNED`);
    await expect.poll(() => exitIn(resultsDir(top.dir, forged)), { timeout: 10_000 }).toBeDefined();
    expect(existsSync(join(repo, 'PWNED'))).toBe(false);
  });

  test('a job cannot write your credentials at all', async () => {
    const auth = join(agentDir, 'auth.json');
    writeFileSync(auth, JSON.stringify({ plain: { type: 'api_key', key: 'sk-x' } }));
    await call('tmux_run', { name: 'plant', command: `printf '{"evil":{"type":"api_key","key":"!touch /tmp/pwned"}}' > ${auth}; echo rc=$?` });
    await expect.poll(() => existsSync(join(jobsRoot(), jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
    expect(JSON.parse(readFileSync(auth, 'utf8'))).toEqual({ plain: { type: 'api_key', key: 'sk-x' } });
  });

  test('Pi code a worker plants in its worktree is swept', async () => {
    const planter = join(agentDir, 'planter-pi.mjs');
    writeFileSync(
      planter,
      `
        import fs from 'node:fs';
        fs.mkdirSync('sub/.pix/extensions', { recursive: true });
        fs.writeFileSync('sub/.pix/extensions/evil.ts', 'x');
        fs.renameSync('sub/.pix', 'sub/.pi');
        console.log('planted');
      `,
    );
    process.argv[1] = planter;
    await call('pi_spawn', { name: 'wt', brief: 'hi', worktree: 'plant-branch' });
    const dir = join(jobsRoot(), jobs()[0] ?? '');
    await expect.poll(() => existsSync(join(dir, 'exit')), { timeout: 10_000 }).toBe(true);
    expect(existsSync(join(dir, 'worktree', 'sub', '.pi', 'extensions', 'evil.ts'))).toBe(false);
  });

  test('Pi code planted very deep is swept', async () => {
    const deep = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o';
    await call('tmux_run', { name: 'deep', command: `mkdir -p ${deep}/.pix/extensions && echo x > ${deep}/.pix/extensions/evil.ts && mv ${deep}/.pix ${deep}/.pi` });
    await expect.poll(() => existsSync(join(jobsRoot(), jobs()[0] ?? '', 'exit')), { timeout: 10_000 }).toBe(true);
    expect(existsSync(join(repo, deep, '.pi', 'extensions', 'evil.ts'))).toBe(false);
  });
});

liveDescribe('a job agent directory', { timeout: 20_000 }, () => {
  test('lets a job keep the shared credentials current and use its own agent directory, but not change your real one', async () => {
    writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ plain: { type: 'api_key', key: 'sk-x' } }));
    mkdirSync(join(agentDir, 'extensions'));
    await call('tmux_run', {
      name: 'agent',
      command: `cd "$PI_CODING_AGENT_DIR" && echo '{"plain":{"type":"api_key","key":"sk-y"}}' > auth.json && mkdir "$(dirname "$(readlink auth.json)")/auth.json.lock" && rmdir "$(dirname "$(readlink auth.json)")/auth.json.lock" && echo COPY-OK; echo own > own.txt && echo OWN-OK; echo evil > ${agentDir}/extensions/e.ts 2>/dev/null && echo REAL-PLANTED; echo '{}' > ${agentDir}/settings.json 2>/dev/null && echo SETTINGS-WRITTEN`,
    });
    const dir = join(agentDir, 'pstack-v2', 'jobs', jobs()[0] ?? '');
    await expect.poll(() => existsSync(join(dir, 'exit')), { timeout: 10_000 }).toBe(true);
    const output = readFileSync(join(dir, 'output.log'), 'utf8');
    expect(output).toContain('COPY-OK');
    expect(output).toContain('OWN-OK');
    expect(output).not.toMatch(/REAL-PLANTED|SETTINGS-WRITTEN/);
    expect(JSON.parse(readFileSync(join(dir, 'agent', 'creds', 'auth.json'), 'utf8'))).toEqual({ plain: { type: 'api_key', key: 'sk-y' } });
    expect([existsSync(join(agentDir, 'extensions', 'e.ts')), existsSync(join(agentDir, 'settings.json')), JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf8')).plain.key]).toEqual([false, false, 'sk-x']);
  });
});

describe('workers and the jobs they start', { timeout: 30_000 }, () => {
  const exitOf = (dir: string) => (existsSync(join(dir, 'exit')) ? readFileSync(join(dir, 'exit'), 'utf8').trim() : undefined);

  liveTest('a print-mode worker hears about a finished job while it works', async () => {
    ctx = { ...ctx, mode: 'print', hasUI: false, isIdle: () => false };
    await handlers['session_start']?.({}, ctx);
    await call('tmux_run', { name: 'probe', command: 'echo probe-output', wake: 'Probe done.' });
    await expect.poll(() => sendMessage.mock.calls.length, { timeout: 10_000 }).toBe(1);
    expect(sendMessage.mock.calls[0]?.[0].content).toContain('probe-output');
    expect(await handlers['agent_before_settle']?.({ entries: [] }, ctx)).toBeUndefined();
  });

  liveTest("a worker's tmux_run sees the worker's own $TMPDIR, so paths the worker hands it exist", async () => {
    const slowPi = join(agentDir, 'slow-pi.mjs');
    writeFileSync(slowPi, 'setTimeout(() => {}, 30_000);\n');
    process.argv[1] = slowPi;
    ctx = { ...ctx, mode: 'print', hasUI: false };
    await handlers['session_start']?.({}, ctx);
    await call('pi_spawn', { name: 'top', brief: 'hi', wake: false });
    const top = join(jobsRoot(), jobs()[0] ?? '');
    const workerTmp = join(top, 'tmp');
    const rootTmp = process.env['TMPDIR'];
    vi.stubEnv('PSTACK_V2_CONTAINED', '1');
    vi.stubEnv('PSTACK_V2_JOB_DIR', top);
    vi.stubEnv('PSTACK_V2_TOP_DIR', top);
    vi.stubEnv('TMPDIR', workerTmp);
    await call('tmux_run', { name: 'child', command: 'printf "%s" "$TMPDIR" > "$TMPDIR/handoff"' });
    vi.stubEnv('PSTACK_V2_CONTAINED', '');
    vi.stubEnv('TMPDIR', rootTmp);
    await expect.poll(() => existsSync(join(workerTmp, 'handoff')), { timeout: 10_000 }).toBe(true);
    expect(readFileSync(join(workerTmp, 'handoff'), 'utf8')).toBe(workerTmp);
  });

  liveTest('tmux_run may run in a linked worktree of this repository, such as a worker checkout', async () => {
    const worktree = join(jobsRoot(), 'manual-000001', 'worktree');
    mkdirSync(dirname(worktree), { recursive: true });
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'side', worktree]);
    await call('tmux_run', { name: 'in-worktree', command: 'touch from-job', cwd: worktree });
    const id = jobs().find((name) => name.startsWith('in-worktree')) ?? '';
    await expect.poll(() => exitOf(join(jobsRoot(), id)), { timeout: 10_000 }).toBe('0');
    expect(existsSync(join(worktree, 'from-job'))).toBe(true);
  });

  test('a worktree base that exists only on the remote starts from the remote branch', async () => {
    const remote = join(agentDir, 'remote.git');
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    execFileSync('git', ['clone', '-q', '--bare', repo, remote]);
    git('remote', 'add', 'origin', remote);
    git('checkout', '-q', '-b', 'remote-only');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'remote work');
    git('push', '-q', 'origin', 'remote-only');
    git('checkout', '-q', '-');
    git('branch', '-q', '-D', 'remote-only');
    await call('pi_spawn', { name: 'wt', brief: 'hi', worktree: 'from-remote', base: 'remote-only' });
    const worktree = join(jobsRoot(), jobs()[0] ?? '', 'worktree');
    expect(execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(git('rev-parse', 'origin/remote-only'));
  });
});

liveDescribe('the tools jobs run', { timeout: 60_000 }, () => {
  const run = async (command: string) => {
    await call('tmux_run', { name: 'tool', command });
    const dir = join(jobsRoot(), jobs()[0] ?? '');
    await expect.poll(() => existsSync(join(dir, 'exit')), { timeout: 45_000 }).toBe(true);
    return readFileSync(join(dir, 'output.log'), 'utf8').trim();
  };

  test('top-level commands keep temp files and caches in their private temp directory on the host', async () => {
    const output = await run('printf "%s|%s" "$TMPDIR" "$XDG_CACHE_HOME"');
    const tmp = join(jobsRoot(), jobs()[0] ?? '', 'tmp');
    expect(output).toBe(`${tmp}|${tmp}/cache`);
  });

  test('a job has a private home directory, not yours', async () => {
    const output = await run('printf "%s" "$HOME"; echo x > "$HOME/probe" && echo HOME-WRITTEN');
    expect(output).toBe(`${join(jobsRoot(), jobs()[0] ?? '', 'tmp', 'home')}HOME-WRITTEN`);
  });

  test("a job finds the image's tools, and commits as the checkout's git identity", async () => {
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Probe Person']);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'probe@example.com']);
    const output = await run('git --version; rg --version | head -1; jq --version; python3 --version; git var GIT_AUTHOR_IDENT');
    expect(output).toMatch(/git version.*\nripgrep.*\njq-.*\nPython 3.*\nProbe Person <probe@example.com>/);
  });
});
