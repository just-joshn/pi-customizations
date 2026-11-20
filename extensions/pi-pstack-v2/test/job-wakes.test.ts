import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createWorld, driveTimers, type Host, loadPstack, outputBlock, startJob, untilExited, type World } from './core-host.ts';

const JOB_TIMEOUT_MS = 30_000;
const POLL_MS = 2000;
const STOPPED_CODE = 143;
const PRINT_MODE = { mode: 'print', hasUI: false };
const BUSY_PRINT_MODE = { ...PRINT_MODE, isIdle: () => false };
const TICK_JOBS = /^tick-\S+ {2}/gm;
const STEER_WAKE = { triggerTurn: true, deliverAs: 'steer' };

let world: World;
let host: Host;

beforeEach(() => {
  world = createWorld();
  host = loadPstack(world);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
  world.dispose();
});

const tick = () => vi.advanceTimersByTimeAsync(POLL_MS);
const list = () => host.text('tmux_jobs', { action: 'list' });
const lastMessage = () => host.sendMessage.mock.lastCall as [{ content: string; customType: string; display: boolean }, unknown];

describe('an interactive session is woken when a job exits', { timeout: JOB_TIMEOUT_MS }, () => {
  test('once, with the wake message and output, between tool calls rather than after the whole run', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'echo', command: 'echo watched-output', wake: 'Re-check CI.' });
    await untilExited(host, id);
    await tick();
    await tick();
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
    const [message, options] = lastMessage();
    expect(message).toMatchObject({ customType: 'pstack-job', display: true });
    expect(message.content).toContain(`tmux job echo (${id}) exited with code 0`);
    expect(message.content).toContain('Re-check CI.');
    expect(message.content).toContain(outputBlock('watched-output'));
    expect(options).toEqual(STEER_WAKE);
  });

  test('a job started without a wake never wakes the session', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'quiet', command: 'true' });
    await untilExited(host, id);
    await tick();
    expect(host.sendMessage).not.toHaveBeenCalled();
  });

  test('a job its tmux server ended wakes the session with the stopped code', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'vanish', command: 'sleep 30', wake: 'Gone.' });
    await host.fire('session_shutdown', {}, PRINT_MODE);
    await untilExited(host, id);
    await host.fire('session_start', {});
    await tick();
    expect(lastMessage()[0].content).toContain(`exited with code ${STOPPED_CODE}`);
  });
});

describe('the footer and watcher of an interactive session', { timeout: JOB_TIMEOUT_MS }, () => {
  test('the footer counts running jobs and clears when none run', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'brief', command: 'while [ ! -f go ]; do sleep 0.1; done', wake: 'Brief.' });
    await tick();
    expect(host.setStatus).toHaveBeenLastCalledWith('pstack', 'tmux jobs: 1 running');
    writeFileSync(join(world.cwd, 'go'), '');
    await untilExited(host, id);
    await tick();
    expect(host.setStatus).toHaveBeenLastCalledWith('pstack', undefined);
  });

  test('without a UI the watcher still wakes the session and sets no footer', async () => {
    const headless = { mode: 'rpc', hasUI: false };
    await host.fire('session_start', {}, headless);
    const id = await startJob(host, { name: 'rpc', command: 'echo ok', wake: 'Ok.' }, headless);
    await untilExited(host, id, headless);
    await tick();
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
    expect(host.setStatus).not.toHaveBeenCalled();
  });
});

describe('a watcher that fails or is replaced', { timeout: JOB_TIMEOUT_MS }, () => {
  test('a watcher failure is shown to the user and the watcher keeps polling', async () => {
    mkdirSync(join(world.agentDir, 'pstack-v2'), { recursive: true });
    writeFileSync(world.jobsRoot, 'not a directory');
    await host.fire('session_start', {});
    await tick();
    expect(host.notify).toHaveBeenCalledWith(expect.stringContaining('pstack job watcher:'), 'error');
    await tick();
    expect(host.notify).toHaveBeenCalledTimes(2);
  });

  test('a watcher failure with no UI is silent', async () => {
    mkdirSync(join(world.agentDir, 'pstack-v2'), { recursive: true });
    writeFileSync(world.jobsRoot, 'not a directory');
    await host.fire('session_start', {}, { hasUI: false });
    await tick();
    expect(host.notify).not.toHaveBeenCalled();
  });

  test('after the session shuts down no more wakes arrive, and jobs keep running for the next session', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'late', command: 'sleep 0.3; echo late', wake: 'Late.' });
    await host.fire('session_shutdown', {});
    await expect.poll(() => list(), { timeout: JOB_TIMEOUT_MS }).toContain(`${id}  exited 0`);
    await tick();
    expect(host.sendMessage).not.toHaveBeenCalled();
    await host.fire('session_start', {});
    await tick();
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('starting a session again replaces the watcher instead of doubling the wakes', async () => {
    await host.fire('session_start', {});
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'twice', command: 'echo x', wake: 'Twice.' });
    await untilExited(host, id);
    await tick();
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('a heartbeat wakes the session on each clean exit', { timeout: JOB_TIMEOUT_MS }, () => {
  test('a clean exit wakes once and the next run starts, so the heartbeat keeps going', async () => {
    await host.fire('session_start', {});
    const first = await startJob(host, { name: 'tick', command: 'echo beat', wake: 'Tick.', repeat: true });
    await untilExited(host, first);
    await tick();
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
    expect(lastMessage()[0].content).not.toContain('not restarted');
    expect((await list()).match(TICK_JOBS)).toHaveLength(2);
  });

  test('a failing heartbeat wakes once and is not restarted', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'tick', command: 'exit 1', wake: 'Tick.', repeat: true });
    await untilExited(host, id);
    await tick();
    await tick();
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
    expect(lastMessage()[0].content).toContain('This heartbeat did not exit cleanly, so it was not restarted.');
    expect((await list()).match(TICK_JOBS)).toHaveLength(1);
  });

  test('a heartbeat that cannot be restarted says why, and still reports the finished run', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'tick', command: 'echo beat', wake: 'Tick.', repeat: true });
    await untilExited(host, id);
    vi.stubEnv('PATH', join(world.root, 'no-tmux-here'));
    await tick();
    const { content } = lastMessage()[0];
    expect(content).toContain('exited with code 0');
    expect(content).toContain('This heartbeat could not be restarted: pstack needs tmux');
  });

  test('wait on a heartbeat returns its tick and the heartbeat keeps running', async () => {
    const first = await startJob(host, { name: 'tick', command: 'exit 0', wake: 'Tick.', repeat: true });
    await untilExited(host, first);
    const report = await host.text('tmux_jobs', { action: 'wait', ids: [first] });
    expect(report).toContain('exited with code 0');
    expect((await list()).match(TICK_JOBS)).toHaveLength(2);
    expect(host.sendMessage).not.toHaveBeenCalled();
  });
});

