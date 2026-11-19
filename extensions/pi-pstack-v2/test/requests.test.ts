import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { addWorktree, dropWorktree, gitPath, protectedPaths } from '../src/git.ts';
import { brokeredSession, exitPath, type Job, type JobSpec, launchBrokered, resultsDir } from '../src/jobs.ts';
import { serveRequests, sweepFor } from '../src/requests.ts';
import { type SandboxPolicy, sandboxed } from '../src/sandbox.ts';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('../src/git.ts', () => ({ addWorktree: vi.fn(), dropWorktree: vi.fn(), gitPath: vi.fn(), protectedPaths: vi.fn() }));
vi.mock('../src/sandbox.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/sandbox.ts')>()), sandboxed: vi.fn() }));
vi.mock('../src/jobs.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/jobs.ts')>()), launchBrokered: vi.fn() }));

const EXIT_REFUSED = 126;
const EXIT_LOST = 137;
const EXIT_LAUNCH_FAILED = 127;
const DEPTH_BEYOND_LIMIT = 10;
const strings = z.array(z.string());

let work: string;
let top: Job;
let nested: string;
let repo: string;

const policyOf = (writable: string[], extra: Partial<SandboxPolicy> = {}): SandboxPolicy => ({
  writable,
  protect: [],
  lock: [],
  gitDirs: [],
  checkouts: [],
  agentDir: join(work, 'agent'),
  credentials: join(work, 'creds'),
  jobDir: join(work, 'jobdir'),
  ...extra,
});

const specOf = (over: Record<string, unknown> = {}): JobSpec =>
  ({
    id: 'req',
    name: 'req',
    kind: 'command',
    cwd: repo,
    argv: [],
    command: ['echo', 'hi'],
    policy: policyOf([repo]),
    brokered: true,
    out: '',
    owner: 'owner',
    wake: null,
    repeat: false,
    series: 'req',
    socket: '',
    sweep: { roots: [], protect: [] },
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }) as JobSpec;

const writeRequest = (parent: string, name: string, over: Record<string, unknown> = {}): string => {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'job.json'), JSON.stringify(specOf(over)));
  return dir;
};

const outFor = (dir: string): string => resultsDir(top.dir, dir);
const exitCode = (dir: string): number => Number(readFileSync(exitPath(outFor(dir)), 'utf8').trim());
const message = (dir: string): string => readFileSync(join(outFor(dir), 'output.log'), 'utf8');
const serve = (done = false): void => serveRequests(top, 'sock', nested, done);

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-requests-')));
  repo = join(work, 'repo');
  mkdirSync(repo);
  const topDir = join(work, 'top');
  mkdirSync(topDir);
  nested = join(topDir, 'nested');
  mkdirSync(nested);
  top = { spec: specOf({ brokered: false, policy: policyOf([repo]) }), dir: topDir, status: { state: 'running' } };
  vi.mocked(launchBrokered).mockReturnValue(true);
  vi.mocked(sandboxed).mockReturnValue(['sandbox-exec', 'x']);
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
  vi.mocked(gitPath).mockReturnValue(undefined);
  vi.mocked(addWorktree).mockReturnValue(true);
  vi.mocked(protectedPaths).mockReturnValue({ protect: [], lock: [], gitDirs: [] });
});

afterEach(() => {
  vi.resetAllMocks();
  rmSync(work, { recursive: true, force: true });
});

describe('sweepFor', () => {
  test('keeps checkouts and drops agent-dir and git-dir paths', () => {
    const agentDir = join(work, 'agent');
    const gitDir = join(repo, '.git');
    const policy = policyOf([repo, join(agentDir, 'sessions'), join(agentDir, 'x', 'worktree'), gitDir], { agentDir, gitDirs: [gitDir], protect: [join(repo, 'hooks'), join(work, 'elsewhere')] });
    expect(sweepFor(policy)).toEqual({ roots: [repo, join(agentDir, 'x', 'worktree')], protect: [join(repo, 'hooks')] });
  });
});

