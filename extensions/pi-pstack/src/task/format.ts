// Model-facing texts. The structure follows what Cursor's Task returns (fixtures F2, F3): a <response> block,
// an "Agent ID:" line that names `resume`, and a <task> notification block with the same fields. Wording is the port's own.
import type { Usage } from '@earendil-works/pi-ai';
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent';
import type { Worktree } from './worktree.ts';

/** The first `limit` bytes, cut back to a UTF-8 character boundary (past 10xxxxxx continuation bytes). */
function headBytes(bytes: Buffer, limit: number): string {
  let end = limit;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

/**
 * Bounds a response with Pi's own tool-output limits (truncateHead: 2000 lines or 50KB). truncateHead keeps whole
 * lines and returns nothing when the first line alone is too long, and a subagent's reply can be one long line, so
 * that case keeps the line's first 50KB instead.
 */
export function bounded(text: string, transcript: string | undefined): string {
  const result = truncateHead(text);
  if (!result.truncated) return text;
  const where = `the full response is in ${transcript ?? 'the subagent transcript'}`;
  if (result.firstLineExceedsLimit) {
    const head = headBytes(Buffer.from(text, 'utf8'), DEFAULT_MAX_BYTES);
    return `${head}\n[truncated: showing ${formatSize(Buffer.byteLength(head, 'utf8'))} of ${formatSize(result.totalBytes)}; ${where}]`;
  }
  const size = result.truncatedBy === 'bytes' ? ` (${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)})` : '';
  return `${result.content}\n[truncated: showing ${result.outputLines} of ${result.totalLines} lines${size}; ${where}]`;
}

const agentIdLine = (agentId: string) => `Agent ID: ${agentId} (pass it as \`resume\` to send a follow-up after it completes)`;
const transcriptLine = (transcript: string | undefined) => (transcript === undefined ? [] : [`Transcript: ${transcript}`]);

export function foregroundText(agentId: string, response: string, transcript: string | undefined, notes: readonly string[] = []): string {
  return ['This is the output of the subagent:', '', 'response:', '<response>', bounded(response, transcript), '</response>', '', agentIdLine(agentId), ...transcriptLine(transcript), ...notes].join('\n');
}

export function backgroundText(agentId: string, transcript: string | undefined, notes: readonly string[] = []): string {
  return [
    'Subagent is running in the background. Its final response arrives automatically after your turn ends, so do not wait or poll for it. End your turn or work on something else.',
    '',
    agentIdLine(agentId),
    ...transcriptLine(transcript),
    ...notes,
  ].join('\n');
}

export function worktreeLine(worktree: Worktree): string {
  return `Worktree: ${worktree.path} on branch ${worktree.branch}, from ${worktree.base} at ${worktree.commit}. Merge ${worktree.branch} to take the subagent's commits.`;
}

/** Opens a cloud agent's first prompt, since nothing else tells the child that the parent merges from its branch. */
export function worktreePreface(worktree: Worktree, prompt: string): string {
  const where = worktree.cwd === worktree.path ? worktree.path : `${worktree.path} (working directory ${worktree.cwd})`;
  return `You are running in an isolated git worktree at ${where} on branch ${worktree.branch}, created from ${worktree.base} at ${worktree.commit}. Uncommitted changes in the parent's checkout are not here. Commit your changes to ${worktree.branch} before you finish, because the parent agent merges from that branch.\n\n${prompt}`;
}

export interface NotificationFields {
  status: 'success' | 'error';
  agentId: string;
  title: string;
  toolCallId: string;
  detail: string;
  /** What the background child spent. It stays in the notification details, because Pi gives extensions no way to add it to session totals. */
  usage?: Usage;
}

export function notificationText(fields: NotificationFields): string {
  return [
    'The following task has finished. If you already handled it, ignore this notification and do not restate earlier responses.',
    '',
    '<task>',
    'kind: subagent',
    `status: ${fields.status}`,
    `task_id: ${fields.agentId}`,
    `title: ${fields.title}`,
    `tool_call_id: ${fields.toolCallId}`,
    `detail: ${fields.detail}`,
    '</task>',
  ].join('\n');
}
