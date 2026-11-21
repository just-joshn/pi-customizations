import type Anthropic from '@anthropic-ai/sdk';
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { NameCodec } from '../tools/names.ts';
import { EPHEMERAL_CACHE, sanitizeSurrogates, toToolResultContent, toUserBlock, type UserContentBlock } from './content.ts';

type Param = Anthropic.Beta.BetaMessageParam;
type AssistantBlock = Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaThinkingBlockParam | Anthropic.Beta.BetaToolUseBlockParam;
type CacheableBlock = UserContentBlock | Anthropic.Beta.BetaToolResultBlockParam;

function convertUser(message: UserMessage): Param[] {
  if (typeof message.content === 'string') {
    return message.content.trim() ? [{ role: 'user', content: sanitizeSurrogates(message.content) }] : [];
  }
  const blocks = message.content.map(toUserBlock);
  return blocks.length > 0 ? [{ role: 'user', content: blocks }] : [];
}

function convertAssistantBlock(block: AssistantMessage['content'][number], names: NameCodec): AssistantBlock[] {
  if (block.type === 'text') {
    return block.text.trim() ? [{ type: 'text', text: sanitizeSurrogates(block.text) }] : [];
  }
  if (block.type === 'thinking') {
    if (!block.thinking.trim()) return [];
    if (!block.thinkingSignature) return [{ type: 'text', text: sanitizeSurrogates(block.thinking) }];
    return [{ type: 'thinking', thinking: sanitizeSurrogates(block.thinking), signature: block.thinkingSignature }];
  }
  return [{ type: 'tool_use', id: block.id, name: names.toWire(block.name), input: block.arguments }];
}

function convertAssistant(message: AssistantMessage, names: NameCodec): Param[] {
  const blocks = message.content.flatMap((block) => convertAssistantBlock(block, names));
  return blocks.length > 0 ? [{ role: 'assistant', content: blocks }] : [];
}

const toToolResult = (message: ToolResultMessage): Anthropic.Beta.BetaToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: message.toolCallId,
  content: toToolResultContent(message.content),
  is_error: message.isError,
});

/** Anthropic wants every result of one assistant turn in a single user message, so a run of tool results joins the previous param. */
function appendToolResult(params: readonly Param[], message: ToolResultMessage, joinsRun: boolean): Param[] {
  const last = params.at(-1);
  if (joinsRun && last?.role === 'user' && Array.isArray(last.content)) {
    return [...params.slice(0, -1), { role: 'user', content: [...last.content, toToolResult(message)] }];
  }
  return [...params, { role: 'user', content: [toToolResult(message)] }];
}

function appendMessage(params: readonly Param[], message: Message, previous: Message | undefined, names: NameCodec): Param[] {
  if (message.role === 'toolResult') return appendToolResult(params, message, previous?.role === 'toolResult');
  if (message.role === 'user') return [...params, ...convertUser(message)];
  if (message.role === 'assistant') return [...params, ...convertAssistant(message, names)];
  return [...params];
}

const isCacheable = (block: Anthropic.Beta.BetaContentBlockParam): block is CacheableBlock => block.type === 'text' || block.type === 'image' || block.type === 'tool_result';

/** Marks the last user block as a cache breakpoint. A plain string becomes a text block first, because only blocks carry `cache_control`. */
function withCacheOnLastUserBlock(params: readonly Param[]): Param[] {
  const last = params.at(-1);
  if (last?.role !== 'user') return [...params];
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
  const lastBlock = blocks.at(-1);
  if (!lastBlock || !isCacheable(lastBlock)) return [...params];
  return [...params.slice(0, -1), { role: 'user', content: [...blocks.slice(0, -1), { ...lastBlock, cache_control: EPHEMERAL_CACHE }] }];
}

export function convertMessages(messages: readonly Message[], names: NameCodec): Param[] {
  const params = messages.reduce<Param[]>((acc, message, index) => appendMessage(acc, message, messages[index - 1], names), []);
  return withCacheOnLastUserBlock(params);
}
