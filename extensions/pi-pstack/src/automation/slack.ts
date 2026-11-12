import type { Download } from './attachments.ts';
import type { ThreadReplyAction } from './model.ts';
import type { ChannelMessage, OperationsDestination, ThreadDestination, ThreadMessage } from './outbox.ts';
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
export function slackDestination(api: SlackApi): ThreadDestination & OperationsDestination {
  const marked = (message: SlackMessage) => (message.metadata?.event_type === MARKER_EVENT ? message.metadata.event_payload?.['action_id'] : undefined);
  const asMessage = (message: SlackMessage): ChannelMessage => ({ ts: message.ts, text: message.text ?? '' });
  return {
    async findRoot(channel, marker) {
      const page = await call<Page>(api, 'conversations.history', { channel, limit: 100, include_all_metadata: true });
      const found = (page.messages ?? []).find((message) => marked(message) === marker);
      return found === undefined ? undefined : asMessage(found);
    },
    async postRoot(action) {
      const result = await call<{ ts: string }>(api, 'chat.postMessage', { channel: action.channel, text: action.text, metadata: { event_type: MARKER_EVENT, event_payload: { action_id: action.id } } });
      return { ts: result.ts };
    },
    async readMessage(channel, ts) {
      const page = await call<Page>(api, 'conversations.history', { channel, latest: ts, oldest: ts, inclusive: true, limit: 1 });
      const found = (page.messages ?? []).find((message) => message.ts === ts);
      return found === undefined ? undefined : asMessage(found);
    },
    async edit(action, ts) {
      await call(api, 'chat.update', { channel: action.channel, ts, text: action.text, metadata: { event_type: MARKER_EVENT, event_payload: { action_id: action.rootId } } });
    },
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

const FILE_HOST = 'files.slack.com';

/**
 * Downloads a Slack private file with the parent's credential, which goes to `files.slack.com` over https and nowhere
 * else: a link anywhere else is refused before any request. A redirect is not followed, so the credential cannot be
 * carried to another host, and an HTML page (what Slack answers a token that cannot read files) is not a file.
 */
export function slackFileDownloader(api: SlackApi): Download {
  return async (url, maxBytes) => {
    let link: URL;
    try {
      link = new URL(url);
    } catch {
      throw new Error('the link is not a Slack file link');
    }
    if (link.protocol !== 'https:' || link.hostname !== FILE_HOST || link.port !== '' || link.username !== '' || link.password !== '') throw new Error(`the link is not a Slack file link (https://${FILE_HOST}/...)`);
    const response = await api.fetch(link, { method: 'GET', redirect: 'manual', headers: { authorization: `Bearer ${api.token}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (/^text\/html/i.test(response.headers.get('content-type') ?? '')) throw new Error('Slack answered with a sign-in page, so the token cannot read files; it needs the files:read scope');
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`the file is larger than ${maxBytes} bytes`);
    const reader = response.body?.getReader();
    if (reader === undefined) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`the file is larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  };
}
