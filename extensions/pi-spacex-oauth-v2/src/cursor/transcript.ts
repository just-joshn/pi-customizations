import { createHash } from 'node:crypto';

import type { SDKImage, SDKUserMessage } from '@cursor/sdk';
import type { ImageContent, Message, TextContent, Tool, UserMessage } from '@earendil-works/pi-ai';

type Conversational = Exclude<Message, { role: 'system' }>;

const isConversational = (m: Message): m is Conversational => m.role !== 'system';

export const conversationOf = (messages: Message[]): Conversational[] => messages.filter(isConversational);

const textOf = (content: string | (TextContent | ImageContent)[]): string => (typeof content === 'string' ? content : content.map((c) => (c.type === 'text' ? c.text : '[image]')).join('\n'));

/** What identifies a message to Cursor: its visible text and tool call ids, not timestamps or thinking. */
function signature(message: Conversational): string {
  if (message.role === 'user') return `u:${textOf(message.content)}`;
  if (message.role === 'toolResult') return `r:${message.toolCallId}`;
  const parts = message.content.map((c) => (c.type === 'text' ? c.text : c.type === 'toolCall' ? `#${c.id}` : ''));
  return `a:${parts.join('')}`;
}

/** Key for an agent whose Cursor conversation matches this prompt, tool list, and history. */
export function conversationKey(systemPrompt: string, tools: Tool[], history: Conversational[]): string {
  const hash = createHash('sha256').update(systemPrompt).update('\0');
  for (const tool of tools) hash.update(tool.name).update('\0');
  for (const message of history) hash.update('\u0001').update(signature(message));
  return hash.digest('hex');
}

function renderMessage(message: Conversational): string {
  if (message.role === 'user') return `User: ${textOf(message.content)}`;
  if (message.role === 'toolResult') return `[${message.toolName} result${message.isError ? ', error' : ''}] ${textOf(message.content)}`;
  const parts = message.content.map((c) => (c.type === 'text' ? c.text : c.type === 'toolCall' ? `[called ${c.name} ${JSON.stringify(c.arguments)}]` : ''));
  return `Assistant: ${parts.filter(Boolean).join('\n')}`;
}

const toImages = (content: UserMessage['content']): SDKImage[] => (typeof content === 'string' ? [] : content.filter((c): c is ImageContent => c.type === 'image').map((c) => ({ data: c.data, mimeType: c.mimeType })));

const withImages = (text: string, images: SDKImage[]): SDKUserMessage => (images.length > 0 ? { text, images } : { text });

/** The newest user message, sent on its own to an agent that already holds the earlier history. */
export function followUpMessage(message: UserMessage): SDKUserMessage {
  return withImages(textOf(message.content), toImages(message.content));
}

/**
 * The first message to a fresh agent. Cursor's systemPrompt option is gated per account, so Pi's system prompt
 * travels in the message, followed by any earlier history Cursor has not seen.
 */
export function openingMessage(systemPrompt: string, history: Conversational[], latest: UserMessage | undefined): SDKUserMessage {
  const sections = [
    systemPrompt ? `<system_prompt>\n${systemPrompt}\n</system_prompt>` : '',
    history.length > 0 ? `<conversation_so_far>\n${history.map(renderMessage).join('\n')}\n</conversation_so_far>` : '',
    latest ? textOf(latest.content) : 'Continue from the conversation above.',
  ];
  return withImages(sections.filter(Boolean).join('\n\n'), latest ? toImages(latest.content) : []);
}
