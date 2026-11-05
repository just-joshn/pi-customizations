// Cursor's Slack "New message in channel" trigger, as a poll of the Slack Web API: every message posted after the
// subscription started fires once, in order, with its thread coordinates. The read position is stored next to the
// registry, so a supervisor that was down for a while picks up every message it missed instead of skipping them.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { re2Test } from '../shell-output-watch.ts';
import { channelHistory, isReport, isTopLevel, type SlackMessage, threadReplies } from './client.ts';

export const SLACK_POLL_ENV = 'PSTACK_SLACK_POLL_MS';
export const DEFAULT_SLACK_POLL_MS = 20_000;
const RECENT_THREADS = 100;

export interface SlackTriggerConfig {
  channel: string;
  filter?: string | undefined;
}

/** Where the trigger has read up to: top-level messages, and thread replies when a filter admits them. */
export interface SlackCursor {
  ts: string;
  replyTs: string;
}

export interface SlackFire {
  /** Deduplicates the event across restarts and retries. */
  eventId: string;
  message: SlackMessage;
}

const later = (left: string, right: string) => (Number(left) >= Number(right) ? left : right);

export function cursorFile(runtimeDir: string, subscriptionId: string): string {
  return join(runtimeDir, `slack-${subscriptionId}.json`);
}

export function readCursor(file: string): SlackCursor | undefined {
  if (!existsSync(file)) return undefined;
  const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<SlackCursor>;
  return typeof value.ts === 'string' && typeof value.replyTs === 'string' ? { ts: value.ts, replyTs: value.replyTs } : undefined;
}

export function writeCursor(file: string, cursor: SlackCursor): void {
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(cursor), { mode: 0o600 });
  renameSync(temporary, file);
}

/** The read position when a subscription starts: now, so messages already in the channel never fire. */
export function startCursor(nowMs: number): SlackCursor {
  const ts = (nowMs / 1000).toFixed(6);
  return { ts, replyTs: ts };
}

/**
 * The messages that fire since `cursor`, oldest first, and the cursor after them. Without a filter only new top-level
 * messages fire; with one, messages and thread replies whose text matches it.
 */
export async function pollSlack(config: SlackTriggerConfig, cursor: SlackCursor): Promise<{ fires: SlackFire[]; cursor: SlackCursor }> {
  const pattern = config.filter === undefined ? undefined : re2Test(config.filter);
  const matches = (message: SlackMessage) => pattern === undefined || pattern(message.text ?? '');
  const fires: SlackFire[] = [];
  let { ts, replyTs } = cursor;
  for (const message of await channelHistory(config.channel, cursor.ts)) {
    ts = later(ts, message.ts);
    if (!isReport(message) || !isTopLevel(message) || !matches(message)) continue;
    fires.push({ eventId: `slack:${config.channel}:${message.ts}`, message });
  }
  if (pattern !== undefined) {
    const parents = (await channelHistory(config.channel, undefined, RECENT_THREADS)).filter((message) => (message.reply_count ?? 0) > 0 && Number(message.latest_reply ?? '0') > Number(cursor.replyTs));
    for (const parent of parents)
      for (const reply of await threadReplies(config.channel, parent.ts, cursor.replyTs)) {
        if (isTopLevel(reply) || Number(reply.ts) <= Number(cursor.replyTs)) continue;
        replyTs = later(replyTs, reply.ts);
        if (isReport(reply) && matches(reply)) fires.push({ eventId: `slack:${config.channel}:${reply.ts}`, message: reply });
      }
    replyTs = later(replyTs, ts);
  }
  fires.sort((left, right) => Number(left.message.ts) - Number(right.message.ts));
  return { fires, cursor: { ts, replyTs } };
}

/** The wake text: the subscription's prompt, then the message as untrusted data with the coordinates benny reads. */
export function slackEventText(name: string, prompt: string, channel: string, message: SlackMessage): string {
  const trigger = {
    source_channel_id: channel,
    ts: message.ts,
    thread_ts: isTopLevel(message) ? '' : (message.thread_ts ?? ''),
    user: message.user ?? message.bot_id ?? '',
    text: message.text ?? '',
    files: (message.files ?? []).map((file) => ({ name: file.name ?? '', mimetype: file.mimetype ?? '', url_private: file.url_private ?? '', permalink: file.permalink ?? '' })),
  };
  return [`[slack] ${name}`, prompt, '<slack_event>', JSON.stringify({ trigger }, null, 2), '</slack_event>'].join('\n\n');
}
