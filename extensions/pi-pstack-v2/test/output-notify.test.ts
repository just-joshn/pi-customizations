import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  advanceOutputNotification,
  CHUNK_CHARS,
  DEFAULT_NOTIFICATION_LIMIT,
  initialOutputNotificationState,
  MAX_PATTERN_LENGTH,
  type OutputNotification,
  type OutputNotificationConfig,
  type OutputNotificationState,
  validateOutputNotificationConfig,
} from '../src/output-notify.ts';
import { createWorld, type Host, loadPstack, startJob, untilExited, type World } from './core-host.ts';

const JOB_TIMEOUT_MS = 30_000;
const POLL_MS = 2000;
const DEBOUNCE_MS = 5000;
const JUST_BEFORE_DEBOUNCE_MS = 4999;
const LONG_MATCH_CHARS = 6000;
const CUSTOM_LIMIT = 3;
const BATCH_THREE = 3;
const TWO_MATCHES = 2;
const BULK_MATCHES = 150;
const SLICE_OVERFLOW_CHARS = 100;
const OVERSIZE_PATTERN_CHARS = MAX_PATTERN_LENGTH + 1;
const PAST_LAST_SLICE_CHARS = CHUNK_CHARS + SLICE_OVERFLOW_CHARS;
const FRACTIONAL_LIMIT = 1.5;
const OVER_POLL_CAP_BYTES = 4_194_368;
const ASCII_A = 0x61;
const TRUNCATED_UTF8_LEAD = 0xe2;

type Step = { chunk: string; nowMs: number; finished?: boolean };
type Run = { state: OutputNotificationState; notifications: OutputNotification[] };

const config = (overrides: Partial<OutputNotificationConfig> = {}): OutputNotificationConfig => ({ pattern: '^ERR', ...overrides });
const lines = (count: number, text = 'ERR'): string => `${text}\n`.repeat(count);

/** Feeds each step to the transition in order, collecting every notification it returns. */
const run = (cfg: OutputNotificationConfig, steps: Step[]): Run =>
  steps.reduce<Run>(
    (acc, step) => {
      const next = advanceOutputNotification(acc.state, cfg, step.chunk, { jobId: 'job', outputPath: 'out.log', nowMs: step.nowMs, finished: step.finished ?? false });
      return { state: next.nextState, notifications: [...acc.notifications, ...next.notifications] };
    },
    { state: initialOutputNotificationState, notifications: [] },
  );

describe('validateOutputNotificationConfig', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('accepts a usable config', () => {
    expect(() => validateOutputNotificationConfig(config({ debounceSeconds: 0, notificationLimit: 1 }))).not.toThrow();
  });

  test.each([
    ['an empty pattern', config({ pattern: '   ' }), /must not be empty/],
    ['an over-long pattern', config({ pattern: 'a'.repeat(OVERSIZE_PATTERN_CHARS) }), /at most 500/],
    ['an invalid regular expression', config({ pattern: '(' }), /not a valid regular expression/],
    ['a negative debounce', config({ debounceSeconds: -1 }), /debounce_seconds/],
    ['a non-finite debounce', config({ debounceSeconds: Number.POSITIVE_INFINITY }), /debounce_seconds/],
    ['a zero limit', config({ notificationLimit: 0 }), /notification_limit/],
    ['a fractional limit', config({ notificationLimit: FRACTIONAL_LIMIT }), /notification_limit/],
  ])('rejects %s', (_name, bad, message) => {
    expect(() => validateOutputNotificationConfig(bad)).toThrow(message);
  });
});

