import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TOP_DIR_ENV } from '../src/container.ts';
import { claimWake, excerpt, type JobSpec, launch, launchBrokered, list, newJobId, outputPath, read, request, STOPPED_EXIT_CODE, stop, tail, tmuxSocket } from '../src/jobs.ts';

const owner = `test${process.pid}`;
const socket = tmuxSocket(owner);
let root: string;

const spec = (command: string, overrides: Partial<JobSpec> = {}): JobSpec => {
  const id = overrides.id ?? newJobId('t');
  return {
    id,
    name: 't',
    kind: 'command',
    cwd: root,
    argv: ['bash', '-c', command],
    command: [],
    policy: { writable: [], protect: [], guardFiles: [], checkouts: [], gitDirs: [], agentDir: root, credsDir: '', jobDir: root, cwd: root, name: 'pstack-t', cidFile: join(root, 'cid'), readonly: false, network: 'default' },
    brokered: false,
    owner,
    wake: 'done',
    repeat: false,
    series: id,
    socket,
    sweep: { roots: [], protect: [], guardFiles: [] },
    out: root,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
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
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('tmux jobs', { timeout: 20_000 }, () => {
  test('without tmux a job is refused with a way to fix it, never run another way', () => {
    const path = process.env['PATH'];
    process.env['PATH'] = '/nonexistent';
    try {
      expect(() => launch(root, spec('true'))).toThrow(/needs tmux/);
    } finally {
      process.env['PATH'] = path;
    }
  });

  test('a finished command keeps its exit code and output', async () => {
    const job = launch(root, spec('echo hello; exit 3'));
    const done = await settled(job.spec.id);
    expect(done.status).toEqual({ state: 'exited', code: 3 });
    expect(tail(outputPath(done.dir), 5)).toContain('hello');
  });

  test("a finished job's package caches are deleted, while files it left in its temp directory stay for the report", async () => {
    const id = newJobId('t');
    const tmp = join(root, id, 'tmp');
    const job = launch(root, spec(`mkdir -p ${tmp}/bun/pkg ${tmp}/go-mod/mod && echo x > ${tmp}/go-mod/mod/f && chmod -R a-w ${tmp}/go-mod/mod && echo kept > ${tmp}/report.txt`, { id }));
    const done = await settled(job.spec.id);
    expect(done.status).toEqual({ state: 'exited', code: 0 });
    expect(readFileSync(join(done.dir, 'tmp', 'report.txt'), 'utf8')).toBe('kept\n');
    expect([existsSync(join(done.dir, 'tmp', 'bun')), existsSync(join(done.dir, 'tmp', 'go-mod'))]).toEqual([false, false]);
  });

  test('the wrapper sweeps with a copy of the sweeper kept in the job directory, since Node will not run types under node_modules', async () => {
    const job = launch(root, spec('true'));
    const script = /'([^']+sweep\.ts)' '[^']*inventory\.json'/.exec(readFileSync(join(job.dir, 'wrapper.sh'), 'utf8'))?.[1];
    expect(script).toBe(join(job.dir, 'sweep.ts'));
    await settled(job.spec.id);
    expect(execFileSync(process.execPath, [script ?? '', join(job.dir, 'inventory.json')], { encoding: 'utf8' })).toBe('');
  });

  test('a job whose tmux server dies still finishes when its sweep fails, instead of hanging on the closed terminal', async () => {
    const job = launch(root, spec('sleep 30'));
    await expect.poll(() => existsSync(join(job.dir, 'wrapper.pid')), { timeout: 5_000 }).toBe(true);
    const wrapper = Number(readFileSync(join(job.dir, 'wrapper.pid'), 'utf8'));
    rmSync(join(job.dir, 'inventory.json'));
    execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
    await expect.poll(() => read(root, job.spec.id, owner)?.status, { timeout: 10_000 }).toEqual({ state: 'exited', code: STOPPED_EXIT_CODE });
    const alive = (): boolean => {
      try {
        process.kill(wrapper, 0);
        return true;
      } catch {
        return false;
      }
    };
    await expect.poll(alive, { timeout: 5_000 }).toBe(false);
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

describe('jobs a contained worker asks the root to start', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('a worker without its top-level job directory cannot ask for a job', () => {
    vi.stubEnv(TOP_DIR_ENV, '');
    expect(() => request(join(root, 'nested'), spec('true'))).toThrow(/top-level job directory/);
  });

  test('a requested job waits for the root, and stopping it before the root acts records the stopped code without a wake', async () => {
    vi.stubEnv(TOP_DIR_ENV, root);
    const job = request(join(root, 'nested'), spec('true'));
    expect(read(join(root, 'nested'), job.spec.id, owner)?.status).toEqual({ state: 'running' });
    await stop(job);
    expect(read(join(root, 'nested'), job.spec.id, owner)?.status).toEqual({ state: 'exited', code: STOPPED_EXIT_CODE });
    expect(claimWake(job)).toBe(false);
  });

  test('a request the root launches runs to its exit code and output', async () => {
    vi.stubEnv(TOP_DIR_ENV, root);
    const job = request(join(root, 'nested'), spec('echo brokered; exit 4'));
    launchBrokered(root, job.dir, job.spec, job.spec.sweep, ['bash', '-c', 'echo brokered; exit 4'], socket);
    const done = await settled(job.spec.id, join(root, 'nested'));
    expect(done.status).toEqual({ state: 'exited', code: 4 });
    expect(tail(outputPath(done.spec.out), 5)).toContain('brokered');
  });

  test('a request the root cannot start ends at once with the reason, instead of running forever', () => {
    vi.stubEnv(TOP_DIR_ENV, root);
    const job = request(join(root, 'nested'), spec('true'));
    vi.stubEnv('PATH', '/nonexistent');
    launchBrokered(root, job.dir, job.spec, job.spec.sweep, ['true'], socket);
    vi.stubEnv('PATH', process.env['PATH'] ?? '');
    const done = read(join(root, 'nested'), job.spec.id, owner);
    expect(done?.status).toEqual({ state: 'exited', code: 127 });
    expect(tail(outputPath(done?.spec.out ?? ''), 5)).toMatch(/could not launch this job: .*needs tmux/);
  });
});

describe('reports', () => {
  test('a job named only with symbols still gets a readable id', () => {
    expect(newJobId('***')).toMatch(/^job-[0-9a-f]{6}$/);
    expect(newJobId('Fix: The Bug!')).toMatch(/^fix-the-bug-[0-9a-f]{6}$/);
  });

  test('a job that wrote no output reports nothing rather than failing', () => {
    expect(excerpt(join(root, 'none.log'), 10, 10)).toBe('');
  });

  test('a short output is reported whole', () => {
    writeFileSync(join(root, 'short.log'), 'verdict: PASS\n');
    expect(excerpt(join(root, 'short.log'), 100, 100)).toBe('verdict: PASS\n');
  });

  test('a long output keeps its first line and its end, cut on whole characters, and says how much was left out', () => {
    const path = join(root, 'long.log');
    writeFileSync(path, `verdict: FAIL ${'é'.repeat(50)}${'x'.repeat(1000)}${'€'.repeat(20)} end`);
    const report = excerpt(path, 16, 22);
    const [head, note, end] = report.split('\n');
    expect(head).toBe('verdict: FAIL é');
    expect(note).toMatch(new RegExp(`^\\[\\.\\.\\. \\d+ bytes omitted, full output at ${path} \\.\\.\\.\\]$`));
    expect(end).toBe(`${'€'.repeat(6)} end`);
    const omitted = Number(/(\d+) bytes omitted/.exec(note ?? '')?.[1]);
    expect(Buffer.byteLength(head ?? '') + omitted + Buffer.byteLength(end ?? '')).toBe(readFileSync(path).length);
  });
});

describe('a job in a container', { timeout: 20_000 }, () => {
  let bin: string;
  let calls: string;
  const container = () => ({ bin: 'docker' as const, name: 'pstack-x', cidfile: join(root, 'cid') });

  beforeEach(() => {
    bin = join(root, 'bin');
    calls = join(root, 'calls');
    mkdirSync(bin);
    // A runtime that records each command, and ends the job's client when told to stop the container.
    writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$@" >> '${calls}'\n[ "$1" = stop ] && kill "$(cat '${join(root, 'client.pid')}')"\nexit 0\n`, { mode: 0o755 });
    vi.stubEnv('PATH', `${bin}:${process.env['PATH'] ?? ''}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('a stopped job has its container stopped and removed by name, and its client is not killed by process group', async () => {
    const job = launch(root, spec(`echo $$ > ${join(root, 'client.pid')}; exec sleep 30`, { container: container() }));
    await expect.poll(() => existsSync(join(root, 'client.pid')), { timeout: 5_000 }).toBe(true);
    await stop(job);
    expect(read(root, job.spec.id, owner)?.status).toEqual({ state: 'exited', code: STOPPED_EXIT_CODE });
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['stop -t 2 pstack-x', 'rm -f pstack-x']);
    expect(readFileSync(join(job.dir, 'wrapper.sh'), 'utf8')).not.toMatch(/kill -KILL -- -|kill -TERM -- -/);
  });

  test('a job that exits on its own needs no container command, and an old container ID file is cleared before it runs', async () => {
    writeFileSync(join(root, 'cid'), 'stale');
    const job = launch(root, spec('[ ! -e cid ] && echo cleared', { container: container(), cwd: root }));
    const done = await settled(job.spec.id);
    expect(done.status).toEqual({ state: 'exited', code: 0 });
    expect(tail(outputPath(done.dir), 3)).toContain('cleared');
    expect(existsSync(calls)).toBe(false);
  });
});
