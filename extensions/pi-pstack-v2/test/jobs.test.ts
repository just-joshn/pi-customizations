import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { claimWake, type JobSpec, launch, list, newJobId, read, STOPPED_EXIT_CODE, stop, tail } from '../src/jobs.ts';
import { bwrapArgs, SANDBOX_ENV, sandboxed, seatbeltProfile } from '../src/sandbox.ts';

const owner = `test${process.pid}`;
let root: string;

const spec = (command: string, overrides: Partial<JobSpec> = {}): JobSpec => ({
  id: newJobId('t'),
  name: 't',
  kind: 'command',
  cwd: root,
  argv: ['bash', '-c', command],
  owner,
  wake: 'done',
  repeat: false,
  createdAt: new Date().toISOString(),
  ...overrides,
});

async function settled(id: string) {
  await expect.poll(() => read(root, id)?.status.state, { timeout: 10_000 }).not.toBe('running');
  const job = read(root, id);
  if (!job) throw new Error(`job ${id} has no spec`);
  return job;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-jobs-')));
});

afterEach(() => {
  try {
    execFileSync('tmux', ['-L', `pstack-v2-${owner.slice(0, 8)}`, 'kill-server'], { stdio: 'ignore' });
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
    expect(read(root, job.spec.id)?.status).toEqual({ state: 'running' });
    stop(job);
    const stopped = read(root, job.spec.id);
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
});

describe('sandbox', () => {
  const policy = { writable: ['/work/tree'], agentDir: '/home/u/.pi/agent' };

  test('a process already inside the sandbox is not wrapped again', () => {
    expect(sandboxed(['pi'], policy, 'darwin', { [SANDBOX_ENV]: '1' })).toEqual(['pi']);
  });

  test('a platform without a sandbox refuses to run', () => {
    expect(() => sandboxed(['pi'], policy, 'win32', {})).toThrow(/found none on win32/);
  });

  test('the seatbelt profile protects Pi config', () => {
    const profile = seatbeltProfile(policy);
    expect(profile).toContain('(deny file-write*)');
    expect(profile).toContain('(subpath "/work/tree")');
    expect(profile.split('\n').at(-1)).toMatch(/^\(deny file-write\* .*"\/home\/u\/\.pi\/agent\/settings\.json"/);
  });

  test('bwrap mounts the root read-only before binding writable paths', () => {
    const args = bwrapArgs({ writable: [tmpdir()], agentDir: '/nonexistent' });
    expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
    expect(args).toContain('--die-with-parent');
    expect(args.indexOf(tmpdir())).toBeGreaterThan(2);
  });

  test.runIf(process.platform === 'darwin')('a sandboxed job cannot rewrite its own spec', async () => {
    const home = realpathSync(mkdtempSync(join(homedir(), '.pstack-jobs-')));
    const tmpRoot = root;
    root = home;
    try {
      const id = newJobId('tamper');
      const argv = sandboxed(['bash', '-c', `echo '{}' > ${join(home, id, 'job.json')}`], { writable: [tmpRoot], agentDir: join(tmpRoot, 'agent') }, 'darwin', {});
      const done = await settled(launch(home, spec('', { id, argv, cwd: tmpRoot })).spec.id);
      expect(done.status).toEqual({ state: 'exited', code: 1 });
      expect(done.spec.argv[0]).toBe('sandbox-exec');
    } finally {
      root = tmpRoot;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test.runIf(process.platform === 'darwin')('seatbelt blocks a write outside the writable paths', () => {
    const outside = join(homedir(), `.pstack-sandbox-probe-${process.pid}`);
    const inside = join(root, 'inside.txt');
    const argv = sandboxed(['/bin/sh', '-c', `touch ${inside}; touch ${outside}`], { writable: [root], agentDir: join(root, 'agent') }, 'darwin', {});
    expect(() => execFileSync(argv[0] ?? '', argv.slice(1), { stdio: 'ignore' })).toThrow();
    expect([existsSync(inside), existsSync(outside)]).toEqual([true, false]);
  });
});
