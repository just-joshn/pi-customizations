// Cursor's Slack tools for agents that own a Slack conversation (Read Slack channels, Send to Slack, reactions). Only a
// top-level agent gets them: subagents never post to Slack or hold its token, the rule benny's operational files keep.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { messageLine, recentMessages, slackCall, slackToken, thread } from './client.ts';

export const SLACK_TOOLS = ['slack_read_channel', 'slack_read_thread', 'slack_send', 'slack_react', 'slack_update'] as const;

const text = (value: string, details: Record<string, unknown> = {}) => ({ content: [{ type: 'text' as const, text: value }], details });
const CHANNEL = Type.String({ description: 'Channel ID, such as C0123456789.' });
const TS = Type.String({ description: 'Message timestamp (ts), such as 1730800000.123456.' });

/** Turns the Slack tools on once a token exists, so a session that connects Slack mid-chat can use them. */
export function activateSlackTools(pi: ExtensionAPI): void {
  if (slackToken() === undefined) return;
  const active = pi.getActiveTools();
  const missing = SLACK_TOOLS.filter((name) => !active.includes(name));
  if (missing.length > 0) pi.setActiveTools([...active, ...missing]);
}

export function registerSlackTools(pi: ExtensionAPI): void {
  const connected = slackToken() !== undefined;
  pi.registerTool({
    name: 'slack_read_channel',
    label: 'Slack: read channel',
    description: 'Read the latest top-level messages of a Slack channel, oldest first, with each message ts and thread reply count.',
    promptSnippet: 'Read recent messages of a Slack channel',
    parameters: Type.Object({ channel: CHANNEL, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: 'How many messages (default 20).' })) }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    defaultActive: connected,
    async execute(_id, params) {
      const messages = (await recentMessages(params.channel, params.limit ?? 20)).map((message) => `${messageLine(message)}${message.reply_count ? ` (${message.reply_count} replies)` : ''}`);
      return text(messages.length === 0 ? 'No messages.' : messages.join('\n'), { count: messages.length });
    },
  });
  pi.registerTool({
    name: 'slack_read_thread',
    label: 'Slack: read thread',
    description: "Read a Slack thread: its root message and every reply, oldest first, with each message's author, ts, text, and attached files.",
    promptSnippet: 'Read a Slack thread',
    parameters: Type.Object({ channel: CHANNEL, thread_ts: TS }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    defaultActive: connected,
    async execute(_id, params) {
      const messages = await thread(params.channel, params.thread_ts);
      return text(messages.length === 0 ? 'No such thread.' : messages.map(messageLine).join('\n'), { count: messages.length });
    },
  });
  pi.registerTool({
    name: 'slack_send',
    label: 'Slack: send',
    description:
      'Post a message to a Slack channel as the bot. Pass thread_ts to reply inside that thread; without it the message is a new root message in the channel. Mention people with <@U123> and user groups with <!subteam^S123|@handle> in the text.',
    promptSnippet: 'Post to a Slack channel or reply in a thread',
    parameters: Type.Object({ channel: CHANNEL, text: Type.String({ description: 'Message text (Slack mrkdwn).' }), thread_ts: Type.Optional(TS) }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    defaultActive: connected,
    async execute(_id, params) {
      const result = await slackCall<{ ts?: string; channel?: string }>('chat.postMessage', { channel: params.channel, text: params.text, ...(params.thread_ts === undefined ? {} : { thread_ts: params.thread_ts }) });
      return text(`Posted ${params.thread_ts === undefined ? 'a root message' : `a reply in thread ${params.thread_ts}`} to ${result.channel ?? params.channel} (ts ${result.ts ?? 'unknown'}).`, {
        ts: result.ts,
        channel: result.channel ?? params.channel,
      });
    },
  });
  pi.registerTool({
    name: 'slack_react',
    label: 'Slack: react',
    description: 'Add an emoji reaction to a Slack message, such as a status emoji on a report. Pass the emoji name without colons.',
    promptSnippet: 'React to a Slack message with an emoji',
    parameters: Type.Object({ channel: CHANNEL, ts: TS, emoji: Type.String({ description: 'Emoji name without colons, such as eyes or white_check_mark.' }) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    defaultActive: connected,
    async execute(_id, params) {
      await slackCall('reactions.add', { channel: params.channel, timestamp: params.ts, name: params.emoji.replace(/^:|:$/g, '') });
      return text(`Reacted :${params.emoji.replace(/^:|:$/g, '')}: to ${params.ts}.`);
    },
  });
  pi.registerTool({
    name: 'slack_update',
    label: 'Slack: update',
    description: 'Edit a message the bot posted earlier, such as one status message kept current in an operations thread.',
    promptSnippet: "Edit the bot's earlier Slack message",
    parameters: Type.Object({ channel: CHANNEL, ts: TS, text: Type.String({ description: 'The new text.' }) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    defaultActive: connected,
    async execute(_id, params) {
      await slackCall('chat.update', { channel: params.channel, ts: params.ts, text: params.text });
      return text(`Updated message ${params.ts}.`);
    },
  });
}