describe('a print-mode run is kept alive until its jobs report', { timeout: JOB_TIMEOUT_MS }, () => {
  test('a busy print-mode worker hears about a finished job while it works', async () => {
    await host.fire('session_start', {}, BUSY_PRINT_MODE);
    const id = await startJob(host, { name: 'probe', command: 'echo probe-output', wake: 'Probe done.' }, BUSY_PRINT_MODE);
    await untilExited(host, id, BUSY_PRINT_MODE);
    await tick();
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
    expect(lastMessage()[0].content).toContain('probe-output');
  });

  test('an idle print-mode run is not woken between turns, since settling delivers instead', async () => {
    await host.fire('session_start', {}, PRINT_MODE);
    const id = await startJob(host, { name: 'probe', command: 'echo probe-output', wake: 'Probe done.' }, PRINT_MODE);
    await untilExited(host, id, PRINT_MODE);
    await tick();
    expect(host.sendMessage).not.toHaveBeenCalled();
  });

  test('settling waits for running jobs, continues the run with their reports, and leaves delivery to itself', async () => {
    const id = await startJob(host, { name: 'late', command: 'sleep 0.3; echo late-output', wake: 'Late.' }, PRINT_MODE);
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout'] });
    await host.fire('session_start', {}, BUSY_PRINT_MODE);
    const prior = { type: 'message' };
    const settled = (await driveTimers(host.fire('agent_before_settle', { entries: [prior] }, BUSY_PRINT_MODE))) as { entries: Record<string, unknown>[]; continue: boolean };
    expect(settled.continue).toBe(true);
    expect(settled.entries[0]).toBe(prior);
    expect(settled.entries[1]).toMatchObject({ type: 'custom_message', customType: 'pstack-job', display: true });
    expect(String(settled.entries[1]?.['content'])).toContain(`tmux job late (${id}) exited with code 0`);
    expect(String(settled.entries[1]?.['content'])).toContain('late-output');
    expect(host.sendMessage).not.toHaveBeenCalled();
  });
});

describe('settling and shutdown of a print-mode run', { timeout: JOB_TIMEOUT_MS }, () => {
  test('settling has nothing to add when no job is waiting, or when the session is interactive', async () => {
    expect(await host.fire('agent_before_settle', { entries: [] }, PRINT_MODE)).toBeUndefined();
    await startJob(host, { name: 'late', command: 'sleep 5', wake: 'Late.' });
    expect(await host.fire('agent_before_settle', { entries: [] })).toBeUndefined();
  });

  test('settling does not wait for heartbeats or servers, which never exit on their own', async () => {
    await startJob(host, { name: 'server', command: 'sleep 5' }, PRINT_MODE);
    await startJob(host, { name: 'tick', command: 'sleep 5', wake: 'Tick.', repeat: true }, PRINT_MODE);
    expect(await host.fire('agent_before_settle', { entries: [] }, PRINT_MODE)).toBeUndefined();
  });

  test('a print-mode worker ends its leftover jobs at shutdown, and an interactive session leaves them', async () => {
    const mine = await startJob(host, { name: 'dev-server', command: 'sleep 30' });
    await host.fire('session_shutdown', {});
    expect(await list()).toContain(`${mine}  running`);
    await host.fire('session_shutdown', {}, PRINT_MODE);
    await untilExited(host, mine);
    expect(await list()).toContain(`${mine}  exited ${STOPPED_CODE}`);
  });
});
