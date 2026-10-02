import type { Context, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { ask, readTool, toolCallTurn, toolResult, user } from '../test/support/context.ts';
import { errorReply, type Reply, splitReply, sseReply } from '../test/support/messages-server.ts';
import { isRecord } from '../test/support/request-body.ts';
import { finish, frames, messageStart, textBlock, textMessage, thinkingBlock, toolUseMessage } from '../test/support/sse.ts';

export interface Scenario {
  readonly name: string;
  readonly modelId: string;
  readonly context: Context;
  readonly options?: SimpleStreamOptions;
  readonly reply: Reply;
}

const SONNET = 'claude-sonnet-4-6';
const HAIKU = 'claude-haiku-4-5';

function multibyteSplit(): Reply {
  const body = frames(textMessage('caf\u00e9'));
  return splitReply(body, new TextEncoder().encode(body).indexOf(0xc3) + 1);
}

function replaceMetadata(payload: unknown): unknown {
  return isRecord(payload) ? { ...payload, metadata: { user_id: 'replaced' } } : payload;
}

export const scenarios: readonly Scenario[] = [
  {
    name: 'text with system prompt and tools',
    modelId: SONNET,
    context: ask('hi', { systemPrompt: 'You are helpful.', tools: [readTool] }),
    reply: sseReply(textMessage('hello')),
  },
  {
    name: 'tool call maps Claude Code names back',
    modelId: SONNET,
    context: ask('read a', { systemPrompt: 'SYS', tools: [readTool] }),
    reply: sseReply(toolUseMessage('toolu_1', 'Read', ['{"path":', '"a.txt"}'])),
  },
  {
    name: 'tool result history',
    modelId: SONNET,
    context: { systemPrompt: 'SYS', tools: [readTool], messages: [user('read a'), toolCallTurn('toolu_1'), toolResult('toolu_1', [{ type: 'text', text: 'contents' }])] },
    reply: sseReply(textMessage('done')),
  },
  {
    name: 'adaptive thinking',
    modelId: SONNET,
    context: ask('think'),
    options: { reasoning: 'medium' },
    reply: sseReply([messageStart(), ...thinkingBlock(0, 'hmm', 'sig'), ...textBlock(1, 'answer'), ...finish('end_turn')]),
  },
  {
    name: 'budget thinking',
    modelId: HAIKU,
    context: ask('think'),
    options: { reasoning: 'low', maxTokens: 4000 },
    reply: sseReply(textMessage('ok')),
  },
  {
    name: 'max tokens',
    modelId: SONNET,
    context: ask('long'),
    reply: sseReply([messageStart(), ...textBlock(0, 'cut'), ...finish('max_tokens')]),
  },
  { name: 'multibyte split across chunks', modelId: SONNET, context: ask('hi'), reply: multibyteSplit() },
  { name: 'context overflow', modelId: SONNET, context: ask('hi'), reply: errorReply(400, 'prompt is too long: 9 tokens > 8 maximum') },
  {
    name: 'mid-stream error event',
    modelId: SONNET,
    context: ask('hi'),
    reply: sseReply([messageStart(), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]),
  },
  { name: 'aborted before send', modelId: SONNET, context: ask('hi'), options: { signal: AbortSignal.abort() }, reply: sseReply(textMessage('late')) },
  {
    name: 'caller headers override the user agent',
    modelId: SONNET,
    context: ask('hi'),
    options: { headers: { 'user-agent': 'claude-cli/9.9.9' } },
    reply: sseReply(textMessage('ok')),
  },
  {
    name: 'onPayload replacement',
    modelId: SONNET,
    context: ask('hi'),
    options: { onPayload: replaceMetadata },
    reply: sseReply(textMessage('ok')),
  },
];
