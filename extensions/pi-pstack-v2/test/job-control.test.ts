import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createWorld, driveTimers, type Host, loadPstack, outputBlock, startJob, untilExited, type World } from './core-host.ts';

const JOB_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 10_000;
const WAIT_SHORT_SECONDS = 30;
const DEFAULT_WAIT_MS = 300_000;
const ONE_SECOND_MS = 1000;
const JUST_PAST_DEFAULT_WAIT_MS = DEFAULT_WAIT_MS + ONE_SECOND_MS;
const STOPPED_CODE = 143;
const POLL_MS = 2000;

let world: World;
let host: Host;

beforeEach(() => {
  world = createWorld();
  host = loadPstack(world);
});

afterEach(() => {
  vi.useRealTimers();
  world.dispose();
});

const list = () => host.text('tmux_jobs', { action: 'list' });
const jobFile = (id: string, name: string) => join(world.jobsRoot, id, name);
const fileText = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : '');
const untilFile = async (path: string): Promise<void> => {
  await expect.poll(() => existsSync(path), { timeout: POLL_TIMEOUT_MS }).toBe(true);
};
/** Signal 0 only checks that the process exists, and it throws when there is none. */
const isAlive = (pid: number): Promise<boolean> =>
  Promise.resolve()
    .then(() => process.kill(pid, 0))
    .then(
      () => true,
      () => false,
    );

/** Ends the job's wrapper the hard way, so the job is left with no session and no recorded exit. */
const killWrapper = async (id: string) => {
  await untilFile(jobFile(id, 'wrapper.pid'));
  process.kill(Number(fileText(jobFile(id, 'wrapper.pid'))), 'SIGKILL');
  // Without its wrapper the tail that mirrors the output into the session pane would run on, so the pane is closed too.
  spawnSync('pkill', ['-f', `tail -n .1 -f ${jobFile(id, 'output.log')}`], { windowsHide: true });
  await expect.poll(() => isAlive(Number(fileText(jobFile(id, 'wrapper.pid')))), { timeout: POLL_TIMEOUT_MS }).toBe(false);
};

describe('tmux_jobs stop', { timeout: JOB_TIMEOUT_MS }, () => {
  test('stop ends a running job, records that it was stopped, and does not wake the session', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'server', command: 'sleep 30', wake: 'Done.' });
    expect(await list()).toContain('running');
    expect(await host.text('tmux_jobs', { action: 'stop', ids: [id] })).toBe(`Stopped ${id}.`);
    expect(await list()).toContain(`${id}  exited ${STOPPED_CODE}`);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(host.sendMessage).not.toHaveBeenCalled();
  });

  test('a job that ignores TERM is still ended by stop', async () => {
    const pidFile = join(world.cwd, 'stubborn.pid');
    const id = await startJob(host, { name: 'stubborn', command: "trap '' TERM; echo $$ > stubborn.pid; while :; do sleep 0.2; done" });
    await untilFile(pidFile);
    await host.text('tmux_jobs', { action: 'stop', ids: [id] });
    expect(await isAlive(Number(fileText(pidFile)))).toBe(false);
    expect(await list()).toContain(`${id}  exited ${STOPPED_CODE}`);
  });

  test('stop records the stopped code itself when the job wrapper is already gone', async () => {
    const id = await startJob(host, { name: 'orphan', command: 'sleep 5' });
    await killWrapper(id);
    expect(await list()).toContain(`${id}  lost`);
    await host.text('tmux_jobs', { action: 'stop', ids: [id] });
    expect(await list()).toContain(`${id}  exited ${STOPPED_CODE}`);
  });

  test('stopping a heartbeat by its first id stops the later runs too', async () => {
    const first = await startJob(host, { name: 'tick', command: 'exit 0', wake: 'Tick.', repeat: true });
    await untilExited(host, first);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await host.fire('session_start', {});
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
    const runs = await list();
    expect(runs.match(/tick/g)?.length).toBeGreaterThan(1);
    expect(await host.text('tmux_jobs', { action: 'stop', ids: [first] })).toMatch(new RegExp(`^Stopped ${first}, `));
    expect(await list()).not.toContain('running');
  });
});

