import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { parseLoopArgs, sentinelFor, slugifyPurpose } from '../src/loop-parse.ts';
import { createWorld, type Host, loadPstack, type World } from './core-host.ts';

const JOB_TIMEOUT_MS = 30_000;
const POLL_MS = 2000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const SECONDS_TEN = 10;
const SECONDS_THIRTY = 30;
const MINUTES_FIVE = 5;
const LONG_PROMPT_CHARS = 60;
const MAX_SLUG_CHARS = 24;
const HOURS_THREE = 3;
const HOURS_TWO = 2;
const DAYS_TWO = 2;
const SLASH_PROMPT = '/foo';
const STOP_HINT = '/loop stop';

const fixed = (intervalSeconds: number, intervalLabel: string, prompt: string, purpose: string) => ({ kind: 'fixed', intervalSeconds, intervalLabel, prompt, purpose });

describe('parseLoopArgs', () => {
  test.each([
    [`5m ${SLASH_PROMPT}`, fixed(MINUTES_FIVE * SECONDS_PER_MINUTE, '5m', SLASH_PROMPT, 'foo')],
    ['30s check status', fixed(SECONDS_THIRTY, '30s', 'check status', 'check-status')],
    ['2h run report', fixed(HOURS_TWO * SECONDS_PER_HOUR, '2h', 'run report', 'run-report')],
    ['1d backup', fixed(SECONDS_PER_DAY, '1d', 'backup', 'backup')],
    ['every 5m check deploy', fixed(MINUTES_FIVE * SECONDS_PER_MINUTE, '5m', 'check deploy', 'check-deploy')],
    ['10 minutes run tests', fixed(SECONDS_TEN * SECONDS_PER_MINUTE, '10m', 'run tests', 'run-tests')],
    ['check deploy every 5m', fixed(MINUTES_FIVE * SECONDS_PER_MINUTE, '5m', 'check deploy', 'check-deploy')],
    ['run tests every 10 minutes', fixed(SECONDS_TEN * SECONDS_PER_MINUTE, '10m', 'run tests', 'run-tests')],
    ['check status every 30 seconds', fixed(SECONDS_THIRTY, '30s', 'check status', 'check-status')],
    ['3 hrs sweep', fixed(HOURS_THREE * SECONDS_PER_HOUR, '3h', 'sweep', 'sweep')],
    ['2 days audit', fixed(DAYS_TWO * SECONDS_PER_DAY, '2d', 'audit', 'audit')],
  ])('reads %s as a fixed interval', (input, expected) => {
    expect(parseLoopArgs(input)).toEqual(expected);
  });

  test('no interval means the agent paces the loop', () => {
    expect(parseLoopArgs('watch the deploy until it is green')).toEqual({ kind: 'dynamic', prompt: 'watch the deploy until it is green', purpose: 'watch-the-deploy-until-i' });
  });

  test('hyphenated words starting with a unit and overflowing counts stay dynamic', () => {
    expect(parseLoopArgs('3d-model check')).toEqual({ kind: 'dynamic', prompt: '3d-model check', purpose: '3d-model-check' });
    expect(parseLoopArgs('10s-timeout audit')).toEqual({ kind: 'dynamic', prompt: '10s-timeout audit', purpose: '10s-timeout-audit' });
    expect(parseLoopArgs('999999999999999d check')).toEqual({ kind: 'dynamic', prompt: '999999999999999d check', purpose: '999999999999999d-check' });
  });

  test('empty input, and an interval with no prompt, show usage', () => {
    expect(parseLoopArgs('   ')).toEqual({ kind: 'usage' });
    expect(parseLoopArgs('5m')).toEqual({ kind: 'usage' });
    expect(parseLoopArgs('every 5m   ')).toEqual({ kind: 'usage' });
  });

  test('list and stop forms', () => {
    expect(parseLoopArgs('list')).toEqual({ kind: 'list' });
    expect(parseLoopArgs('stop')).toEqual({ kind: 'stop', target: 'all' });
    expect(parseLoopArgs('stop all')).toEqual({ kind: 'stop', target: 'all' });
    expect(parseLoopArgs('stop check-deploy')).toEqual({ kind: 'stop', target: 'check-deploy' });
  });
});

describe('purpose names and sentinels', () => {
  test('a slug is lowercase kebab, at most 24 characters, with a fallback', () => {
    expect(slugifyPurpose('Check The Deploy!')).toBe('check-the-deploy');
    expect(slugifyPurpose('a'.repeat(LONG_PROMPT_CHARS))).toHaveLength(MAX_SLUG_CHARS);
    expect(slugifyPurpose('???')).toBe('task');
  });

  test('a sentinel is upper snake case', () => {
    expect(sentinelFor('TICK', 'check-deploy')).toBe('AGENT_LOOP_TICK_CHECK_DEPLOY');
    expect(sentinelFor('WAKE', 'x')).toBe('AGENT_LOOP_WAKE_X');
  });
});

let world: World;
let host: Host;

const tick = () => vi.advanceTimersByTimeAsync(POLL_MS);
const pollWakes = async (): Promise<number> => {
  await tick();
  return host.sendMessage.mock.calls.length;
};
const run = (args: string) => host.command('loop').handler(args, host.ctx());
const jobList = () => host.text('tmux_jobs', { action: 'list' });
const notices = (): string[] => host.notify.mock.calls.map((call) => String(call[0]));
const JobJson = z.object({ wake: z.null(), repeat: z.boolean(), notifyOnOutput: z.object({ pattern: z.string(), reason: z.string(), debounceSeconds: z.number(), notificationLimit: z.number().nullable() }) });
const jobJson = () => {
  const [dir = ''] = readdirSync(world.jobsRoot);
  return JobJson.parse(JSON.parse(readFileSync(join(world.jobsRoot, dir, 'job.json'), 'utf8')));
};