describe('serveRequests traversal', () => {
  test('ignores a missing directory, a file, and a symlinked directory', () => {
    serveRequests(top, 'sock', join(work, 'missing'), false);
    writeFileSync(join(work, 'file'), '');
    serveRequests(top, 'sock', join(work, 'file'), false);
    const target = join(work, 'target');
    writeRequest(target, 'a');
    symlinkSync(target, join(work, 'link'));
    serveRequests(top, 'sock', join(work, 'link'), false);
    expect(launchBrokered).not.toHaveBeenCalled();
    expect(existsSync(join(top.dir, 'brokered'))).toBe(false);
  });

  test('skips entries that are files or links', () => {
    writeFileSync(join(nested, 'plain'), '');
    const real = writeRequest(join(work, 'elsewhere'), 'a');
    symlinkSync(real, join(nested, 'linked'));
    serve();
    expect(launchBrokered).not.toHaveBeenCalled();
  });

  test.each([
    ['unparseable job.json', 'not json'],
    ['unknown kind', { kind: 'weird' }],
    ['empty command', { command: [] }],
  ])('skips a request with %s', (_label, body) => {
    const dir = join(nested, 'bad');
    mkdirSync(dir);
    writeFileSync(join(dir, 'job.json'), typeof body === 'string' ? body : JSON.stringify(specOf(body)));
    serve();
    expect(launchBrokered).not.toHaveBeenCalled();
    expect(existsSync(exitPath(outFor(dir)))).toBe(false);
  });

  test('skips a request with no job.json and carries on to the next one', () => {
    mkdirSync(join(nested, 'empty'));
    writeRequest(nested, 'good');
    serve();
    expect(launchBrokered).toHaveBeenCalledTimes(1);
  });

  test('does not follow requests nested too deeply', () => {
    const chain = Array.from({ length: DEPTH_BEYOND_LIMIT }).reduce<string>((parent, _unused, index) => {
      const dir = writeRequest(parent, `r${index}`, { brokered: false });
      return join(dir, 'nested');
    }, nested);
    writeRequest(chain, 'deep');
    serve();
    expect(launchBrokered).not.toHaveBeenCalled();
  });
});

describe('launching a request', () => {
  test('launches an allowed command and records what it was granted', () => {
    const dir = writeRequest(nested, 'ok');
    serve();
    expect(launchBrokered).toHaveBeenCalledTimes(1);
    const [topDir, jobDir, spec, sweepWhat, argv, socket] = vi.mocked(launchBrokered).mock.calls[0] ?? [];
    expect(topDir).toBe(top.dir);
    expect(jobDir).toBe(dir);
    expect(spec?.cwd).toBe(repo);
    expect(sweepWhat?.roots).toEqual([repo]);
    expect(argv).toEqual(['sandbox-exec', 'x']);
    expect(socket).toBe('sock');
    expect(strings.parse(JSON.parse(readFileSync(join(outFor(dir), 'granted.json'), 'utf8')))).toEqual([repo]);
    const granted = vi.mocked(sandboxed).mock.calls[0]?.[1];
    expect(granted?.credentials).toBe(join(top.dir, 'agent'));
    expect(granted?.jobDir).toBe(dir);
    expect(granted?.checkouts).toEqual([repo]);
  });
});

describe('refused requests', () => {
  test('refuses a request that writes outside its grant', () => {
    const dir = writeRequest(nested, 'greedy', { policy: policyOf([repo, join(work, 'outside')]) });
    serve();
    expect(exitCode(dir)).toBe(EXIT_REFUSED);
    expect(message(dir)).toContain(join(work, 'outside'));
    expect(launchBrokered).not.toHaveBeenCalled();
  });

  test('refuses a request whose cwd is outside what it may use', () => {
    const dir = writeRequest(nested, 'cwd', { cwd: join(work, 'outside') });
    serve();
    expect(exitCode(dir)).toBe(EXIT_REFUSED);
    expect(message(dir)).toContain(`cwd ${join(work, 'outside')}`);
  });

  test('settles a launch that throws with the launch-failed code', () => {
    vi.mocked(sandboxed).mockImplementation(() => {
      throw new Error('no sandbox');
    });
    const dir = writeRequest(nested, 'boom');
    serve();
    expect(exitCode(dir)).toBe(EXIT_LAUNCH_FAILED);
    expect(message(dir)).toContain('pstack could not launch this job: no sandbox');
  });
});

describe('launching a request, tmp', () => {
  test('passes along only a tmp the request is allowed to write', () => {
    const okTmp = repo;
    writeRequest(nested, 'a', { tmp: okTmp });
    writeRequest(nested, 'b', { tmp: join(work, 'else') });
    serve();
    const tmps = vi.mocked(launchBrokered).mock.calls.map((call) => call[2].tmp);
    expect(tmps).toEqual([okTmp, undefined]);
  });
});

