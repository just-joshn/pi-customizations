// Drives the Cursor provider's streamSimple the way Pi does for one request.

import type { SDKCustomTool, SDKCustomToolResult, SDKJsonValue } from '@cursor/sdk';
import { type Api, type AssistantMessage, type AssistantMessageEvent, type Message, type Model, normalizeContext, type SimpleStreamOptions, type Tool, type ToolResultMessage } from '@earendil-works/pi-ai';
import { CURSOR_ID, loadExtension } from './host.ts';
import { makeModel } from './support.ts';

const USER_TIMESTAMP = 1;
const TOOL_RESULT_TIMESTAMP = 2;

export const readTool: Tool = { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } };
export const lsTool: Tool = { name: 'ls', description: 'List a directory', parameters: { type: 'object', properties: {} } };

export const modelFor = (id: string): Model<Api> => makeModel(id, CURSOR_ID, 'cursor-sdk');

export const system = (prompt: string, tools: Tool[] = [readTool, lsTool]): Message => ({ role: 'system', content: prompt, toolsAdded: tools, timestamp: 0 });
export const user = (content: Extract<Message, { role: 'user' }>['content']): Message => ({ role: 'user', content, timestamp: USER_TIMESTAMP });
export const toolResult = (toolCallId: string, text: string, isError = false): ToolResultMessage => ({ role: 'toolResult', toolCallId, toolName: 'read', content: [{ type: 'text', text }], isError, timestamp: TOOL_RESULT_TIMESTAMP });

/** A system prompt no earlier test used, so Cursor agents kept idle by one test never serve another. */
let promptCount = 0;
export const freshPrompt = (): string => `test prompt ${++promptCount}`;

async function collect(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  let events: AssistantMessageEvent[] = [];
  for await (const event of stream) events = [...events, event];
  return events;
}

export interface Answer {
  events: AssistantMessageEvent[];
  message: AssistantMessage;
  types: string[];
}

export async function ask(messages: Message[], options?: SimpleStreamOptions, modelId = 'composer-2.5'): Promise<Answer> {
  const { streamSimple } = loadExtension().provider(CURSOR_ID);
  const events = await collect(streamSimple(modelFor(modelId), normalizeContext({ messages }), options ?? { apiKey: 'key' }));
  const last = events.at(-1);
  const message = last?.type === 'done' ? last.message : last?.type === 'error' ? last.error : undefined;
  if (!message) throw new Error('the stream ended without a done or error event');
  return { events, message, types: events.map((e) => e.type) };
}

/** Calls a Pi tool the way Cursor's agent does, through the custom tool's execute(). */
export const call = (tools: Record<string, SDKCustomTool>, name: string, args: Record<string, SDKJsonValue> = {}) => {
  const tool = tools[name];
  if (!tool) throw new Error(`no tool ${name}`);
  return Promise.resolve(tool.execute(args, {})) as Promise<SDKCustomToolResult>;
};

export const toolCalls = (message: AssistantMessage) => message.content.filter((c) => c.type === 'toolCall');
