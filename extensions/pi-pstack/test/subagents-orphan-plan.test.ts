import { expect, test } from 'vitest';
import { groupNotice, overflowNotice, restartedNotice, settledNotice, unreportedNotice } from '../src/subagents/orphan-notices.ts';
import { findOrphans, orphanLimit, planRecovery, resumeWindowMs } from '../src/subagents/orphan-plan.ts';
import type { TaskRecord } from '../src/worker-records.ts';

const now = 1_800_000_000_000;
const hour = 3_600_000;

function record(id: string, extra: Partial<TaskRecord> = {}): TaskRecord {
  return { id, persona: 'general-purpose', cwd: '/w', readonly: false, sessionFile: `/s/agent-${id}.jsonl`, outputFile: `/s/${id}.output.txt`, status: 'running', output: '', description: `job ${id}`, requestShape: 'background', ...extra };
}

const entry = (data: TaskRecord) => ({ type: 'custom', customType: 'pstack-task', data });

test('[C110] only background tasks whose latest record is running are orphans, and repeat launches mark a redispatch', () => {
  const branch = [
    entry(record('bg')),
    entry(record('done')),
    entry(record('done', { status: 'settled' })),
    entry(record('fg', { requestShape: 'foreground' })),
    entry(record('legacy', { requestShape: undefined })),
    entry(record('again')),
    entry(record('again', { status: 'settled' })),
    entry(record('again')),
  ];
  expect(findOrphans(branch).map(({ record: found, redispatched }) => [found.id, redispatched])).toEqual([
    ['bg', false],
    ['again', true],
  ]);
});

type Case = { name: string; mtimeAgeMs: number | null; hasMeta: boolean; canResume: boolean; redispatched: boolean; expected: 'resume' | 'stopped' | 'failed' };

test.for<Case>([
  { name: 'a recent saved transcript with metadata is auto-resumed', mtimeAgeMs: hour, hasMeta: true, canResume: true, redispatched: false, expected: 'resume' },
  { name: 'a transcript older than 48 hours is stopped, not resumed', mtimeAgeMs: resumeWindowMs + 1, hasMeta: true, canResume: true, redispatched: false, expected: 'stopped' },
  { name: 'a transcript exactly 48 hours old is stopped', mtimeAgeMs: resumeWindowMs, hasMeta: true, canResume: true, redispatched: false, expected: 'stopped' },
  { name: 'a recent transcript without metadata is stopped', mtimeAgeMs: hour, hasMeta: false, canResume: true, redispatched: false, expected: 'stopped' },
  { name: 'no resume handler leaves a recent transcript stopped', mtimeAgeMs: hour, hasMeta: true, canResume: false, redispatched: false, expected: 'stopped' },
  { name: 'a previously redispatched task is stopped, never resumed again', mtimeAgeMs: hour, hasMeta: true, canResume: true, redispatched: true, expected: 'stopped' },
  { name: 'a missing transcript is failed', mtimeAgeMs: null, hasMeta: false, canResume: true, redispatched: false, expected: 'failed' },
])('[B102][C111] $name', ({ mtimeAgeMs, hasMeta, canResume, redispatched, expected }) => {
  const orphan = { record: record('t'), redispatched };
  const probes = new Map([['t', { mtimeMs: mtimeAgeMs === null ? null : now - mtimeAgeMs, hasMeta }]]);
  const plan = planRecovery([orphan], probes, { now, canResume });
  const outcome = plan.resume.length ? 'resume' : plan.settle[0]?.status;
  expect(outcome).toBe(expected);
});

test('[B101] more than twenty orphans are all failed in one aggregate with no auto-resume', () => {
  const orphans = Array.from({ length: orphanLimit + 1 }, (_, index) => ({ record: record(`t${index}`), redispatched: false }));
  const probes = new Map(orphans.map(({ record: found }) => [found.id, { mtimeMs: now - hour, hasMeta: true }]));
  const plan = planRecovery(orphans, probes, { now, canResume: true });
  expect(plan.overflow).toBe(true);
  expect(plan.resume).toEqual([]);
  expect(plan.settle.map((item) => item.status)).toEqual(Array(orphanLimit + 1).fill('failed'));
});

test('[C110] a single failed orphan says its in-process state was lost', () => {
  const notice = settledNotice({ record: record('a'), status: 'failed', redispatched: false, transcriptSaved: false }, false);
  expect(notice.content).toBe(
    [
      '<task-notification>',
      '<task-id>a</task-id>',
      '<status>failed</status>',
      `<summary>Background agent "job a" didn't finish before the previous session ended</summary>`,
      '<note>It was running when the previous Provider CLI process exited and did not complete. Its in-process state was lost. Do not assume the task landed; launch it again if its result is still needed.</note>',
      '</task-notification>',
    ].join('\n'),
  );
});

test('[B101] a stopped orphan with a saved transcript points at the output file when the parent can read it', () => {
  const notice = settledNotice({ record: record('b'), status: 'stopped', redispatched: false, transcriptSaved: true }, true);
  expect(notice.content).toContain('<output-file>/s/agent-b.jsonl</output-file>\n<status>stopped</status>');
  expect(notice.content).toContain("either way its transcript is saved, so its progress is not lost. Resume it by sending it a message with SendMessage, or check its worktree/output for partial work before assuming the task landed.");
});

test('[B101] several stopped orphans share one notification listing every id', () => {
  const items = ['a', 'b'].map((id) => ({ record: record(id), status: 'stopped' as const, redispatched: false, transcriptSaved: true }));
  const notice = groupNotice('stopped', items, false);
  expect(notice.taskIds).toEqual(['a', 'b']);
  expect(notice.content).toContain('<summary>2 background agents didn\'t finish before the previous session ended: "job a" (a), "job b" (b).</summary>');
});

test('[B101] the overflow notification caps the id list and explains its scan marker', () => {
  const items = Array.from({ length: 22 }, (_, index) => ({ record: record(`t${index}`), status: 'failed' as const, redispatched: false, transcriptSaved: false }));
  const notice = overflowNotice(items, false);
  expect(notice.taskIds).toHaveLength(orphanLimit + 1);
  expect(notice.taskIds.at(-1)).toBe('__orphan_summary__:agent');
  expect(notice.content).toContain("<summary>22 background agent tasks didn't finish before the previous session ended. First 20 task ids: ");
  expect(notice.content).toContain('They have been marked failed.');
});

test('[C111] restart and unreported-completion notices follow the bundle wording', () => {
  expect(restartedNotice(record('r'), false).summary).toBe('Background agent "job r" was restarted after the previous session ended');
  expect(unreportedNotice(record('r'), false).content).toContain('only its completion notification was lost, so it was not restarted');
});
