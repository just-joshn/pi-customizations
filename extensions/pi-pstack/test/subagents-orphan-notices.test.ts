import { expect, test } from 'vitest';
import { groupNotice, orphanSummary, overflowNotice, restartedNotice, restartFailedNotice, restartPrompt, settledNotice, singleNote, unreportedNotice, workerRestartReason } from '../src/subagents/orphan-notices.ts';
import type { Settlement } from '../src/subagents/orphan-plan.ts';
import type { TaskRecord } from '../src/worker-records.ts';

function record(id: string, extra: Partial<TaskRecord> = {}): TaskRecord {
  return { id, persona: 'general-purpose', cwd: '/w', readonly: false, sessionFile: `/s/agent-${id}.jsonl`, outputFile: `/s/${id}.output.txt`, status: 'running', output: '', description: `job ${id}`, requestShape: 'background', ...extra };
}
function undescribedRecord(id: string, extra: Partial<TaskRecord> = {}): TaskRecord {
  const { description: _description, ...withoutDescription } = record(id, extra);
  return withoutDescription;
}
const settlement = (id: string, extra: Partial<Settlement> = {}): Settlement => ({ record: record(id), status: 'failed', redispatched: false, transcriptSaved: false, ...extra });

const redispatchedHead = 'No completion record was found for it after it was re-dispatched via SendMessage in the previous session.';
const savedHead = 'No completion record was found for it in the previous session.';

test.for([
  { redispatched: true, transcriptSaved: false, canRead: true, head: redispatchedHead, tail: 'Check its worktree/output for partial work before assuming the task landed.' },
  { redispatched: true, transcriptSaved: true, canRead: false, head: redispatchedHead, tail: 'Send it another message with SendMessage to resume it and ask for a status report before assuming the task landed.' },
  { redispatched: false, transcriptSaved: true, canRead: true, head: savedHead, tail: 'Resume it by sending it a message with SendMessage, or check its worktree/output for partial work before assuming the task landed.' },
  { redispatched: false, transcriptSaved: true, canRead: false, head: savedHead, tail: 'Resume it by sending it a message with SendMessage and ask for a status report before assuming the task landed.' },
  {
    redispatched: false,
    transcriptSaved: false,
    canRead: true,
    head: 'It was running when the previous Provider CLI process exited and did not complete.',
    tail: 'Check its worktree/output for partial work before assuming the task landed.',
  },
  {
    redispatched: false,
    transcriptSaved: false,
    canRead: false,
    head: 'It was running when the previous Provider CLI process exited and did not complete.',
    tail: 'Do not assume the task landed; launch it again if its result is still needed.',
  },
])('singleNote redispatched=$redispatched saved=$transcriptSaved canRead=$canRead', ({ redispatched, transcriptSaved, canRead, head, tail }) => {
  const note = singleNote({ ...settlement('a'), redispatched, transcriptSaved }, canRead);
  expect(note.startsWith(head)).toBe(true);
  expect(note.endsWith(tail)).toBe(true);
});

test('the worker restart reason is a stable identifier', () => {
  expect(workerRestartReason).toBe('worker_restart');
});

test.for([
  { status: 'stopped' as const, canRead: true, tail: 'Resume any of them by sending a message to its id with SendMessage, or check its worktree/output for partial work before assuming the task landed.' },
  { status: 'stopped' as const, canRead: false, tail: 'Resume any of them by sending a message to its id with SendMessage and ask for a status report before assuming the task landed.' },
  { status: 'failed' as const, canRead: true, tail: "Check each agent's worktree/output for partial work before assuming the tasks landed." },
  { status: 'failed' as const, canRead: false, tail: 'Do not assume the tasks landed; launch them again if their results are still needed.' },
])('groupNotice $status canRead=$canRead ends with the matching guidance', ({ status, canRead, tail }) => {
  const notice = groupNotice(status, [settlement('a', { status }), settlement('b', { status })], canRead);
  expect(notice.status).toBe(status);
  expect(notice.taskIds).toEqual(['a', 'b']);
  expect(notice.content).toContain(`<status>${status}</status>`);
  expect(notice.content).toContain(tail);
  expect(notice.content.endsWith('</note>\n</task-notification>')).toBe(true);
});

