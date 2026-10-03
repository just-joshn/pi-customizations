import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { reconcileOrphans } from '../src/subagents/orphan-recovery.ts';
import type { TaskRecord } from '../src/worker-records.ts';
import { scratchDir } from './support/scratch.ts';

type SentMessage = Readonly<{ customType?: string; content: string; details?: Record<string, unknown> }>;

function record(id: string, extra: Partial<TaskRecord> = {}): TaskRecord {
  return { id, persona: 'general-purpose', cwd: '/w', readonly: false, sessionFile: `/missing/agent-${id}.jsonl`, outputFile: `/s/${id}.out`, status: 'running', output: '', description: `job ${id}`, requestShape: 'background', ...extra };
}

const entry = (data: TaskRecord) => ({ type: 'custom', customType: 'pstack-task', data });

/** A record whose transcript and metadata are on disk, so the probe sees a resumable orphan. */
function savedRecord(dir: string, id: string, extra: Partial<TaskRecord> = {}): TaskRecord {
  const sessionFile = join(dir, `agent-${id}.jsonl`);
  writeFileSync(sessionFile, '{}\n');
  writeFileSync(join(dir, `agent-${id}.meta.json`), '{}');
  return record(id, { sessionFile, ...extra });
}

function harness() {
  const appended: TaskRecord[] = [];
  const sent: SentMessage[] = [];
  const pi = {
    appendEntry: (_type: string, data: TaskRecord) => appended.push(data),
    sendMessage: (message: SentMessage) => sent.push(message),
  };
  return { pi, appended, sent };
}

test('with no orphans nothing is persisted, notified or restarted', async () => {
  const { pi, appended, sent } = harness();
  const reconciled = reconcileOrphans({ pi: pi as never, ctx: {} as never, branch: [entry(record('done', { status: 'settled' }))], resume: undefined, canRead: false });
  expect(reconciled.records.size).toBe(0);
  await reconciled.restart();
  expect(appended).toEqual([]);
  expect(sent).toEqual([]);
});

test('a recent saved background task is handed to resume and reported as restarted', async () => {
  const dir = scratchDir('pstack-orphan-');
  const { pi, appended, sent } = harness();
  const resumed: string[] = [];
  const reconciled = reconcileOrphans({
    pi: pi as never,
    ctx: {} as never,
    branch: [entry(savedRecord(dir, 'a'))],
    resume: async (task) => {
      resumed.push(task.id);
      return {};
    },
    canRead: true,
    now: Date.now(),
  });
  expect(reconciled.records.get('a')).toMatchObject({ status: 'interrupted', id: 'a', output: '' });
  expect(appended).toEqual([]);
  await reconciled.restart();
  expect(resumed).toEqual(['a']);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.customType).toBe('task_notification');
  expect(sent[0]?.content).toContain('<task-id>a</task-id>');
  expect(sent[0]?.content).toContain('was restarted after the previous session ended');
  expect(sent[0]?.details).toMatchObject({ task_id: 'a', task_type: 'local_agent', summary: 'Background agent "job a" was restarted after the previous session ended' });
  expect(sent[0]?.details).not.toHaveProperty('status');
});

test('a resume that finds the task already completed reports the lost notification', async () => {
  const dir = scratchDir('pstack-orphan-');
  const { pi, sent } = harness();
  const reconciled = reconcileOrphans({
    pi: pi as never,
    ctx: {} as never,
    branch: [entry(savedRecord(dir, 'b'))],
    resume: async () => ({ alreadyCompleted: true as const }),
    canRead: false,
  });
  await reconciled.restart();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.details).toMatchObject({ task_id: 'b', status: 'completed' });
  expect(sent[0]?.content).toContain('only its completion notification was lost');
});