describe('advanceOutputNotification: matching and debouncing', () => {
  test('the first match notifies at once with its text', () => {
    const { notifications } = run(config(), [{ chunk: `quiet\n${lines(1)}`, nowMs: 0 }]);
    expect(notifications).toEqual([{ taskId: 'job:task_progress:1', title: 'Shell output contains /^ERR/', detail: 'Matched text: ERR', outputPath: 'out.log' }]);
  });

  test('a reason becomes the title', () => {
    const { notifications } = run(config({ reason: 'Watching builds' }), [{ chunk: lines(1), nowMs: 0 }]);
    expect(notifications[0]?.title).toBe('Watching builds');
  });

  test('later matches batch until the debounce passes, with a floor of five seconds', () => {
    const cfg = config({ debounceSeconds: 1 });
    const early = run(cfg, [
      { chunk: lines(BATCH_THREE), nowMs: 0 },
      { chunk: '', nowMs: JUST_BEFORE_DEBOUNCE_MS },
    ]);
    expect(early.notifications).toHaveLength(1);
    const due = run(cfg, [
      { chunk: lines(BATCH_THREE), nowMs: 0 },
      { chunk: '', nowMs: JUST_BEFORE_DEBOUNCE_MS },
      { chunk: '', nowMs: DEBOUNCE_MS },
    ]);
    expect(due.notifications).toHaveLength(TWO_MATCHES);
    expect(due.notifications[1]?.detail).toContain('Latest match: ERR');
    expect(due.notifications[1]?.taskId).toBe('job:task_progress:2');
    expect(due.state.pendingBatch).toBeNull();
  });

  test('a match split across chunks is found once, and a match seen twice is not repeated', () => {
    const split = run({ pattern: 'ABCDEF' }, [
      { chunk: 'xxABC', nowMs: 0 },
      { chunk: 'DEFyy', nowMs: 1 },
    ]);
    expect(split.state.matchedOccurrences).toBe(1);
    const repeated = run({ pattern: 'AB' }, [
      { chunk: 'AB', nowMs: 0 },
      { chunk: 'CD', nowMs: 1 },
    ]);
    expect(repeated.state.matchedOccurrences).toBe(1);
  });
});

describe('advanceOutputNotification: limits, truncation, and finish', () => {
  test('a chunk longer than one slice is still scanned to its end', () => {
    const { state } = run({ pattern: 'END' }, [{ chunk: `${'a'.repeat(PAST_LAST_SLICE_CHARS)}END`, nowMs: 0 }]);
    expect(state.matchedOccurrences).toBe(1);
  });

  test('a match over 5,000 characters is omitted from the detail', () => {
    const { notifications } = run({ pattern: 'x+' }, [{ chunk: 'x'.repeat(LONG_MATCH_CHARS), nowMs: 0 }]);
    expect(notifications[0]?.detail).toContain('omitted');
    expect(notifications[0]?.detail).not.toContain('xxxxx');
  });

  test('a custom limit flushes the batch, says so, and then stays silent', () => {
    const cfg = config({ notificationLimit: CUSTOM_LIMIT });
    const hit = run(cfg, [{ chunk: lines(CUSTOM_LIMIT + TWO_MATCHES), nowMs: 0 }]);
    expect(hit.notifications.map((n) => n.title)).toEqual([expect.any(String), expect.any(String), `Notification limit reached (${CUSTOM_LIMIT})`]);
    expect(hit.notifications[TWO_MATCHES]?.detail).toContain(`matched ${CUSTOM_LIMIT} times`);
    expect(hit.notifications[TWO_MATCHES]?.detail).toContain('out.log');
    expect(hit.state.limitReached).toBe(true);
    const after = run(cfg, [
      { chunk: lines(CUSTOM_LIMIT + TWO_MATCHES), nowMs: 0 },
      { chunk: lines(BULK_MATCHES), nowMs: DEBOUNCE_MS * TWO_MATCHES, finished: true },
    ]);
    expect(after.notifications).toHaveLength(hit.notifications.length);
  });

  test('the default limit is 100', () => {
    const { notifications, state } = run(config(), [{ chunk: lines(BULK_MATCHES), nowMs: 0 }]);
    expect(state.matchedOccurrences).toBe(DEFAULT_NOTIFICATION_LIMIT);
    expect(notifications.at(-1)?.title).toBe(`Notification limit reached (${DEFAULT_NOTIFICATION_LIMIT})`);
  });

  test('a finished job flushes what is pending at once', () => {
    const { notifications } = run(config(), [
      { chunk: lines(TWO_MATCHES), nowMs: 0 },
      { chunk: '', nowMs: 1, finished: true },
    ]);
    expect(notifications).toHaveLength(TWO_MATCHES);
    expect(notifications[1]?.detail).toContain('Latest match');
  });

  test('notificationLimit null never caps notifications', () => {
    const { notifications, state } = run(config({ notificationLimit: null }), [{ chunk: lines(BULK_MATCHES), nowMs: 0, finished: true }]);
    expect(state.matchedOccurrences).toBe(BULK_MATCHES);
    expect(state.limitReached).toBe(false);
    expect(notifications.some((n) => n.title.startsWith('Notification limit reached'))).toBe(false);
  });
});