const setupLoopHost = async (): Promise<void> => {
  world = createWorld();
  host = loadPstack(world);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  await host.fire('session_start', {});
};

const teardownLoopHost = (): void => {
  vi.useRealTimers();
  world.dispose();
};

describe('the /loop command: arming and deduplication', { timeout: JOB_TIMEOUT_MS }, () => {
  beforeEach(setupLoopHost);
  afterEach(teardownLoopHost);

  test('describes itself and shows usage for empty input', async () => {
    expect(host.command('loop')).toMatchObject({ description: expect.stringContaining('recurring or self-paced interval') });
    await run('');
    expect(notices()).toEqual(['Usage: /loop [interval] <prompt> (or /loop list, /loop stop [id|all])']);
  });

  test('a fixed interval arms a monitored job and runs the prompt once now', async () => {
    await run('5m check deploy');
    expect(await jobList()).toMatch(/loop-check-deploy-\w+ {2}running {2}loop-check-deploy/);
    expect(jobJson()).toEqual({
      wake: null,
      repeat: false,
      notifyOnOutput: { pattern: '^AGENT_LOOP_TICK_CHECK_DEPLOY\\b.*$', reason: 'Loop every 5m: check deploy', debounceSeconds: MINUTES_FIVE, notificationLimit: null },
    });
    expect(host.sendUserMessage).toHaveBeenCalledTimes(1);
    const message = String(host.sendUserMessage.mock.calls[0]?.[0]);
    expect(message).toContain('check deploy');
    expect(message).toContain('every 5m');
    expect(message).toContain('AGENT_LOOP_TICK_CHECK_DEPLOY');
    expect(message).toContain(STOP_HINT);
  });

  test('the same purpose is not armed twice', async () => {
    await run('5m check deploy');
    await run('10m check deploy');
    expect((await jobList()).match(/^loop-check-deploy-\S+ {2}running/gm)).toHaveLength(1);
    expect(host.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(notices().at(-1)).toContain('already running');
  });
});

describe('the /loop command: ticks, list, stop, dynamic, completions', { timeout: JOB_TIMEOUT_MS }, () => {
  beforeEach(setupLoopHost);
  afterEach(teardownLoopHost);

  test('a tick wakes the session, and list then stop end the loop with no stray wake', async () => {
    await run('1s check deploy');
    await expect.poll(pollWakes, { timeout: JOB_TIMEOUT_MS }).toBe(1);
    const wakeText = String(host.sendMessage.mock.calls[0]?.[0].content);
    expect(wakeText).toContain('Loop every 1s: check deploy');
    expect(wakeText).toContain('"prompt":"check deploy"');
    await run('list');
    expect(notices().at(-1)).toMatch(/loop-check-deploy-\w+ {2}Loop every 1s: check deploy/);
    await run('stop check-deploy');
    expect(notices().at(-1)).toContain('Stopped 1 loop job(s)');
    await tick();
    await tick();
    expect(host.sendMessage).toHaveBeenCalledTimes(1);
    await run('list');
    expect(notices().at(-1)).toBe('No active loops in this session.');
  });

  test('stop with nothing running says so, and stop all ends every loop', async () => {
    await run('stop all');
    expect(notices().at(-1)).toContain('No running loop matches all');
    await run('5m one');
    await run('5m two');
    await run('stop all');
    expect(notices().at(-1)).toContain('Stopped 2 loop job(s)');
  });

  test('no interval sends the dynamic schedule instructions and starts no job', async () => {
    await run('keep an eye on the deploy');
    expect(await jobList()).toBe('No jobs in this session.');
    const message = String(host.sendUserMessage.mock.calls[0]?.[0]);
    expect(message).toContain('Dynamic Schedule');
    expect(message).toContain('notify_on_output');
    expect(message).toContain('AGENT_LOOP_WAKE_KEEP_AN_EYE_ON_THE_DEPLO');
  });

  test('completions offer the forms, and after stop the running loops', async () => {
    const complete = (prefix: string) => (host.command('loop').getArgumentCompletions?.(prefix) ?? []).map((item) => item.value);
    expect(complete('')).toEqual(['30s ', '1m ', '5m ', '15m ', '1h ', 'list', 'stop ']);
    expect(complete('s')).toEqual(['stop ']);
    await run('5m check deploy');
    const stops = complete('stop ');
    expect(stops).toContain('stop all');
    expect(stops).toContain('stop loop-check-deploy');
    expect(complete('zzz')).toEqual([]);
  });
});

describe('the /loop command: isolation from manual tmux_run jobs', { timeout: JOB_TIMEOUT_MS }, () => {
  beforeEach(setupLoopHost);
  afterEach(teardownLoopHost);

  test('a manual tmux_run job whose name starts with loop- is not listed or stopped by /loop', async () => {
    await host.text('tmux_run', { name: 'loop-manual', command: 'sleep 60' });
    await run('list');
    expect(notices().at(-1)).toBe('No active loops in this session.');
    await run('stop all');
    expect(notices().at(-1)).toContain('No running loop matches all');
    expect(await jobList()).toMatch(/loop-manual-\w+ {2}running {2}loop-manual/);
  });
});
