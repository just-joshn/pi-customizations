import { type Context, type Message, normalizeContext, type Tool } from '@earendil-works/pi-ai';
import { BLOCK_TEXT, BLOCK_TOOL, BLOCK_UNKNOWN, CACHE_READ_TOKENS, CACHE_WRITE_TOKENS, INPUT_TOKENS, OUTPUT_TOKENS_FINAL, OUTPUT_TOKENS_START } from './constants.ts';

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

export const readTool: Tool = { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } as never };
export const customTool: Tool = { name: 'my_tool', description: 'Custom', parameters: { type: 'object' } as never };

export const transcript = (): Message[] => [
  { role: 'user', content: 'hello', timestamp: 1 },
  { role: 'user', content: '   ', timestamp: 1 },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'look \uD800' },
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
    ],
    timestamp: 1,
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'ok' },
      { type: 'text', text: '  ' },
      { type: 'thinking', thinking: 'signed', thinkingSignature: 'sig' },
      { type: 'thinking', thinking: 'unsigned' },
      { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'a' } },
      { type: 'toolCall', id: 't2', name: 'my_tool', arguments: {} },
    ],
    api: 'custom-anthropic-api',
    provider: 'custom-anthropic',
    model: 'claude-sonnet-4-5',
    usage,
    stopReason: 'toolUse',
    timestamp: 1,
  },
  { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'file' }], isError: false, timestamp: 1 },
  { role: 'toolResult', toolCallId: 't2', toolName: 'my_tool', content: [{ type: 'image', data: 'BBB', mimeType: 'image/jpeg' }], isError: true, timestamp: 1 },
];

export const context = (overrides: Partial<Context> = {}) => normalizeContext({ systemPrompt: 'Be brief.', messages: transcript(), tools: [readTool, customTool], ...overrides });

const startUsage = { input_tokens: INPUT_TOKENS, output_tokens: OUTPUT_TOKENS_START, cache_read_input_tokens: CACHE_READ_TOKENS, cache_creation_input_tokens: CACHE_WRITE_TOKENS };
const finalUsage = { input_tokens: INPUT_TOKENS, output_tokens: OUTPUT_TOKENS_FINAL, cache_read_input_tokens: CACHE_READ_TOKENS, cache_creation_input_tokens: CACHE_WRITE_TOKENS };

export const streamEvents = [
  { type: 'message_start', message: { usage: startUsage } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: BLOCK_TEXT, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: BLOCK_TEXT, delta: { type: 'text_delta', text: 'Hi ' } },
  { type: 'content_block_delta', index: BLOCK_TEXT, delta: { type: 'text_delta', text: 'there' } },
  { type: 'content_block_stop', index: BLOCK_TEXT },
  { type: 'content_block_start', index: BLOCK_TOOL, content_block: { type: 'tool_use', id: 'call1', name: 'Read', input: {} } },
  { type: 'content_block_delta', index: BLOCK_TOOL, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
  { type: 'content_block_delta', index: BLOCK_TOOL, delta: { type: 'input_json_delta', partial_json: '"b.txt"}' } },
  { type: 'content_block_stop', index: BLOCK_TOOL },
  { type: 'content_block_delta', index: BLOCK_UNKNOWN, delta: { type: 'text_delta', text: 'ignored' } },
  { type: 'content_block_stop', index: BLOCK_UNKNOWN },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: finalUsage },
];