test('group notices fall back to the persona when a record has no description and escape markup', () => {
  const items = [settlement('a'), { ...settlement('b'), record: undescribedRecord('b', { persona: 'a<b>&c' }) }];
  const notice = groupNotice('failed', items, false);
  expect(notice.summary).toBe(`2 background agents didn't finish before the previous session ended: "job a" (a), "a<b>&c" (b).`);
  expect(notice.content).toContain('"a&lt;b&gt;&amp;c" (b)');
});

test('the overflow notification lists all ids when under the cap and mentions worktrees only for readers', () => {
  const items = ['a', 'b', 'c'].map((id) => settlement(id));
  const reader = overflowNotice(items, true);
  expect(reader.summary).toBe("3 background agent tasks didn't finish before the previous session ended. Task ids: a, b, c.");
  expect(reader.content).toContain('Check each worktree/output for partial work before assuming a task landed.');
  expect(reader.taskIds).toEqual(['a', 'b', 'c', '__orphan_summary__:agent']);
  const blind = overflowNotice(items, false);
  expect(blind.content).not.toContain('Check each worktree/output');
  expect(blind.content).toContain('their in-process state was lost. They have been marked failed.');
});

test('restart-failed notices carry the reason and read guidance only when the output is readable', () => {
  const readable = restartFailedNotice(record('r'), 'transcript corrupt', true);
  expect(readable.status).toBe('stopped');
  expect(readable.summary).toBe('Background agent "job r" from the previous session couldn\'t be restarted: transcript corrupt');
  expect(readable.content).toContain('<output-file>/s/agent-r.jsonl</output-file>');
  expect(readable.content).toContain('with SendMessage; check its worktree/output for partial work before assuming the task landed.</note>');
  const blind = restartFailedNotice(record('r'), 'transcript corrupt', false);
  expect(blind.content).not.toContain('output-file');
  expect(blind.content).toContain('with SendMessage and asking for a status report before assuming the task landed.</note>');
});

test('unreported notices point at the output file for readers and at SendMessage otherwise', () => {
  const readable = unreportedNotice(record('u'), true);
  expect(readable.status).toBe('completed');
  expect(readable.content).toContain('Read its output file (and check its worktree, if any) for the result.');
  expect(unreportedNotice(record('u'), false).content).toContain('Send it a message with SendMessage to get its report.');
});

test('restarted notices have no status tag and settled notices escape markup in the description', () => {
  const restarted = restartedNotice(record('r'), true);
  expect(restarted.status).toBe(undefined);
  expect(restarted.content).not.toContain('<status>');
  expect(restarted.content).toContain('<output-file>/s/agent-r.jsonl</output-file>');
  const settled = settledNotice({ ...settlement('x'), record: record('x', { description: 'a & <b>' }) }, false);
  expect(settled.summary).toBe(`Background agent "a & <b>" didn't finish before the previous session ended`);
  expect(settled.content).toContain('<summary>' + 'Background agent "a &amp; &lt;b&gt;" didn\'t finish before the previous session ended</summary>');
});

test('orphanSummary switches to the aggregate wording on overflow and restartPrompt names the task', () => {
  expect(orphanSummary(record('a'), true)).toBe('Orphaned by a previous Provider CLI process exit and reported in an aggregate summary.');
  expect(restartPrompt(record('a'))).toBe('Your previous session ended before you finished "job a". Continue the task from where you left off and report when it is complete.');
});

test('restarted notices omit the output file when the reader cannot read it', () => {
  const blind = restartedNotice(record('r'), false);
  expect(blind.content).not.toContain('<output-file>');
  expect(blind.content).toContain('<task-id>r</task-id>');
  expect(blind.content).toContain('was automatically restarted from its saved transcript');
});

test('settled notices name the persona when the record has no description', () => {
  const settled = settledNotice({ ...settlement('x'), record: undescribedRecord('x') }, false);
  expect(settled.summary).toBe(`Background agent "general-purpose" didn't finish before the previous session ended`);
});

test('the overflow notice handles an empty orphan list', () => {
  const notice = overflowNotice([], true);
  expect(notice.summary).toBe("0 background agent tasks didn't finish before the previous session ended. Task ids: .");
  expect(notice.taskIds).toEqual(['__orphan_summary__:agent']);
  expect(notice.content).toContain('Check each worktree/output for partial work before assuming a task landed.');
  expect(notice.content).not.toContain('<task-id>a</task-id>');
});
