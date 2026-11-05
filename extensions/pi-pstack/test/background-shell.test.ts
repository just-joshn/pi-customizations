import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { describe, expect, test, vi } from 'vitest';
import { createShellJobs, noticeText, type ShellNotice, terminalHeader } from '../src/background-shell.ts';

const ctx = { cwd: '/', model: undefined, sessionManager: { getSessionId: () => 'session', getSessionFile: () => undefined } } as unknown as ExtensionContext;

const shell = test.extend<{ dir: string; notices: ShellNotice[]; jobs: ReturnType<typeof createShellJobs> }>({
  dir: async ({ signal }, use) => {
    signal.throwIfAborted();
    const dir = mkdtempSync(join(tmpdir(), 'pstack-shell-'));
    try {
      await use(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  notices: async ({ signal }, use) => {
    signal.throwIfAborted();
    await use([]);
  },
  jobs: async ({ dir, notices }, use) => {
    const jobs = createShellJobs({ terminalsDir: () => join(dir, 'terminals'), shellPath: () => undefined }, (notice) => notices.push(notice));
    try {
      await use(jobs);
    } finally {
      jobs.shutdown();
    }
  },
});

const start = (jobs: ReturnType<typeof createShellJobs>, dir: string, command: string, extra: { watch?: { pattern: string; reason: string } } = {}) =>
  jobs.start(ctx, { command, cwd: dir, title: 'probe job', toolCallId: 'call-1', ...extra });

test("the header has Cursor's layout and byte length, so offsets and output_length line up", () => {
  // Cursor CLI 2026.10.22 reported output_length 173 for this job before it printed anything.
  const header = terminalHeader({ pid: 205540, cwd: '/tmp/cprobe', command: 'sleep 40; echo LATE', title: 'long sleeper', startedAt: Date.parse('2026-11-04T20:57:01.000Z') });
  expect(header.text).toBe(
    ['---', 'pid: 205540', 'cwd: "/tmp/cprobe"', 'command: "sleep 40; echo LATE"', 'title: "long sleeper"', 'status: running  ', 'started_at: 2026-11-04T20:57:01.000Z', 'running_for_ms: 0        ', '---', ''].join('\n'),
  );
  expect(Buffer.byteLength(header.text)).toBe(173);
  expect(header.text.slice(header.statusOffset, header.statusOffset + 9)).toBe('running  ');
  expect(header.text.slice(header.runningOffset, header.runningOffset + 9)).toBe('0        ');
});

test('a finished notice matches the text Cursor sent for a failed background shell', () => {
  const notice: ShellNotice = { kind: 'finished', status: 'error', taskId: '181095', shellId: '181095', title: 'fail later', toolCallId: 'toolu_014h', detail: 'exit_code=3' };
  expect(noticeText(notice)).toBe(
    [
      '<system_notification>',
      'The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.',
      '',
      '<task>',
      'kind: shell',
      'status: error',
      'task_id: 181095',
      'title: fail later',
      'tool_call_id: toolu_014h',
      'detail: exit_code=3',
      '</task>',
      '</system_notification>',
      'Briefly inform the user about the task result and perform any follow-up actions (if needed).',
    ].join('\n'),
  );
});

describe('background jobs', () => {
  shell('a failing job writes its output between the header and an exit footer, and notifies once with its exit code', async ({ dir, jobs, notices }) => {
    const job = start(jobs, dir, 'echo AW-1; exit 3');
    await job.done;
    const file = readFileSync(job.path, 'utf8');
    expect(file).toMatch(/^---\npid: \d+\ncwd: ".*"\ncommand: "echo AW-1; exit 3"\ntitle: "probe job"\nstatus: failed {3}\nstarted_at: \S+\nrunning_for_ms: \d+ *\n---\nAW-1\n\n---\nexit_code: 3\nelapsed_ms: \d+\nended_at: \S+\n---\n$/);
    expect(notices).toEqual([{ kind: 'finished', status: 'error', taskId: job.id, shellId: job.id, title: 'probe job', toolCallId: 'call-1', detail: 'exit_code=3' }]);
  });

  shell('a job awaited to its end sends no completion notification, and AwaitShell reports its exit code and file', async ({ dir, jobs, notices }) => {
    const job = start(jobs, dir, 'echo DONE');
    const text = await jobs.awaitJob(job.id, 30_000, undefined, undefined);
    expect(text).toMatch(new RegExp(`^Task completed in \\d+ms with exit code: 0\\.\\noutput_file_path: ${job.path}\\noutput_length: \\d+$`));
    expect(Number(/output_length: (\d+)/.exec(text)?.[1])).toBe(readFileSync(job.path).length);
    expect(notices).toEqual([]);
  });

  shell('AwaitShell reports a pattern match on a running job, and a miss when the wait ends first', async ({ dir, jobs }) => {
    const job = start(jobs, dir, 'echo READY-1; sleep 30');
    const matched = await jobs.awaitJob(job.id, 20_000, '^READY-\\d', undefined);
    const missed = await jobs.awaitJob(job.id, 100, 'NEVER', undefined);
    expect(matched).toMatch(/^Task still running after \d+ms\.\.\. Pattern matched: READY-1\n/);
    expect(missed).toMatch(/^Task still running after \d+ms\.\.\. Pattern did NOT match\.\n/);
  });

  shell('AwaitShell patterns are RE2, as Cursor compiles them: inline flags work and lookahead is refused', async ({ dir, jobs }) => {
    const job = start(jobs, dir, 'echo ready-now; sleep 30');
    await expect(jobs.awaitJob(job.id, 20_000, '(?i)^READY-\\w+', undefined)).resolves.toMatch(/^Task still running after \d+ms\.\.\. Pattern matched: ready-now\n/);
    await expect(jobs.awaitJob(job.id, 10, 'ready(?=-now)', undefined)).rejects.toThrow('Invalid pattern /ready(?=-now)/');
  });

  shell("AwaitShell on an unknown shell fails with Cursor's error", async ({ jobs }) => {
    await expect(jobs.awaitJob('999999999', 10, undefined, undefined)).rejects.toThrow('Error awaiting task: No shell found for id 999999999');
  });

  shell('a watched pattern notifies on the first match and counts later matches in the debounce window, before the completion notice', async ({ dir, jobs, notices }) => {
    const job = start(jobs, dir, 'printf "HIT-1\\nmiss\\nHIT-2\\nHIT-3\\n"', { watch: { pattern: '^HIT-', reason: 'every hit' } });
    await job.done;
    expect(notices.map((notice) => [notice.kind, notice.taskId, notice.title, notice.detail])).toEqual([
      ['progress', `${job.id}:task_progress:1`, 'every hit', 'Shell output has pattern /^HIT-/. This is occurrence number 1. Matched text: HIT-. The title message is being displayed to the user.'],
      ['progress', `${job.id}:task_progress:2`, 'every hit', 'Shell output matched /^HIT-/ 2 more times since the previous notification. The title message is being displayed to the user. Latest match: HIT-.'],
      ['finished', job.id, 'probe job', undefined],
    ]);
    expect(notices[0]?.outputPath).toBe(job.path);
  });

  shell('stdout and stderr retain UTF-8 characters split between chunks', async ({ dir, jobs, notices }) => {
    const producer = `const fs = require('node:fs'); const watcher = fs.watch('.', (_, name) => { if (name !== 'release') return; fs.writeSync(1, Buffer.from([0x82, 0xac])); fs.writeSync(2, Buffer.from([0x82, 0xac])); watcher.close(); }); fs.writeSync(1, Buffer.from([79, 85, 84, 58, 0xe2])); fs.writeSync(2, Buffer.from([69, 82, 82, 58, 0xe2]));`;
    const job = start(jobs, dir, `${JSON.stringify(process.execPath)} -e ${JSON.stringify(producer)}`, { watch: { pattern: '€', reason: 'unicode' } });
    await expect.poll(() => jobs.output(job)).toMatch(/^(OUT:ERR:|ERR:OUT:)$/);
    writeFileSync(join(dir, 'release'), 'release');
    await job.done;
    expect(jobs.output(job)).toMatch(/^(OUT:ERR:|ERR:OUT:)€€$/);
    expect(notices.filter((notice) => notice.kind === 'progress').map((notice) => notice.detail)).toEqual([
      'Shell output has pattern /€/. This is occurrence number 1. Matched text: €. The title message is being displayed to the user.',
      'Shell output has pattern /€/. This is occurrence number 2. Latest match: €. The title message is being displayed to the user.',
    ]);
  });

  shell('session shutdown stops a running job and records it aborted without notifying', async ({ dir, jobs, notices }) => {
    const job = start(jobs, dir, 'sleep 30');
    jobs.shutdown();
    await job.done;
    expect(readFileSync(job.path, 'utf8')).toMatch(/status: aborted {2}\n[\s\S]*exit_code: 143\n/);
    expect(notices).toEqual([]);
    expect(() => process.kill(job.pid, 0)).toThrow();
  });

  shell('the running time in the header is refreshed while the job runs', async ({ dir, jobs }) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] });
    try {
      const job = start(jobs, dir, 'sleep 30');
      vi.advanceTimersByTime(5_000);
      expect(readFileSync(job.path, 'utf8')).toContain('running_for_ms: 5000     \n');
    } finally {
      vi.useRealTimers();
    }
  });
});
