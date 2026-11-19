import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { claimWake, type JobSpec, launch, list, newJobId, outputPath, read, readEnd, STOPPED_EXIT_CODE, stop, tail, tmuxSocket } from '../src/jobs.ts';

const owner = `test${process.pid}`;
const socket = tmuxSocket(owner);
const MISSING_PATH = '/nonexistent';
const TAIL_LINES = 5;
const MANY_LINES = 200;
const KEPT_LINES = 3;
const PID_BYTES = 4;
const CONTAINMENT_TIMEOUT_MS = 20_000;
const SETTLE_TIMEOUT_MS = 10_000;
const SHORT_POLL_TIMEOUT_MS = 5_000;
let root: string;

const spec = (command: string, overrides: Partial<JobSpec> = {}): JobSpec => {
  const id = overrides.id ?? newJobId('t');
  return {
    id,
    name: 't',
    cwd: root,
    command: ['bash', '-c', command],
    owner,
    wake: 'done',
    repeat: false,
    series: id,
    socket,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
};

async function settled(id: string, jobsRoot = root) {
  await expect.poll(() => read(jobsRoot, id, owner)?.status.state, { timeout: SETTLE_TIMEOUT_MS }).not.toBe('running');
  const job = read(jobsRoot, id, owner);
  if (!job) throw new Error(`job ${id} has no spec`);
  return job;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-jobs-')));
});

afterEach(() => {
  spawnSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('tmux jobs', { timeout: CONTAINMENT_TIMEOUT_MS }, () => {
  test('without tmux a job is refused with a way to fix it, never run another way', () => {
    vi.stubEnv('PATH', MISSING_PATH);
    try {
      expect(() => launch(root, spec('true'))).toThrow(/needs tmux/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('a finished command keeps its exit code and output', async () => {
    const job = launch(root, spec('echo hello; exit 3'));
    const done = await settled(job.spec.id);
    expect(done.status).toEqual({ state: 'exited', code: 3 });
    expect(tail(outputPath(done.dir), TAIL_LINES)).toContain('hello');
  });

  test('the command runs in its cwd with the environment Pi started with', async () => {
    vi.stubEnv('JOB_PROBE', 'inherited');
    try {
      const job = launch(root, spec('pwd; echo "probe=$JOB_PROBE"'));
      expect(tail(outputPath((await settled(job.spec.id)).dir), TAIL_LINES)).toBe(`${root}\nprobe=inherited\n`);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('tmux jobs, wrapper and lifecycle', { timeout: CONTAINMENT_TIMEOUT_MS }, () => {
  test('a job whose tmux server dies still records the stopped code, instead of hanging on the closed terminal', async () => {
    const job = launch(root, spec('sleep 30'));
    await expect.poll(() => existsSync(join(job.dir, 'wrapper.pid')), { timeout: SHORT_POLL_TIMEOUT_MS }).toBe(true);
    const wrapper = Number(readFileSync(join(job.dir, 'wrapper.pid'), 'utf8'));
    execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
    await expect.poll(() => read(root, job.spec.id, owner)?.status, { timeout: SETTLE_TIMEOUT_MS }).toEqual({ state: 'exited', code: STOPPED_EXIT_CODE });
    const alive = (): boolean => spawnSync('kill', ['-0', String(wrapper)]).status === 0;
    await expect.poll(alive, { timeout: SHORT_POLL_TIMEOUT_MS }).toBe(false);
  });

  test('stopping a running job records the stopped code without a wake', async () => {
    const job = launch(root, spec('sleep 30'));
    expect(read(root, job.spec.id, owner)?.status).toEqual({ state: 'running' });
    await stop(job);
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
    expect(tmuxSocket('01a1dd30-aaaa')).not.toBe(tmuxSocket('01a1dd30-bbbb'));
  });
});

describe('reports', () => {
  test('a job named only with symbols still gets a readable id', () => {
    expect(newJobId('***')).toMatch(/^job-[0-9a-f]{6}$/);
    expect(newJobId('Fix: The Bug!')).toMatch(/^fix-the-bug-[0-9a-f]{6}$/);
  });

  test('a job that wrote no output reports nothing rather than failing', () => {
    expect(tail(join(root, 'none.log'), TAIL_LINES)).toBe('');
  });

  test('tail keeps only the last lines of a long output', () => {
    writeFileSync(join(root, 'long.log'), Array.from({ length: MANY_LINES }, (_, i) => `line ${i}`).join('\n'));
    const last = Array.from({ length: KEPT_LINES }, (_, i) => `line ${MANY_LINES - KEPT_LINES + i}`);
    expect(tail(join(root, 'long.log'), KEPT_LINES)).toBe(last.join('\n'));
    expect(readEnd(join(root, 'long.log'), PID_BYTES)).toBe(` ${MANY_LINES - 1}`);
  });
});
