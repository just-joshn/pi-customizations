import type Anthropic from '@anthropic-ai/sdk';
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import { EPHEMERAL_CACHE } from '../request/config.ts';
import { toClaudeCodeName } from '../tools/names.ts';
import { sanitizeSurrogates, toToolResultContent, toUserBlock, type UserContentBlock } from './content.ts';

type AssistantBlock = Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaThinkingBlockParam | Anthropic.Beta.BetaToolUseBlockParam;
type ToolResultBlock = Anthropic.Beta.BetaToolResultBlockParam;
type UserParam = { readonly role: 'user'; readonly content: string | readonly (UserContentBlock | ToolResultBlock)[] };
type AssistantParam = { readonly role: 'assistant'; readonly content: readonly AssistantBlock[] };
type ConvertedParam = UserParam | AssistantParam;

type MessageGroup = { readonly role: 'single'; readonly message: Message } | { readonly role: 'toolResult'; readonly messages: readonly ToolResultMessage[] };

const isToolResult = (message: Message | undefined): message is ToolResultMessage => message?.role === 'toolResult';

function toGroup(run: readonly Message[]): MessageGroup {
  const [first] = run;
  if (run.length === 1 && first && !isToolResult(first)) return { role: 'single', message: first };
  return { role: 'toolResult', messages: run.filter(isToolResult) };
}

function groupMessages(messages: readonly Message[]): readonly MessageGroup[] {
  const starts = messages.flatMap((message, index) => (isToolResult(message) && isToolResult(messages[index - 1]) ? [] : [index]));
  return starts.map((start, position) => toGroup(messages.slice(start, starts[position + 1] ?? messages.length)));
}

function convertUser(message: UserMessage): UserParam[] {
  if (typeof message.content === 'string') {
    return message.content.trim() ? [{ role: 'user', content: sanitizeSurrogates(message.content) }] : [];
  }
  const blocks = message.content.map(toUserBlock);
  return blocks.length > 0 ? [{ role: 'user', content: blocks }] : [];
}

function convertAssistantBlock(block: AssistantMessage['content'][number], isOAuth: boolean): AssistantBlock[] {
  switch (block.type) {
    case 'text':
      return block.text.trim() ? [{ type: 'text', text: sanitizeSurrogates(block.text) }] : [];
    case 'thinking':
      if (!block.thinking.trim()) return [];
      if (!block.thinkingSignature) return [{ type: 'text', text: sanitizeSurrogates(block.thinking) }];
      return [{ type: 'thinking', thinking: sanitizeSurrogates(block.thinking), signature: block.thinkingSignature }];
    case 'toolCall':
      return [{ type: 'tool_use', id: block.id, name: isOAuth ? toClaudeCodeName(block.name) : block.name, input: block.arguments }];
  }
}

function convertAssistant(message: AssistantMessage, isOAuth: boolean): AssistantParam[] {
  const blocks = message.content.flatMap((block) => convertAssistantBlock(block, isOAuth));
  return blocks.length > 0 ? [{ role: 'assistant', content: blocks }] : [];
}

const toToolResult = (message: ToolResultMessage): ToolResultBlock => ({
  type: 'tool_result',
  tool_use_id: message.toolCallId,
  content: toToolResultContent(message.content),
  is_error: message.isError,
});

function convertGroup(group: MessageGroup, isOAuth: boolean): ConvertedParam[] {
  if (group.role === 'toolResult') return [{ role: 'user', content: group.messages.map(toToolResult) }];
  const { message } = group;
  if (message.role === 'user') return convertUser(message);
  if (message.role === 'assistant') return convertAssistant(message, isOAuth);
  return [];
}

function withCacheOnLastUserBlock(params: readonly ConvertedParam[]): readonly ConvertedParam[] {
  const last = params.at(-1);
  if (last?.role !== 'user' || typeof last.content === 'string') return params;
  const lastBlock = last.content.at(-1);
  if (!lastBlock) return params;
  const content = [...last.content.slice(0, -1), { ...lastBlock, cache_control: EPHEMERAL_CACHE }];
  return [...params.slice(0, -1), { ...last, content }];
}

function toMessageParam(param: ConvertedParam): Anthropic.Beta.BetaMessageParam {
  if (param.role === 'assistant') return { role: 'assistant', content: [...param.content] };
  return { role: 'user', content: typeof param.content === 'string' ? param.content : [...param.content] };
}

export function convertMessages(messages: readonly Message[], isOAuth: boolean): Anthropic.Beta.BetaMessageParam[] {
  const params = groupMessages(messages).flatMap((group) => convertGroup(group, isOAuth));
  return withCacheOnLastUserBlock(params).map(toMessageParam);
}
