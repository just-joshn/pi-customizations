import { createHash } from 'node:crypto';

import type { AssistantMessage, Message } from '@earendil-works/pi-ai';

/** One Pi message flattened to the plain text a Codex prompt can carry. */
export interface Turn {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly text: string;
}

const ROLE_LABELS: Record<Turn['role'], string> = {
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool result',
};

function sanitize(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, '\uFFFD');
}

function userText(message: Extract<Message, { role: 'user' }>): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.map((block) => (block.type === 'text' ? block.text : '[image omitted]')).join('\n');
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'toolCall') return `[called ${block.name} with ${JSON.stringify(block.arguments)}]`;
      return '';
    })
    .filter((text) => text.length > 0)
    .join('\n');
}

function toolResultText(message: Extract<Message, { role: 'toolResult' }>): string {
  const body = message.content.map((block) => (block.type === 'text' ? block.text : '[image omitted]')).join('\n');
  return `${message.toolName}${message.isError ? ' (error)' : ''}:\n${body}`;
}

function toTurn(message: Message): Turn | undefined {
  switch (message.role) {
    case 'user':
      return { role: 'user', text: sanitize(userText(message)) };
    case 'assistant':
      return { role: 'assistant', text: sanitize(assistantText(message)) };
    case 'toolResult':
      return { role: 'tool', text: sanitize(toolResultText(message)) };
    default:
      return undefined;
  }
}

/** Flatten Pi messages to turns, dropping system messages and turns with no text. */
export function toTurns(messages: readonly Message[]): Turn[] {
  return messages.flatMap((message) => {
    const turn = toTurn(message);
    return turn && turn.text.trim().length > 0 ? [turn] : [];
  });
}

/** Identify a conversation prefix so a later request can continue the Codex thread that produced it. */
export function fingerprint(scope: string, turns: readonly Turn[]): string {
  return createHash('sha256')
    .update(JSON.stringify([scope, turns]))
    .digest('hex');
}

export function renderTurns(turns: readonly Turn[]): string {
  return turns.map((turn) => `${ROLE_LABELS[turn.role]}:\n${turn.text}`).join('\n\n');
}

/** Prompt for a new Codex thread: Pi's instructions, then the whole conversation. */
export function renderNewThreadPrompt(systemPrompt: string | undefined, turns: readonly Turn[]): string {
  const instructions = systemPrompt?.trim();
  const onlyUserTurn = turns.length === 1 && turns[0]?.role === 'user';
  if (!instructions && onlyUserTurn) return turns[0]?.text ?? '';
  const sections = [instructions ? `Instructions from Pi:\n${sanitize(instructions)}` : '', `Conversation so far:\n\n${renderTurns(turns)}`, 'Reply to the last message.'];
  return sections.filter((section) => section.length > 0).join('\n\n');
}