let world: World;
let host: Host;

const tick = () => vi.advanceTimersByTimeAsync(POLL_MS);
const messageCount = () => host.sendMessage.mock.calls.length;
const pollMessages = async (): Promise<number> => {
  await tick();
  return messageCount();
};

describe('tmux_run with notify_on_output', { timeout: JOB_TIMEOUT_MS }, () => {
  beforeEach(() => {
    world = createWorld();
    host = loadPstack(world);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    world.dispose();
  });

  test('a matching line wakes the session, and stopping the job ends the wakes cleanly', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'watcher', command: 'echo MATCH one; sleep 60', notify_on_output: { pattern: '^MATCH', reason: 'Watching for MATCH' } });
    await expect.poll(pollMessages, { timeout: JOB_TIMEOUT_MS }).toBe(1);
    const [message, options] = host.sendMessage.mock.lastCall ?? [];
    expect(message).toMatchObject({ customType: 'pstack-job', display: true });
    expect(String(message.content)).toContain(`tmux job watcher (${id}) output match [${id}:task_progress:1]: Watching for MATCH`);
    expect(String(message.content)).toContain('Matched text: MATCH');
    expect(options).toEqual({ triggerTurn: true, deliverAs: 'steer' });
    expect(await host.text('tmux_jobs', { action: 'stop', ids: [id] })).toContain(id);
    await tick();
    await tick();
    expect(messageCount()).toBe(1);
  });

  test('an invalid notify_on_output pattern is refused before the job starts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(host.text('tmux_run', { name: 'bad', command: 'true', notify_on_output: { pattern: '(' } })).rejects.toThrow(/not a valid regular expression/);
    expect(await host.text('tmux_jobs', { action: 'list' })).toBe('No jobs in this session.');
    vi.restoreAllMocks();
  });

  test('a watcher is left out of a default wait, which would never end', async () => {
    await startJob(host, { name: 'watcher', command: 'sleep 60', wake: 'Gone.', notify_on_output: { pattern: 'never' } });
    expect(await host.text('tmux_jobs', { action: 'wait', timeout_seconds: 1 })).toBe('No jobs to wait on.');
  });
});

const NotifyStateOffset = z.object({ byteOffset: z.number(), limitReached: z.boolean() });
const readNotifyState = (jobDir: string) => NotifyStateOffset.parse(JSON.parse(readFileSync(join(jobDir, 'notify-state.json'), 'utf8')));

