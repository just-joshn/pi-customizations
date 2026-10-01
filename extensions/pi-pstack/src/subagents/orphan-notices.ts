import type { TaskRecord } from '../worker-records.ts';
import { escapeMarkup } from './notification.ts';
import { orphanLimit, type Settlement } from './orphan-plan.ts';

export const workerRestartReason = 'worker_restart';
const aggregateMarker = '__orphan_summary';
const aggregateSummary = 'Orphaned by a previous Claude Code process exit and reported in an aggregate summary.';

export type OrphanNotice = Readonly<{ content: string; summary: string; status: 'stopped' | 'failed' | 'completed' | undefined; taskIds: readonly string[] }>;

const describe = (record: TaskRecord): string => record.description ?? record.persona;
const didNotFinish = (what: string): string => `${what} didn't finish before the previous session ended`;

function markup(fields: ReadonlyArray<readonly [string, string | undefined]>): string {
  const body = fields.flatMap(([tag, value]) => (value === undefined ? [] : [`<${tag}>${value}</${tag}>`])).join('\n');
  return `<task-notification>\n${body}\n</task-notification>`;
}

export function singleNote({ redispatched, transcriptSaved }: Settlement, canRead: boolean): string {
  if (redispatched) {
    const tail = canRead ? 'Check its worktree/output for partial work before assuming the task landed.' : 'Send it another message with SendMessage to resume it and ask for a status report before assuming the task landed.';
    return `No completion record was found for it after it was re-dispatched via SendMessage in the previous session. It may have been stopped (via the UI, an SDK interrupt, or agent teardown — these leave no transcript marker), or it may have been running when the previous Claude Code process exited. ${tail}`;
  }
  if (transcriptSaved) {
    const tail = canRead ? 'Resume it by sending it a message with SendMessage, or check its worktree/output for partial work before assuming the task landed.' : 'Resume it by sending it a message with SendMessage and ask for a status report before assuming the task landed.';
    return `No completion record was found for it in the previous session. It may have been stopped, or it may have been running when the previous Claude Code process exited — either way its transcript is saved, so its progress is not lost. ${tail}`;
  }
  const tail = canRead ? 'Check its worktree/output for partial work before assuming the task landed.' : 'Do not assume the task landed; launch it again if its result is still needed.';
  return `It was running when the previous Claude Code process exited and did not complete. Its in-process state was lost. ${tail}`;
}

function notice(record: TaskRecord, status: OrphanNotice['status'], summary: string, note: string, canRead: boolean): OrphanNotice {
  const content = markup([
    ['task-id', record.id],
    ['output-file', canRead ? record.sessionFile : undefined],
    ['status', status],
    ['summary', escapeMarkup(summary)],
    ['note', `${escapeMarkup(note)}`],
  ]);
  return { content, summary, status, taskIds: [record.id] };
}

export function orphanSummary(record: TaskRecord, overflow: boolean): string {
  return overflow ? aggregateSummary : didNotFinish(`Background agent "${describe(record)}"`);
}

export function settledNotice(item: Settlement, canRead: boolean): OrphanNotice {
  return notice(item.record, item.status, orphanSummary(item.record, false), singleNote(item, canRead), canRead);
}

function groupNote(status: 'stopped' | 'failed', canRead: boolean): string {
  if (status === 'stopped') {
    const tail = canRead ? 'Resume any of them by sending a message to its id with SendMessage, or check its worktree/output for partial work before assuming the task landed.' : 'Resume any of them by sending a message to its id with SendMessage and ask for a status report before assuming the task landed.';
    return `No completion record was found for them in the previous session. They may have been stopped, or they may have been running when the previous Claude Code process exited — either way their transcripts are saved, so their progress is not lost. ${tail}`;
  }
  const tail = canRead ? "Check each agent's worktree/output for partial work before assuming the tasks landed." : 'Do not assume the tasks landed; launch them again if their results are still needed.';
  return `They were running when the previous Claude Code process exited and did not complete. Their in-process state was lost. ${tail}`;
}

export function groupNotice(status: 'stopped' | 'failed', items: readonly Settlement[], canRead: boolean): OrphanNotice {
  const names = items.map(({ record }) => `"${describe(record)}" (${record.id})`).join(', ');
  const summary = `${didNotFinish(`${items.length} background agents`)}: ${names}.`;
  const ids = items.map(({ record }) => record.id);
  const content = `<task-notification>\n${ids.map((id) => `<task-id>${id}</task-id>`).join('\n')}\n<status>${status}</status>\n<summary>${escapeMarkup(summary)}</summary>\n<note>${escapeMarkup(groupNote(status, canRead))}</note>\n</task-notification>`;
  return { content, summary, status, taskIds: ids };
}

export function overflowNotice(items: readonly Settlement[], canRead: boolean): OrphanNotice {
  const ids = items.slice(0, orphanLimit).map(({ record }) => record.id);
  const listed = ids.length === items.length ? `Task ids: ${ids.join(', ')}.` : `First ${orphanLimit} task ids: ${ids.join(', ')}.`;
  const lost = `They were running when the previous Claude Code process exited and did not complete; their in-process state was lost.${canRead ? ' Check each worktree/output for partial work before assuming a task landed.' : ''} They have been marked failed.`;
  const note = `No completion record was found for them in the previous session. ${lost} Task ids in this notification beginning with "${aggregateMarker}" are internal scan markers, not tasks.`;
  const summary = `${didNotFinish(`${items.length} background agent tasks`)}. ${listed}`;
  const taskIds = [...ids, `${aggregateMarker}__:agent`];
  const content = `<task-notification>\n${taskIds.map((id) => `<task-id>${id}</task-id>`).join('\n')}\n<status>failed</status>\n<summary>${escapeMarkup(summary)}</summary>\n<note>${escapeMarkup(note)}</note>\n</task-notification>`;
  return { content, summary, status: 'failed', taskIds };
}

export function restartedNotice(record: TaskRecord, canRead: boolean): OrphanNotice {
  const note = 'It had no completion record after the previous Claude Code process exited, and was automatically restarted from its saved transcript. It is running in the background again; its result will arrive as a separate task notification.';
  return notice(record, undefined, `Background agent "${describe(record)}" was restarted after the previous session ended`, note, canRead);
}

export function unreportedNotice(record: TaskRecord, canRead: boolean): OrphanNotice {
  const tail = canRead ? 'Read its output file (and check its worktree, if any) for the result.' : 'Send it a message with SendMessage to get its report.';
  const note = `It had already completed before the previous Claude Code process exited — only its completion notification was lost, so it was not restarted and no further task notification will arrive. ${tail}`;
  return notice(record, 'completed', `Background agent "${describe(record)}" finished before the previous session ended, but its result was never reported`, note, canRead);
}

export function restartFailedNotice(record: TaskRecord, reason: string, canRead: boolean): OrphanNotice {
  const tail = canRead ? '; check its worktree/output for partial work before assuming the task landed.' : ' and asking for a status report before assuming the task landed.';
  const note = `It could not be automatically restarted. Its transcript may still be resumable by sending it a message with SendMessage${tail}`;
  return notice(record, 'stopped', `Background agent "${describe(record)}" from the previous session couldn't be restarted: ${reason}`, note, canRead);
}

export function restartPrompt(record: TaskRecord): string {
  return `Your previous session ended before you finished "${describe(record)}". Continue the task from where you left off and report when it is complete.`;
}
