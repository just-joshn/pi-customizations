import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { claimWake, type JobSpec, launch, list, newJobId, read, STOPPED_EXIT_CODE, stop, tail, tmuxSocket } from '../src/jobs.ts';
import { bwrapArgs, SANDBOX_ENV, type SandboxPolicy, sandboxed, seatbeltProfile } from '../src/sandbox.ts';

const owner = `test${process.pid}`;
const socket = tmuxSocket(owner, {});
let root: string;

const spec = (command: string, overrides: Partial<JobSpec> = {}): JobSpec => {
  const id = overrides.id ?? newJobId('t');
  return { id, name: 't', kind: 'command', cwd: root, argv: ['bash', '-c', command], owner, wake: 'done', repeat: false, series: id, socket, createdAt: new Date().toISOString(), ...overrides };
};

async function settled(id: string, jobsRoot = root) {
  await expect.poll(() => read(jobsRoot, id, owner)?.status.state, { timeout: 10_000 }).not.toBe('running');
  const job = read(jobsRoot, id, owner);
  if (!job) throw new Error(`job ${id} has no spec`);
  return job;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-jobs-')));
});

afterEach(() => {
  try {
    execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
  } catch {
    // No server was started.
  }
  rmSync(root, { recursive: true, force: true });
});

describe('tmux jobs', () => {
  test('a finished command keeps its exit code and output', async () => {
    const job = launch(root, spec('echo hello; exit 3'));
    const done = await settled(job.spec.id);
    expect(done.status).toEqual({ state: 'exited', code: 3 });
    expect(tail(done.dir, 5)).toContain('hello');
  });

  test('the command sees the sandbox marker so nested jobs do not re-wrap', async () => {
    const job = launch(root, spec(`echo "marker=$${SANDBOX_ENV}"`));
    expect(tail((await settled(job.spec.id)).dir, 5)).toContain('marker=1');
  });

  test('stopping a running job records the stopped code without a wake', async () => {
    const job = launch(root, spec('sleep 30'));
    expect(read(root, job.spec.id, owner)?.status).toEqual({ state: 'running' });
    stop(job);
    const stopped = read(root, job.spec.id, owner);
    expect(stopped?.status).toEqual({ state: 'exited', code: STOPPED_EXIT_CODE });
    expect(stopped && claimWake(stopped)).toBe(false);
  });

  test('a wake is claimed exactly once', async () => {
    const job = await settled(launch(root, spec('true')).spec.id);
    expect([claimWake(job), claimWake(job)]).toEqual([true, false]);
  });

  test('list returns only the owner jobs, oldest first', async () => {
    const first = launch(root, spec('true', { createdAt: '2026-01-01T00:00:00.000Z' }));
    const second = launch(root, spec('true', { createdAt: '2026-01-02T00:00:00.000Z' }));
    launch(root, spec('true', { owner: 'someone-else' }));
    expect(list(root, owner).map((job) => job.spec.id)).toEqual([first.spec.id, second.spec.id]);
  });

  test('a corrupt spec is skipped instead of breaking the listing', () => {
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', 'job.json'), '{');
    expect(list(root, owner)).toEqual([]);
  });

  test('sessions with a shared id prefix get separate tmux servers', () => {
    expect(tmuxSocket('01a1dd30-aaaa', {})).not.toBe(tmuxSocket('01a1dd30-bbbb', {}));
  });
});

describe('sandbox policy', () => {
  const policy: SandboxPolicy = { writable: ['/work/tree'], protect: ['/work/tree/.git/hooks'], agentDir: '/home/u/.pi/agent', jobDir: '/home/u/.pi/agent/pstack-v2/jobs/j' };

  test('a process already inside the sandbox is not wrapped again', () => {
    expect(sandboxed(['pi'], policy, 'darwin', { [SANDBOX_ENV]: '1' })).toEqual(['pi']);
  });

  test('a platform without a sandbox refuses to run', () => {
    expect(() => sandboxed(['pi'], policy, 'win32', {})).toThrow(/found none on win32/);
  });

  test('seatbelt allows only credentials and locks in the Pi agent directory', () => {
    const profile = seatbeltProfile(policy);
    expect(profile).toContain('(literal "/home/u/.pi/agent/auth.json")');
    expect(profile).not.toMatch(/agent\/\[\^\/\]\+\$/);
  });

  test('bwrap overlays the agent directory and hides outside tmux servers', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'pstack-agent-'));
    const hidden = mkdtempSync(join(tmpdir(), 'pstack-runtime-'));
    const args = bwrapArgs({ ...policy, writable: [tmpdir()], protect: [], agentDir }, { XDG_RUNTIME_DIR: hidden }, 501);
    expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
    expect(args).toEqual(expect.arrayContaining(['--overlay-src', agentDir, '--tmp-overlay', agentDir, '--tmpfs', hidden]));
    expect(args.indexOf(tmpdir(), 10)).toBeGreaterThan(args.indexOf('--tmp-overlay'));
    rmSync(agentDir, { recursive: true });
    rmSync(hidden, { recursive: true });
  });
});

