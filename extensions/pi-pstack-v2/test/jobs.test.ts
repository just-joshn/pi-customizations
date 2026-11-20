import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createWorld, type Host, loadPstack, startJob, untilExited, type World } from './core-host.ts';

const JOB_TIMEOUT_MS = 20_000;
const OUTER_TMUX = '/outer/tmux,1,0';
const DEFAULT_OUTPUT_LINES = 80;
const MANY_LINES = 200;
const FIRST_DEFAULT_LINE = MANY_LINES - DEFAULT_OUTPUT_LINES + 2;
const TAIL_LINES = 3;
const NOT_EXECUTABLE_MODE = 0o644;

let world: World;
let host: Host;

beforeEach(() => {
  world = createWorld();
  host = loadPstack(world);
});

afterEach(() => {
  world.dispose();
});

const output = (id: string, lines?: number) => host.text('tmux_jobs', { action: 'output', ids: [id], ...(lines ? { lines } : {}) });

describe('tmux_run starts a command the user can follow', { timeout: JOB_TIMEOUT_MS }, () => {
  test('a finished command keeps its exit code and output', async () => {
    const id = await startJob(host, { name: 'build', command: 'echo hello; exit 3' });
    await untilExited(host, id);
    expect(await host.text('tmux_jobs', { action: 'list' })).toContain(`${id}  exited 3  build`);
    expect(await output(id)).toContain('hello');
  });

  test('the command runs in the session cwd with the environment Pi started with, minus tmux variables', async () => {
    vi.stubEnv('JOB_PROBE', 'inherited');
    vi.stubEnv('TMUX', OUTER_TMUX);
    const id = await startJob(host, { name: 'env', command: 'pwd; echo "probe=$JOB_PROBE tmux=$(printenv TMUX || echo unset)"' });
    await untilExited(host, id);
    expect(await output(id)).toContain(`${world.cwd}\nprobe=inherited tmux=unset`);
  });

  test('a cwd relative to the session runs the command there', async () => {
    mkdirSync(join(world.cwd, 'sub'));
    const id = await startJob(host, { name: 'sub', command: 'pwd', cwd: 'sub' });
    await untilExited(host, id);
    expect(await output(id)).toContain(join(world.cwd, 'sub'));
  });

  test.for([
    ['a directory that does not exist', 'nowhere'],
    ['a file', 'file.txt'],
  ])('a cwd that is %s is refused before any job starts', async ([, cwd]) => {
    writeFileSync(join(world.cwd, 'file.txt'), 'x');
    await expect(host.call('tmux_run', { name: 'bad', command: 'true', cwd })).rejects.toThrow(/is not a directory/);
    expect(await host.text('tmux_jobs', { action: 'list' })).toBe('No jobs in this session.');
  });

  test('repeat without a wake message is refused, since nothing would notice the ticks', async () => {
    await expect(host.call('tmux_run', { name: 'tick', command: 'sleep 1', repeat: true })).rejects.toThrow(/repeat needs a wake/);
  });

  test.for([
    ['Fix: The Bug!', /^fix-the-bug-[0-9a-f]{6}$/],
    ['***', /^job-[0-9a-f]{6}$/],
  ])('a job named %s gets a readable id', async ([name, pattern]) => {
    const id = await startJob(host, { name, command: 'true' });
    expect(id).toMatch(pattern as RegExp);
  });

  test('a started job is announced as running, with ways to follow and attach to it', async () => {
    const started = await host.text('tmux_run', { name: 'server', command: 'sleep 30' });
    const id = /^Started (\S+)/.exec(started)?.[1] ?? '';
    expect(started).toContain(`${id}  running  server`);
    expect(started).toContain(`follow: tail -f ${join(world.jobsRoot, id, 'output.log')}`);
    expect(started).toMatch(new RegExp(`attach: tmux -S \\S+\\.sock attach -t ${id}`));
  });
});

