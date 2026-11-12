import type { ThreadReplyAction } from './model.ts';
import type { ThreadDestination, ThreadMessage } from './outbox.ts';
import { type AutomationStore, readCursor, writeCursor } from './store.ts';

export interface SlackApi {
  fetch: typeof fetch;
  token: string;
  baseUrl?: string;
}

interface SlackMessage {
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  files?: unknown[];
  metadata?: { event_type?: string; event_payload?: Record<string, unknown> };
}

const MARKER_EVENT = 'pstack_action';

async function call<T>(api: SlackApi, method: string, body: Record<string, unknown>): Promise<T> {
  const response = await api.fetch(new URL(method, api.baseUrl ?? 'https://slack.com/api/'), {
    method: 'POST',
    headers: { authorization: `Bearer ${api.token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Slack ${method} failed: HTTP ${response.status}`);
  const result = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (result.ok !== true) throw new Error(`Slack ${method} failed: ${result.error ?? 'unknown_error'}`);
  return result;
}

type Page = { messages?: SlackMessage[]; has_more?: boolean; response_metadata?: { next_cursor?: string } };

async function allPages(api: SlackApi, method: string, body: Record<string, unknown>): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const page = await call<Page>(api, method, { ...body, limit: 200, ...(cursor ? { cursor } : {}) });
    messages.push(...(page.messages ?? []));
    cursor = page.has_more ? page.response_metadata?.next_cursor : undefined;
  } while (cursor);
  return messages;
}

const HOUSEKEEPING = new Set(['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'channel_archive', 'channel_unarchive', 'pinned_item', 'unpinned_item']);
const isNewReport = (message: SlackMessage) => (message.thread_ts === undefined || message.thread_ts === message.ts) && !HOUSEKEEPING.has(message.subtype ?? '');

/**
 * One `conversations.history` pass from the stored cursor, oldest first. The cursor moves past a message only after
 * `handle` accepted it, so a crash replays at most that message, which the event store deduplicates. The first pass
 * only sets the cursor: reports already in the channel never fire.
 */
export async function pollSlackOnce(api: SlackApi, channel: string, store: AutomationStore, handle: (raw: Record<string, unknown>) => Promise<unknown>, now: () => Date): Promise<number> {
  const oldest = readCursor(store);
  if (oldest === undefined) {
    writeCursor(store, (now().getTime() / 1000).toFixed(6));
    return 0;
  }
  const messages = (await allPages(api, 'conversations.history', { channel, oldest, inclusive: false })).filter((message) => Number(message.ts) > Number(oldest));
  messages.sort((left, right) => Number(left.ts) - Number(right.ts));
  let handled = 0;
  for (const message of messages) {
    if (isNewReport(message)) {
      await handle({ source_channel_id: channel, ts: message.ts, thread_ts: '', user: message.user ?? message.bot_id ?? '', text: message.text ?? '', files: message.files ?? [] });
      handled += 1;
    }
    writeCursor(store, message.ts);
  }
  return handled;
}

/** Slack as an outbox destination: the action id rides in message metadata, which `conversations.replies` returns. */
export function slackDestination(api: SlackApi): ThreadDestination {
  return {
    async readThread(channel, threadTs) {
      const messages = await allPages(api, 'conversations.replies', { channel, ts: threadTs, include_all_metadata: true });
      return messages.map((message): ThreadMessage => {
        const id = message.metadata?.event_type === MARKER_EVENT ? message.metadata.event_payload?.['action_id'] : undefined;
        return { ts: message.ts, user: message.user ?? message.bot_id ?? '', text: message.text ?? '', ...(typeof id === 'string' ? { marker: id } : {}) };
      });
    },
    async post(action: ThreadReplyAction) {
      const result = await call<{ ts: string }>(api, 'chat.postMessage', {
        channel: action.channel,
        thread_ts: action.threadTs,
        text: action.text,
        metadata: { event_type: MARKER_EVENT, event_payload: { action_id: action.id } },
      });
      return { ts: result.ts };
    },
  };
}
