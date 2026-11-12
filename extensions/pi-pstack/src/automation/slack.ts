import { readFileSync } from 'node:fs';

import type { Download } from './attachments.ts';
import type { ThreadReplyAction } from './model.ts';
import type { ChannelMessage, OperationsDestination, ThreadDestination, ThreadMessage } from './outbox.ts';
import { type AutomationStore, readCursor, writeCursor } from './store.ts';

export interface SlackApi {
  fetch: typeof fetch;
  token: string;
  baseUrl?: string;
  /** How a reply with files waits for the message Slack makes of an upload to show in the thread. Defaults to 15 reads, one second apart. */
  upload?: { polls?: number; sleep?: (ms: number) => Promise<void>; pollMs?: number };
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
/** A reply that carries files has no message metadata to hold its action id, so the id rides in its first file's title. */
const FILE_MARKER = /pstack-action:(act-[0-9a-f]{16})/;
/** Errors that say the credential or workspace will never let this upload through, so the reply goes without its files. Anything else is retried. */
const UPLOAD_REFUSED = /missing_scope|not_allowed_token_type|access_denied|file_uploads_disabled|restricted_action|no_permission|ekm_access_denied|file_upload_not_allowed/;

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

/** Slack's `files.getUploadURLExternal` takes form fields, not JSON. */
async function callForm<T>(api: SlackApi, method: string, fields: Record<string, string>): Promise<T> {
  const response = await api.fetch(new URL(method, api.baseUrl ?? 'https://slack.com/api/'), {
    method: 'POST',
    headers: { authorization: `Bearer ${api.token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
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
  const destination: ThreadDestination & OperationsDestination = {
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
        const fileId = (message.files ?? []).flatMap((file) => FILE_MARKER.exec(String((file as { title?: unknown }).title ?? ''))?.[1] ?? []).at(0);
        const marker = typeof id === 'string' ? id : fileId;
        return { ts: message.ts, user: message.user ?? message.bot_id ?? '', text: message.text ?? '', ...(marker === undefined ? {} : { marker }) };
      });
    },
    async post(action: ThreadReplyAction) {
      const text = (withFiles: boolean) => (withFiles ? action.text : (action.textWithoutAttachments ?? action.text));
      const plain = async (): Promise<{ ts: string }> => {
        const result = await call<{ ts: string }>(api, 'chat.postMessage', { channel: action.channel, thread_ts: action.threadTs, text: text(false), metadata: { event_type: MARKER_EVENT, event_payload: { action_id: action.id } } });
        return { ts: result.ts };
      };
      if (action.attachments === undefined || action.attachments.length === 0) return plain();
      try {
        return await postWithFiles(api, action, () => destination.readThread(action.channel, action.threadTs));
      } catch (error) {
        if (!UPLOAD_REFUSED.test(error instanceof Error ? error.message : String(error))) throw error;
        return plain();
      }
    },
  };
  return destination;
}

/**
 * One reply carrying its evidence files: each file goes to the upload url Slack hands out, and `files.completeUploadExternal`
 * shares them all in the thread with the reply text as the message's comment, so the reply stays one message. That call
 * answers with file ids, not a message, so the reply's `ts` is found by the action id in its first file's title, the same
 * marker the outbox looks for before it posts. The credential goes to `slack.com/api` only: the upload url is Slack's
 * signed `files.slack.com` address and gets the bytes alone.
 */
async function postWithFiles(api: SlackApi, action: ThreadReplyAction, readThread: () => Promise<ThreadMessage[]>): Promise<{ ts: string }> {
  const files: { id: string; title: string }[] = [];
  for (const [index, file] of (action.attachments ?? []).entries()) {
    const bytes = readFileSync(file.path);
    const start = await callForm<{ upload_url?: string; file_id?: string }>(api, 'files.getUploadURLExternal', { filename: file.name, length: String(bytes.byteLength) });
    if (typeof start.upload_url !== 'string' || typeof start.file_id !== 'string') throw new Error('Slack files.getUploadURLExternal failed: no upload url');
    const target = new URL(start.upload_url);
    if (target.protocol !== 'https:' || target.hostname !== FILE_HOST) throw new Error(`Slack files.getUploadURLExternal failed: the upload url is not on ${FILE_HOST}`);
    const sent = await api.fetch(target, { method: 'POST', headers: { 'content-type': file.mimetype }, body: bytes });
    if (!sent.ok) throw new Error(`Slack file upload failed: HTTP ${sent.status}`);
    files.push({ id: start.file_id, title: index === 0 ? `${file.name} (pstack-action:${action.id})` : file.name });
  }
  await call(api, 'files.completeUploadExternal', { files, channel_id: action.channel, thread_ts: action.threadTs, initial_comment: action.text });
  const { polls = 15, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), pollMs = 1000 } = api.upload ?? {};
  for (let attempt = 0; attempt < polls; attempt += 1) {
    const landed = (await readThread()).find((message) => message.marker === action.id);
    if (landed !== undefined) return { ts: landed.ts };
    await sleep(pollMs);
  }
  throw new Error(`the evidence reply was shared but is not visible under the thread ${action.threadTs} yet; the next attempt looks for it before it posts again`);
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
