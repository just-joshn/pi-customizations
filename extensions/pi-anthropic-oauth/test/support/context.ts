import type { AssistantMessage, Context, ImageContent, TextContent, Tool, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';

export const readTool: Tool = {
  name: 'read',
  description: 'Read a file',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
};

export function user(content: UserMessage['content']): UserMessage {
  return { role: 'user', content, timestamp: 1 };
}

export function ask(prompt: string, extra: Omit<Context, 'messages'> = {}): Context {
  return { ...extra, messages: [user(prompt)] };
}

export function assistantTurn(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'anthropic-messages',
    provider: 'claude-subscription',
    model: 'claude-sonnet-4-6',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: 2,
    ...overrides,
  };
}

export const PIXEL: ImageContent = { type: 'image', data: 'AAAA', mimeType: 'image/png' };

export function toolResult(toolCallId: string, content: (TextContent | ImageContent)[]): ToolResultMessage {
  return { role: 'toolResult', toolCallId, toolName: 'read', content, isError: false, timestamp: 3 };
}

export function toolCallTurn(id: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return assistantTurn({ content: [{ type: 'toolCall', id, name: 'read', arguments: { path: 'a.txt' } }], stopReason: 'toolUse', ...overrides });
}