// Each test below reproduces an escape found in review: a sandboxed job reaching an unsandboxed process or file.
describe.runIf(process.platform === 'darwin')('seatbelt containment', () => {
  let home: string;
  let agentDir: string;
  let work: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(homedir(), '.pstack-sandbox-')));
    agentDir = join(home, 'agent');
    work = join(home, 'work');
    mkdirSync(join(agentDir, 'extensions'), { recursive: true });
    mkdirSync(join(work, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const run = async (command: string, jobsRoot = root) => {
    const id = newJobId('probe');
    const argv = sandboxed(['bash', '-c', command], { writable: [work], protect: [join(work, '.git', 'hooks')], agentDir, jobDir: join(jobsRoot, id) }, 'darwin', {});
    return settled(launch(jobsRoot, spec('', { id, argv, cwd: work })).spec.id, jobsRoot);
  };

  test('a job writes its working directory but not outside it', async () => {
    const done = await run(`touch ${work}/ok.txt; touch ${home}/outside.txt`);
    expect(done.status).toEqual({ state: 'exited', code: 1 });
    expect([existsSync(join(work, 'ok.txt')), existsSync(join(home, 'outside.txt'))]).toEqual([true, false]);
  });

  test('a job cannot run commands through the unsandboxed tmux server', async () => {
    const done = await run(`tmux -S ${socket} new-session -d 'touch ${home}/escaped.txt'`);
    expect(done.status).toEqual({ state: 'exited', code: 1 });
    expect(existsSync(join(home, 'escaped.txt'))).toBe(false);
  });

  test('a job cannot swap out Pi extensions or write role lines', async () => {
    const done = await run(`mv ${agentDir}/extensions ${agentDir}/old || echo '' > ${agentDir}/pstack-v2-models.md`);
    expect(done.status).toEqual({ state: 'exited', code: 1 });
    expect([existsSync(join(agentDir, 'extensions')), existsSync(join(agentDir, 'pstack-v2-models.md'))]).toEqual([true, false]);
  });

  test('a job cannot plant a git hook in a checkout it may write', async () => {
    const done = await run(`echo evil > ${work}/.git/hooks/pre-commit`);
    expect(done.status).toEqual({ state: 'exited', code: 1 });
  });

  test('a job cannot rewrite its own spec', async () => {
    const jobs = join(home, 'jobs');
    const id = newJobId('tamper');
    const argv = sandboxed(['bash', '-c', `echo '{}' > ${join(jobs, id, 'job.json')}`], { writable: [work], protect: [], agentDir, jobDir: join(jobs, id) }, 'darwin', {});
    const done = await settled(launch(jobs, spec('', { id, argv, cwd: work })).spec.id, jobs);
    expect(done.status).toEqual({ state: 'exited', code: 1 });
    expect(done.spec.argv[0]).toBe('sandbox-exec');
  });
});