describe('request lifecycle', () => {
  test('leaves a request that already exited alone', () => {
    const dir = writeRequest(nested, 'done');
    mkdirSync(outFor(dir), { recursive: true });
    writeFileSync(exitPath(outFor(dir)), '0\n');
    serve();
    expect(launchBrokered).not.toHaveBeenCalled();
  });

  test('does not launch a request whose requester is done or that was stopped', () => {
    writeRequest(nested, 'a');
    serve(true);
    const stopped = writeRequest(nested, 'b');
    writeFileSync(join(stopped, 'stop'), '');
    serve();
    expect(launchBrokered).toHaveBeenCalledTimes(1);
  });

  test('does not launch a request that is not brokered', () => {
    writeRequest(nested, 'a', { brokered: false });
    serve();
    expect(launchBrokered).not.toHaveBeenCalled();
  });

  test('settles a launched request whose tmux session vanished', () => {
    const dir = writeRequest(nested, 'gone');
    mkdirSync(outFor(dir), { recursive: true });
    writeFileSync(join(outFor(dir), 'launched'), '');
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);
    serve();
    expect(exitCode(dir)).toBe(EXIT_LOST);
    expect(message(dir)).toContain('pstack lost this job');
  });

  test('leaves a launched request with a live session running', () => {
    const dir = writeRequest(nested, 'live');
    mkdirSync(outFor(dir), { recursive: true });
    writeFileSync(join(outFor(dir), 'launched'), '');
    serve();
    expect(existsSync(exitPath(outFor(dir)))).toBe(false);
    expect(spawnSync).toHaveBeenCalledWith('tmux', ['-S', 'sock', 'has-session', '-t', `=${brokeredSession(dir)}`], { stdio: 'ignore' });
  });

  test.each([
    ['requester done', true, false],
    ['stop file', false, true],
  ])('kills a launched session on %s', (_label, done, stop) => {
    const dir = writeRequest(nested, 'kill');
    mkdirSync(outFor(dir), { recursive: true });
    writeFileSync(join(outFor(dir), 'launched'), '');
    if (stop) writeFileSync(join(dir, 'stop'), '');
    serve(done);
    expect(spawnSync).toHaveBeenCalledWith('tmux', ['-S', 'sock', 'kill-session', '-t', `=${brokeredSession(dir)}`], { stdio: 'ignore' });
  });
});

describe('nested requests', () => {
  const parentWith = (grant: string | undefined): string => {
    const parent = writeRequest(nested, 'parent', { brokered: false });
    mkdirSync(outFor(parent), { recursive: true });
    if (grant !== undefined) writeFileSync(join(outFor(parent), 'granted.json'), grant);
    return join(parent, 'nested');
  };

  test('refuses a Pi worker requested by another worker', () => {
    const child = writeRequest(parentWith(JSON.stringify([repo])), 'child', { kind: 'pi' });
    serve();
    expect(exitCode(child)).toBe(EXIT_REFUSED);
    expect(message(child)).toContain('cannot start workers of its own');
  });

  test('limits a nested request to what its parent was granted', () => {
    const sub = join(repo, 'sub');
    const allowed = writeRequest(parentWith(JSON.stringify([sub])), 'allowed', { policy: policyOf([sub]), cwd: sub });
    serve();
    expect(launchBrokered).toHaveBeenCalledTimes(1);
    expect(vi.mocked(launchBrokered).mock.calls[0]?.[1]).toBe(allowed);
  });

  test.each([
    ['no grant file', undefined],
    ['bad json', '{'],
    ['wrong shape', JSON.stringify({ a: 1 })],
  ])('grants nothing with %s', (_label, grant) => {
    const child = writeRequest(parentWith(grant), 'child');
    serve();
    expect(exitCode(child)).toBe(EXIT_REFUSED);
  });

  test('stops nested requests when their parent is done', () => {
    const parent = writeRequest(nested, 'parent', { brokered: false });
    writeFileSync(join(parent, 'stop'), '');
    writeRequest(join(parent, 'nested'), 'child');
    serve();
    expect(launchBrokered).not.toHaveBeenCalled();
  });
});

const common = (): string => join(repo, '.git');
const piRequest = (extra: Record<string, unknown> = {}, writable: string[] = []): string => {
  const dir = join(nested, 'wt');
  const path = join(outFor(dir), 'worktree');
  return writeRequest(nested, 'wt', { kind: 'pi', cwd: path, createWorktree: { branch: 'feat', base: 'main' }, policy: policyOf(writable.map((entry) => (entry === 'WT' ? path : entry))), ...extra });
};