test('a failed resume persists the interrupted record and reports the reason', async () => {
  const dir = scratchDir('pstack-orphan-');
  const { pi, appended, sent } = harness();
  const recordWithAbort = savedRecord(dir, 'c', { abort: { reason: 'superseded', telemetry: 'none', userInitiated: false } });
  const reconciled = reconcileOrphans({
    pi: pi as never,
    ctx: {} as never,
    branch: [entry(recordWithAbort)],
    resume: async () => {
      throw new Error('transcript corrupt');
    },
    canRead: true,
  });
  await reconciled.restart();
  expect(appended).toEqual([expect.objectContaining({ id: 'c', status: 'interrupted', abort: expect.objectContaining({ reason: 'superseded' }) })]);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.details).toMatchObject({ task_id: 'c', status: 'stopped', reason: 'worker_restart' });
  expect(sent[0]?.details?.summary).toBe(`Background agent "job c" from the previous session couldn't be restarted: transcript corrupt`);
});

test('an orphan with no transcript on disk settles as failed and is persisted without its abort state', async () => {
  const { pi, appended, sent } = harness();
  const lost = record('d', { abort: { reason: 'stopped', telemetry: 'none', userInitiated: true } });
  const reconciled = reconcileOrphans({ pi: pi as never, ctx: {} as never, branch: [entry(lost)], resume: undefined, canRead: false });
  expect(reconciled.records.get('d')).toMatchObject({ status: 'failed', id: 'd' });
  expect(appended).toHaveLength(1);
  expect(appended[0]).toMatchObject({ id: 'd', status: 'failed' });
  expect(appended[0]).not.toHaveProperty('abort');
  expect(sent).toHaveLength(1);
  expect(sent[0]?.details).toMatchObject({ task_id: 'd', status: 'failed', reason: 'worker_restart' });
  expect(sent[0]?.content).toContain('in-process state was lost');
});

test('a saved transcript with no resume handler settles as interrupted', async () => {
  const dir = scratchDir('pstack-orphan-');
  const { pi, appended, sent } = harness();
  const reconciled = reconcileOrphans({ pi: pi as never, ctx: {} as never, branch: [entry(savedRecord(dir, 'e'))], resume: undefined, canRead: false });
  expect(reconciled.records.get('e')?.status).toBe('interrupted');
  expect(appended[0]).toMatchObject({ id: 'e', status: 'interrupted' });
  expect(sent[0]?.details).toMatchObject({ task_id: 'e', status: 'stopped', reason: 'worker_restart' });
  expect(sent[0]?.content).not.toContain('<output-file>');
  await reconciled.restart();
  expect(sent).toHaveLength(1);
});

test('several stopped orphans merge into one grouped notification naming every id', async () => {
  const dir = scratchDir('pstack-orphan-');
  const { pi, sent } = harness();
  const reconciled = reconcileOrphans({ pi: pi as never, ctx: {} as never, branch: [entry(savedRecord(dir, 'f')), entry(savedRecord(dir, 'g'))], resume: undefined, canRead: true });
  expect(reconciled.records.size).toBe(2);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.details).toMatchObject({ task_id: 'f', task_ids: ['f', 'g'], status: 'stopped' });
  expect(sent[0]?.content).toContain('<task-id>f</task-id>');
  expect(sent[0]?.content).toContain('<task-id>g</task-id>');
});

test('more orphans than the scan limit produce one aggregate failure notice', async () => {
  const { pi, appended, sent } = harness();
  const orphans = Array.from({ length: 21 }, (_, index) => entry(record(`t${index}`)));
  const reconciled = reconcileOrphans({ pi: pi as never, ctx: {} as never, branch: orphans, resume: undefined, canRead: false });
  expect(reconciled.records.size).toBe(21);
  expect([...reconciled.records.values()].every((task) => task.status === 'failed')).toBe(true);
  expect(appended).toHaveLength(21);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.details?.task_ids).toHaveLength(21);
  expect(sent[0]?.details?.task_ids).toContain('__orphan_summary__:agent');
  expect(sent[0]?.content).toContain('First 20 task ids');
});