describe('tmux_run without a working tmux', () => {
  test('without tmux a job is refused with a way to fix it, and never run another way', async () => {
    vi.stubEnv('PATH', join(world.root, 'empty'));
    await expect(host.call('tmux_run', { name: 'x', command: 'true' })).rejects.toThrow(/needs tmux/);
  });

  test('a tmux that refuses to start the session fails the call with the command it ran', async () => {
    vi.stubEnv('FAKE_TMUX_REFUSE', '1');
    await expect(host.call('tmux_run', { name: 'x', command: 'true' })).rejects.toThrow(/Command failed: tmux -S \S+\.sock new-session/);
  });

  test('a tmux that cannot be executed fails the call with the system error', async () => {
    const dir = join(world.root, 'broken-bin');
    mkdirSync(dir);
    writeFileSync(join(dir, 'tmux'), '#!/bin/sh\n');
    chmodSync(join(dir, 'tmux'), NOT_EXECUTABLE_MODE);
    vi.stubEnv('PATH', dir);
    await expect(host.call('tmux_run', { name: 'x', command: 'true' })).rejects.toThrow(/EACCES/);
  });
});

describe('tmux_jobs list and output', { timeout: JOB_TIMEOUT_MS }, () => {
  test('an empty session lists no jobs', async () => {
    expect(await host.text('tmux_jobs', { action: 'list' })).toBe('No jobs in this session.');
  });

  test('list shows the owner jobs only, oldest first', async () => {
    const other = loadPstack(world, { sessionId: 'someone-else' });
    const first = await startJob(host, { name: 'first', command: 'true' });
    const stranger = await startJob(other, { name: 'stranger', command: 'true' });
    const second = await startJob(host, { name: 'second', command: 'true' });
    const listing = await host.text('tmux_jobs', { action: 'list' });
    expect(listing.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(listing.indexOf(first)).toBeLessThan(listing.indexOf(second));
    expect(listing).not.toContain(stranger);
    await expect(output(stranger)).rejects.toThrow(`No job ${stranger} in this session.`);
  });

  test('output shows the last lines of a command, 80 by default', async () => {
    const id = await startJob(host, { name: 'long', command: `for i in $(seq ${MANY_LINES}); do echo "line $i"; done` });
    await untilExited(host, id);
    const last = await output(id, TAIL_LINES);
    expect(last).toContain(`line ${MANY_LINES}`);
    expect(last).not.toContain(`line ${MANY_LINES - TAIL_LINES}\n`);
    const standard = await output(id);
    expect(standard).toContain(`line ${FIRST_DEFAULT_LINE}\n`);
    expect(standard).not.toContain(`line ${FIRST_DEFAULT_LINE - 1}\n`);
  });
});

describe('tmux_jobs list and output, edge cases', { timeout: JOB_TIMEOUT_MS }, () => {
  test('output of a job that wrote nothing is the job header alone', async () => {
    const id = await startJob(host, { name: 'quiet', command: 'true' });
    await untilExited(host, id);
    expect(await output(id)).toMatch(new RegExp(`^${id}  exited 0  quiet\\n  follow: tail -f \\S+output.log\\n$`));
  });

  test.for(['output', 'stop'])('%s without ids says it needs them', async (action) => {
    await expect(host.call('tmux_jobs', { action })).rejects.toThrow(`${action} needs ids.`);
    await expect(host.call('tmux_jobs', { action, ids: [] })).rejects.toThrow(`${action} needs ids.`);
  });

  test('output of an unknown job id says so', async () => {
    await expect(output('gone')).rejects.toThrow('No job gone in this session.');
  });

  test('a corrupt job.json is skipped, and a job.json missing keys or holding extras is still listed', async () => {
    const id = await startJob(host, { name: 'real', command: 'true' });
    await untilExited(host, id);
    for (const [dir, body] of [
      ['broken', '{'],
      ['null-spec', 'null'],
      ['array-spec', '[]'],
      ['string-spec', '"owner"'],
      ['sparse', JSON.stringify({ id: 'sparse', owner: host.sessionId, future: { nested: [1] }, createdAt: '2000-01-01T00:00:00.000Z' })],
    ] as const) {
      mkdirSync(join(world.jobsRoot, dir));
      writeFileSync(join(world.jobsRoot, dir, 'job.json'), body);
    }
    const listing = await host.text('tmux_jobs', { action: 'list' });
    expect(listing).toContain('sparse  lost');
    expect(listing).toContain(`${id}  exited 0`);
    expect(listing).not.toMatch(/broken|null-spec|array-spec|string-spec/);
    expect(readFileSync(join(world.jobsRoot, 'sparse', 'job.json'), 'utf8')).toContain('"future"');
  });
});