describe('a job whose process group outlives the command', { timeout: JOB_TIMEOUT_MS }, () => {
  test('a child left running when the job exits is ended with it', async () => {
    const pidFile = join(world.cwd, 'child.pid');
    const id = await startJob(host, { name: 'leaver', command: '(sleep 30) & echo $! > child.pid; exit 0' });
    await untilExited(host, id);
    await expect.poll(() => isAlive(Number(fileText(pidFile))), { timeout: POLL_TIMEOUT_MS }).toBe(false);
  });

  test('a job whose tmux server dies records the stopped code and leaves no wrapper behind', async () => {
    const id = await startJob(host, { name: 'doomed', command: 'sleep 30' });
    await untilFile(jobFile(id, 'wrapper.pid'));
    const wrapper = Number(fileText(jobFile(id, 'wrapper.pid')));
    await host.fire('session_shutdown', {}, { mode: 'print', hasUI: false });
    await untilExited(host, id);
    expect(await list()).toContain(`${id}  exited ${STOPPED_CODE}`);
    await expect.poll(() => isAlive(wrapper), { timeout: POLL_TIMEOUT_MS }).toBe(false);
  });

  test('Ctrl-C in the attached session stops the job, which records that it was stopped', async () => {
    const id = await startJob(host, { name: 'interrupt', command: 'touch ready; sleep 30' });
    await untilFile(join(world.cwd, 'ready'));
    const attach = /attach: (tmux -S \S+\.sock) attach/.exec(await list())?.[1] ?? '';
    const [command, ...args] = attach.split(' ');
    spawnSync(command ?? 'tmux', [...args, 'send-keys', '-t', id, 'C-c'], { windowsHide: true });
    await untilFile(jobFile(id, 'exit'));
    expect(fileText(jobFile(id, 'exit'))).toBe(String(STOPPED_CODE));
  });

  test("a job's output shows live in its tmux session", async () => {
    const id = await startJob(host, { name: 'live', command: 'echo live-in-pane; sleep 30' });
    const attach = /attach: (tmux -S \S+\.sock) attach/.exec(await list())?.[1] ?? '';
    const [command, ...args] = attach.split(' ');
    await expect.poll(() => spawnSync(command ?? 'tmux', [...args, 'capture-pane', '-p', '-t', id], { encoding: 'utf8', windowsHide: true }).stdout, { timeout: POLL_TIMEOUT_MS }).toContain('live-in-pane');
  });
});

describe('tmux_jobs wait', { timeout: JOB_TIMEOUT_MS }, () => {
  test('wait returns the report of a finished job and suppresses its wake', async () => {
    const id = await startJob(host, { name: 'quick', command: 'echo waited-output', wake: 'Next.' });
    await untilExited(host, id);
    const report = await host.text('tmux_jobs', { action: 'wait', ids: [id], timeout_seconds: WAIT_SHORT_SECONDS });
    expect(report).toContain(`tmux job quick (${id}) exited with code 0`);
    expect(report).toContain('Next.');
    expect(report).toContain(outputBlock('waited-output'));
    expect(host.sendMessage).not.toHaveBeenCalled();
  });

  test('wait blocks until a running job exits, telling the user it is waiting', async () => {
    const id = await startJob(host, { name: 'slow', command: 'sleep 0.3; echo finished-late', wake: 'Slow.' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const onUpdate = vi.fn<(partial: unknown) => void>();
    const report = await driveTimers(host.call('tmux_jobs', { action: 'wait', ids: [id] }, {}, undefined, onUpdate));
    expect(report.content[0]?.text).toContain('finished-late');
    expect(JSON.stringify(onUpdate.mock.calls)).toContain('Waiting on 1 job(s)...');
  });

  test('wait with no ids covers jobs with a wake, and skips servers and heartbeats that never exit on their own', async () => {
    await startJob(host, { name: 'server', command: 'sleep 30' });
    await startJob(host, { name: 'heartbeat', command: 'sleep 30', wake: 'Tick.', repeat: true });
    await startJob(host, { name: 'build', command: 'sleep 0.3; echo built-output', wake: 'Built.' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const report = await driveTimers(host.text('tmux_jobs', { action: 'wait', timeout_seconds: WAIT_SHORT_SECONDS }));
    expect(report).toContain('built-output');
    expect(report).not.toContain('still running');
    expect(await host.text('tmux_jobs', { action: 'wait' })).toBe('No jobs to wait on.');
  });
});

describe('tmux_jobs wait hands the turn back', { timeout: JOB_TIMEOUT_MS }, () => {
  test('wait hands the turn back as soon as the user sends a message', async () => {
    await startJob(host, { name: 'slow', command: 'sleep 30', wake: 'Slow.' });
    const report = await host.text('tmux_jobs', { action: 'wait', timeout_seconds: WAIT_SHORT_SECONDS }, { hasPendingMessages: () => true });
    expect(report).toContain('still running');
  });

  test('wait hands the turn back when the call is aborted', async () => {
    const id = await startJob(host, { name: 'slow', command: 'sleep 30', wake: 'Slow.' });
    const aborted = AbortSignal.abort();
    const result = await host.call('tmux_jobs', { action: 'wait', ids: [id], timeout_seconds: WAIT_SHORT_SECONDS }, {}, aborted);
    expect(result.content[0]?.text).toContain('still running');
  });

  test('wait without a timeout hands the turn back after five minutes, not thirty', async () => {
    await startJob(host, { name: 'slow', command: 'sleep 30', wake: 'Slow.' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const waiting = host.text('tmux_jobs', { action: 'wait' });
    await vi.advanceTimersByTimeAsync(JUST_PAST_DEFAULT_WAIT_MS);
    expect(await waiting).toContain('still running');
  });

  test('wait reports a job whose wrapper was lost without an exit code', async () => {
    const id = await startJob(host, { name: 'vanished', command: 'sleep 5', wake: 'Gone.' });
    await killWrapper(id);
    const report = await host.text('tmux_jobs', { action: 'wait', ids: [id] });
    expect(report).toContain('was lost (its tmux session ended without an exit code)');
  });

  test('wait reports a job the watcher already delivered plainly, without delivering it twice', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'once', command: 'echo seen', wake: 'Once.' });
    await untilExited(host, id);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
    const report = await host.text('tmux_jobs', { action: 'wait', ids: [id] });
    expect(report).toContain('exited with code 0');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
  });
});