describe('notify_on_output lifecycle and resilience regressions', { timeout: JOB_TIMEOUT_MS }, () => {
  beforeEach(() => {
    world = createWorld();
    host = loadPstack(world);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    world.dispose();
  });

  test('an exited notify_on_output job with no wake marks itself done after flushing', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'short', command: 'echo MATCH', notify_on_output: { pattern: '^MATCH' } });
    await untilExited(host, id);
    await tick();
    expect(messageCount()).toBe(1);
    expect(existsSync(join(world.jobsRoot, id, 'woken'))).toBe(true);
  });

  test('a corrupt notify-state.json recovers cleanly instead of crashing every watcher tick', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'corrupt', command: 'echo MATCH; sleep 60', notify_on_output: { pattern: '^MATCH' } });
    writeFileSync(join(world.jobsRoot, id, 'notify-state.json'), '{not valid json');
    await expect.poll(pollMessages, { timeout: JOB_TIMEOUT_MS }).toBe(1);
    expect(host.notify).not.toHaveBeenCalledWith(expect.stringContaining('pstack job watcher'), 'error');
  });

  test('once notification_limit is reached, further output is neither read nor rescanned', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'capped', command: 'echo MATCH; sleep 60', notify_on_output: { pattern: '^MATCH', notification_limit: 1 } });
    await expect.poll(pollMessages, { timeout: JOB_TIMEOUT_MS }).toBe(TWO_MATCHES);
    const jobDir = join(world.jobsRoot, id);
    const before = readNotifyState(jobDir);
    expect(before.limitReached).toBe(true);
    appendFileSync(join(jobDir, 'output.log'), 'MATCH again\nMATCH again\n');
    await tick();
    expect(readNotifyState(jobDir).byteOffset).toBe(before.byteOffset);
  });

  test('a partial line without a trailing newline waits until completed so it notifies once', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'partial', command: 'echo ready; sleep 60', notify_on_output: { pattern: '^TICK\\b.*$' } });
    const outPath = join(world.jobsRoot, id, 'output.log');
    await expect.poll(() => existsSync(outPath) && readFileSync(outPath, 'utf8').includes('ready'), { timeout: JOB_TIMEOUT_MS }).toBe(true);
    appendFileSync(outPath, 'TICK {"part":');
    await tick();
    expect(messageCount()).toBe(0);
    appendFileSync(outPath, '1}\n');
    await tick();
    expect(messageCount()).toBe(1);
    expect(String(host.sendMessage.mock.calls[0]?.[0].content)).toContain('TICK {"part":1}');
  });
});

describe('notify_on_output boundary drain regressions', { timeout: JOB_TIMEOUT_MS }, () => {
  beforeEach(() => {
    world = createWorld();
    host = loadPstack(world);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    world.dispose();
  });

  test('an exited job ending on a truncated UTF-8 lead byte still catches up and marks done', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'utf8', command: 'true', notify_on_output: { pattern: '^MATCH' } });
    await untilExited(host, id);
    writeFileSync(join(world.jobsRoot, id, 'output.log'), Buffer.concat([Buffer.from('MATCH\n'), Buffer.from([TRUNCATED_UTF8_LEAD])]));
    await tick();
    expect(messageCount()).toBe(1);
    expect(existsSync(join(world.jobsRoot, id, 'woken'))).toBe(true);
  });

  test('a running job with a line larger than the 4 MiB poll cap still advances to later matches', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'longline', command: 'echo ready; sleep 60', notify_on_output: { pattern: '^MATCH' } });
    const outPath = join(world.jobsRoot, id, 'output.log');
    await expect.poll(() => existsSync(outPath) && readFileSync(outPath, 'utf8').includes('ready'), { timeout: JOB_TIMEOUT_MS }).toBe(true);
    appendFileSync(outPath, Buffer.concat([Buffer.alloc(OVER_POLL_CAP_BYTES, ASCII_A), Buffer.from('\nMATCH\n')]));
    await tick();
    await tick();
    await tick();
    expect(messageCount()).toBe(1);
  });

  test('an exited job with both notify_on_output and wake drains matches past 4 MiB before sending the exit wake', async () => {
    await host.fire('session_start', {});
    const id = await startJob(host, { name: 'both', command: 'true', wake: 'Done.', notify_on_output: { pattern: '^MATCH' } });
    await untilExited(host, id);
    writeFileSync(join(world.jobsRoot, id, 'output.log'), Buffer.concat([Buffer.alloc(OVER_POLL_CAP_BYTES, ASCII_A), Buffer.from('\nMATCH\n')]));
    await tick();
    await tick();
    const texts = host.sendMessage.mock.calls.map((call) => String(call[0].content));
    expect(texts.some((t) => t.includes('Matched text: MATCH'))).toBe(true);
    expect(texts.some((t) => t.includes('Done.'))).toBe(true);
  });
});
