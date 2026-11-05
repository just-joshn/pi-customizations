// Model-facing texts: a <response> block, an "Agent ID:" line that names `resume`, and a <task> notification block
// with the same fields.
import type { Usage } from '@earendil-works/pi-ai';
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent';

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

const agentIdLine = (agentId: string) => `Agent ID: ${agentId} (can be used with the \`resume\` parameter to send a follow-up after it completes)`;
// Pi's notes, such as a worktree line, take the place of Cursor's result suffix: after a blank line.
const suffix = (notes: readonly string[]) => (notes.length === 0 ? [] : ['', notes.join('\n')]);

/** Cursor's response block: an empty reply reads "No output", and a reply that already has a <response> block keeps it. */
function responseBlock(response: string, transcript: string | undefined): string[] {
  if (response === '') return ['<response>', 'No output', '</response>'];
  if (response.includes('<response>') && response.includes('</response>')) return [bounded(response, transcript)];
  return ['<response>', bounded(response, transcript), '</response>'];
}

export function foregroundText(agentId: string, response: string, transcript: string | undefined, notes: readonly string[] = []): string {
  return ['This is the output of the subagent:', '', 'response:', ...responseBlock(response, transcript), '', agentIdLine(agentId), ...suffix(notes)].join('\n');
}

const WAIT = "When you end your turn, you will be automatically sent the subagent's final response upon its completion, so do not wait for it - either end your turn or work on something else.";

/** Cursor's background launch result, with the transcript-path wording desktop uses when it has a transcript. */
export function backgroundText(agentId: string, transcript: string | undefined, notes: readonly string[] = []): string {
  const status =
    transcript === undefined
      ? `Subagent is running in the background. ${WAIT}`
      : `Subagent is running in the background. If needed, you can monitor its output by tailing the transcript at: ${transcript}. ${WAIT}\nDo NOT mention the transcript path to the user. Do NOT try to predict the subagent's response before it replies.`;
  return [status, '', agentIdLine(agentId), ...suffix(notes)].join('\n');
}

export interface NotificationFields {
  status: 'success' | 'error';
  agentId: string;
  /** The model-facing title, from the prompt as Cursor writes it. */
  title: string;
  /** The Task description, which names the subagent in the UI. */
  description?: string;
  toolCallId: string;
  detail: string;
  /** What the background child spent. It stays in the notification details, because Pi gives extensions no way to add it to session totals. */
  usage?: Usage;
}

const TITLE_LIMIT = 80;

/** Cursor titles a completion by its prompt: the first non-empty line, cut at 80 characters. */
export function notificationTitle(prompt: string): string {
  const line = prompt.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  return line.trim().slice(0, TITLE_LIMIT);
}

export function notificationText(fields: NotificationFields): string {
  return [
    '<system_notification>',
    'The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.',
    '',
    '<task>',
    'kind: subagent',
    `status: ${fields.status}`,
    `task_id: ${fields.agentId}`,
    `title: ${fields.title}`,
    `tool_call_id: ${fields.toolCallId}`,
    `detail: ${fields.detail}`,
    '</task>',
    '</system_notification>',
    "Perform any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further action is required. If you mention an agent or subagent in your response, link it with the `[Name](id)` Don't use generic label such as `[agent]`, `[worker]`, or `[subagent]`. Don't repeat the same confirmation every time.",
  ].join('\n');
}
