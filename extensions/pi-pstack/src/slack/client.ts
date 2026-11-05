// The Slack Web API, the boundary for Slack triggers and Slack tools: Cursor's Slack integration reads channels, posts
// thread replies, and reacts as a bot. The token comes from the slack connector's credential file (request_secret or
// `/secret slack token`) or SLACK_BOT_TOKEN; PSTACK_SLACK_API_URL points at another API root (Enterprise Grid, tests).
import { readCredential } from '../secrets.ts';

export const SLACK_API_ENV = 'PSTACK_SLACK_API_URL';
const DEFAULT_API = 'https://slack.com/api/';
const TIMEOUT_MS = 30_000;

export class SlackError extends Error {
  readonly code: string;
  constructor(method: string, code: string) {
    super(`Slack ${method} failed: ${code}`);
    this.name = 'SlackError';
    this.code = code;
  }
}

/** The bot token, or undefined when Slack is not connected. */
export function slackToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromEnv = env['SLACK_BOT_TOKEN'] ?? env['SLACK_TOKEN'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  try {
    return readCredential('slack', 'token');
  } catch {
    return undefined;
  }
}

export const NOT_CONNECTED =
  'Slack is not connected. Ask the user for a Slack bot token with request_secret (connector "slack", field "token"), or have them run `/secret slack token`, or set SLACK_BOT_TOKEN. The bot needs channels:history, channels:read, chat:write, and reactions:write.';

export interface SlackMessage {
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  reply_count?: number;
  latest_reply?: string;
  files?: { id?: string; name?: string; mimetype?: string; url_private?: string; permalink?: string }[];
}

/** One Web API call with a JSON body; Slack's `ok: false` becomes a SlackError naming its error code. */
export async function slackCall<T extends Record<string, unknown>>(method: string, body: Record<string, unknown>, token = slackToken()): Promise<T> {
  if (token === undefined) throw new Error(NOT_CONNECTED);
  const base = process.env[SLACK_API_ENV] || DEFAULT_API;
  const response = await fetch(new URL(method, base.endsWith('/') ? base : `${base}/`), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 429) throw new SlackError(method, `ratelimited (retry after ${response.headers.get('retry-after') ?? '?'}s)`);
  if (!response.ok) throw new SlackError(method, `HTTP ${response.status}`);
  const json = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (json.ok !== true) throw new SlackError(method, json.error ?? 'unknown_error');
  return json;
}

/** A message is top-level when it starts no thread or starts its own thread. */
export const isTopLevel = (message: Pick<SlackMessage, 'ts' | 'thread_ts'>): boolean => message.thread_ts === undefined || message.thread_ts === message.ts;

/** Channel housekeeping (joins, topic changes) is not a report. */
const HOUSEKEEPING = new Set(['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'channel_archive', 'channel_unarchive', 'pinned_item', 'unpinned_item']);
export const isReport = (message: SlackMessage): boolean => message.subtype === undefined || !HOUSEKEEPING.has(message.subtype);

/** Messages newer than `oldest`, oldest first (Slack returns newest first). */
export async function channelHistory(channel: string, oldest: string | undefined, limit = 100): Promise<SlackMessage[]> {
  const result = await slackCall<{ messages?: SlackMessage[] }>('conversations.history', { channel, limit, ...(oldest === undefined ? {} : { oldest, inclusive: false }) });
  return (result.messages ?? []).toSorted((left, right) => Number(left.ts) - Number(right.ts));
}

/** A thread's messages, parent first. */
export async function threadReplies(channel: string, ts: string, oldest?: string): Promise<SlackMessage[]> {
  const result = await slackCall<{ messages?: SlackMessage[] }>('conversations.replies', { channel, ts, limit: 200, ...(oldest === undefined ? {} : { oldest, inclusive: false }) });
  return result.messages ?? [];
}

export function messageLine(message: SlackMessage): string {
  const who = message.user ?? (message.bot_id === undefined ? 'unknown' : `bot ${message.bot_id}`);
  const files = (message.files ?? []).map((file) => ` [file: ${file.name ?? file.id ?? 'attachment'}${file.permalink === undefined ? '' : ` ${file.permalink}`}]`).join('');
  return `${message.ts} <${who}>${message.thread_ts !== undefined && message.thread_ts !== message.ts ? ` (in thread ${message.thread_ts})` : ''}: ${message.text ?? ''}${files}`;
}