describe('requested worktrees', () => {
  test('launches in a new worktree it may write', () => {
    vi.mocked(gitPath).mockReturnValue(common());
    vi.mocked(protectedPaths).mockReturnValue({ protect: [join(repo, 'p')], lock: [], gitDirs: [common()] });
    const dir = piRequest({}, ['WT']);
    serve();
    const path = join(outFor(dir), 'worktree');
    expect(addWorktree).toHaveBeenCalledWith(repo, path, 'feat', 'main');
    const spec = vi.mocked(launchBrokered).mock.calls[0]?.[2];
    expect(spec?.cwd).toBe(path);
    expect(strings.parse(JSON.parse(readFileSync(join(outFor(dir), 'granted.json'), 'utf8')))).toEqual([path, common()]);
    expect(dropWorktree).not.toHaveBeenCalled();
  });

  test('does not make the worktree writable unless asked', () => {
    vi.mocked(gitPath).mockReturnValue(common());
    const dir = piRequest();
    serve();
    expect(strings.parse(JSON.parse(readFileSync(join(outFor(dir), 'granted.json'), 'utf8')))).toEqual([]);
  });

  test('omits the common dir when git reports none after creation', () => {
    vi.mocked(gitPath).mockReturnValueOnce(common()).mockReturnValue(undefined);
    const dir = piRequest({}, ['WT']);
    serve();
    expect(strings.parse(JSON.parse(readFileSync(join(outFor(dir), 'granted.json'), 'utf8')))).toEqual([join(outFor(dir), 'worktree')]);
  });
});

describe('requested worktree failures', () => {
  test('removes the worktree and branch when the launch fails', () => {
    vi.mocked(gitPath).mockReturnValue(common());
    vi.mocked(launchBrokered).mockReturnValue(false);
    const dir = piRequest();
    const path = join(outFor(dir), 'worktree');
    mkdirSync(path, { recursive: true });
    serve();
    expect(existsSync(path)).toBe(false);
    expect(dropWorktree).toHaveBeenCalledWith(repo, 'feat');
  });

  test('keeps no branch to drop when the branch already existed', () => {
    vi.mocked(gitPath).mockReturnValue(common());
    vi.mocked(addWorktree).mockReturnValue(false);
    vi.mocked(launchBrokered).mockReturnValue(false);
    piRequest();
    serve();
    expect(dropWorktree).toHaveBeenCalledWith(repo, undefined);
  });
});

describe('refused worktree requests', () => {
  test('refuses a worktree for a request that is not a Pi worker', () => {
    vi.mocked(gitPath).mockReturnValue(common());
    const dir = piRequest({ kind: 'command' });
    serve();
    expect(exitCode(dir)).toBe(EXIT_REFUSED);
    expect(message(dir)).toContain('Only a Pi worker');
  });

  // The spec is read as written, so the broker looks at these and refuses them, as it always did, rather than skipping them.
  test.each([
    ['non-object', 'x', 'Only a Pi worker'],
    ['null', null, 'Only a Pi worker'],
    ['non-string branch', { branch: 1 }, 'malformed'],
    ['non-string base', { branch: 'b', base: 2 }, 'malformed'],
  ])('refuses a request with a %s worktree request', (_label, createWorktree, reason) => {
    vi.mocked(gitPath).mockReturnValue(common());
    const dir = piRequest({ createWorktree });
    serve();
    expect(exitCode(dir)).toBe(EXIT_REFUSED);
    expect(message(dir)).toContain(reason);
    expect(launchBrokered).not.toHaveBeenCalled();
  });

  test.each([
    ['git unknown', () => undefined],
    ['outside the grant', () => join(work, 'other', '.git')],
  ])('refuses when the repository is %s', (_label, found) => {
    vi.mocked(gitPath).mockReturnValue(found());
    const dir = piRequest();
    serve();
    expect(exitCode(dir)).toBe(EXIT_REFUSED);
    expect(message(dir)).toContain('may not write the repository');
  });

  test('refuses when creating the worktree throws', () => {
    vi.mocked(gitPath).mockReturnValue(common());
    vi.mocked(addWorktree).mockImplementation(() => {
      throw new Error('git broke');
    });
    const dir = piRequest();
    serve();
    expect(exitCode(dir)).toBe(EXIT_REFUSED);
    expect(message(dir)).toContain('pstack could not create the worktree: git broke');
  });
});
