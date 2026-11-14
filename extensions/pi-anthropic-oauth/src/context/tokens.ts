import type { Api, AssistantMessage, ImageContent, Model, SystemMessage, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { SessionProjection } from '@earendil-works/pi-coding-agent';

export type BytesPerToken = 3 | 4;

export interface ContextBudget {
  readonly bytesPerToken: BytesPerToken;
  readonly compactAt: number;
  readonly blockAt: number;
}

export type AgentMessage = SessionProjection['messages'][number];

export type CountedBlock =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'thinking'; readonly text: string }
  | { readonly kind: 'toolCall'; readonly name: string; readonly argumentsJson: string }
  | { readonly kind: 'toolResult'; readonly content: string; readonly imageCount: number }
  | { readonly kind: 'image' }
  | { readonly kind: 'json'; readonly json: string };

export const IMAGE_TOKENS = 2000;

const FOUR_BYTE_MODELS: ReadonlySet<string> = new Set([
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-3-7-sonnet',
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]);

export function bytesPerToken(modelId: string): BytesPerToken {
  if (modelId === '') return 4;
  const normalized = modelId.toLowerCase().replace(/[._]/g, '-');
  return FOUR_BYTE_MODELS.has(normalized.replace(/-\d{8}$/, '')) ? 4 : 3;
}

/**
 * Claude Code's auto-compact and blocking thresholds. Claude Code clamps its
 * auto-compact window to the model's context window, so this uses
 * `contextWindow` directly, which matches the catalog models served here.
 */
export function contextBudget(model: Pick<Model<Api>, 'id' | 'contextWindow' | 'maxTokens'>): ContextBudget {
  const reserve = Math.min(model.maxTokens, 20000);
  const effective = model.contextWindow - reserve;
  return { bytesPerToken: bytesPerToken(model.id), compactAt: effective - 13000, blockAt: effective - 3000 };
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function textTokens(text: string, bpt: BytesPerToken): number {
  return Math.round(byteLength(text) / bpt);
}

function serialized(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

export function countBlocks(blocks: readonly CountedBlock[], bpt: BytesPerToken): number {
  let total = 0;
  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
      case 'thinking':
        total += textTokens(block.text, bpt);
        break;
      case 'toolCall':
        total += textTokens(`${block.name}${block.argumentsJson}`, bpt);
        break;
      case 'toolResult':
        total += textTokens(block.content, bpt) + block.imageCount * IMAGE_TOKENS;
        break;
      case 'image':
        total += IMAGE_TOKENS;
        break;
      case 'json':
        total += textTokens(block.json, bpt);
        break;
      default: {
        const _exhaustive: never = block;
        throw new Error(`Unhandled counted block: ${serialized(_exhaustive)}`);
      }
    }
  }
  return total;
}

function contentBlocks(content: string | readonly (TextContent | ImageContent)[]): readonly CountedBlock[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content }];
  return content.map((block) => (block.type === 'image' ? { kind: 'image' } : { kind: 'text', text: block.text }));
}

function systemBlocks(message: SystemMessage): readonly CountedBlock[] {
  const blocks = [...contentBlocks(message.content)];
  if (message.sections !== undefined) {
    for (const section of Object.values(message.sections)) {
      if (section !== null) blocks.push({ kind: 'text', text: section });
    }
  }
  if (message.toolsAdded !== undefined) blocks.push({ kind: 'json', json: serialized(message.toolsAdded) });
  return blocks;
}

function assistantBlocks(message: AssistantMessage): readonly CountedBlock[] {
  return message.content.map((block: TextContent | ThinkingContent | ToolCall) => {
    if (block.type === 'text') return { kind: 'text', text: block.text };
    if (block.type === 'thinking') return { kind: 'thinking', text: block.thinking };
    return { kind: 'toolCall', name: block.name, argumentsJson: serialized(block.arguments) };
  });
}

function toolResultBlocks(content: readonly (TextContent | ImageContent)[]): readonly CountedBlock[] {
  let text = '';
  let imageCount = 0;
  for (const block of content) {
    if (block.type === 'text') text += block.text;
    else imageCount += 1;
  }
  return [{ kind: 'toolResult', content: text, imageCount }];
}

export function agentMessageBlocks(message: AgentMessage): readonly CountedBlock[] {
  switch (message.role) {
    case 'user':
      return contentBlocks(message.content);
    case 'assistant':
      return assistantBlocks(message);
    case 'toolResult':
      return toolResultBlocks(message.content);
    case 'system':
      return systemBlocks(message);
    case 'custom':
      return contentBlocks(message.content);
    case 'bashExecution':
      return message.excludeFromContext === true
        ? []
        : [
            { kind: 'text', text: message.command },
            { kind: 'text', text: message.output },
          ];
    case 'branchSummary':
    case 'compactionSummary':
      return [{ kind: 'text', text: message.summary }];
    default: {
      const _exhaustive: never = message;
      throw new Error(`Unhandled agent message: ${serialized(_exhaustive)}`);
    }
  }
}

function wireBlocks(blocks: readonly unknown[]): readonly CountedBlock[] {
  return blocks.flatMap((block) => wireBlock(block));
}

function wireBlock(block: unknown): readonly CountedBlock[] {
  if (!isRecord(block)) return [];
  switch (block['type']) {
    case 'text':
      return typeof block['text'] === 'string' ? [{ kind: 'text', text: block['text'] }] : [];
    case 'thinking':
      return typeof block['thinking'] === 'string' ? [{ kind: 'thinking', text: block['thinking'] }] : [];
    case 'tool_use':
      return [{ kind: 'toolCall', name: typeof block['name'] === 'string' ? block['name'] : '', argumentsJson: serialized(block['input']) }];
    case 'tool_result':
      return toolResultWireBlocks(block['content']);
    case 'image':
    case 'document':
      return [{ kind: 'image' }];
    default:
      return [{ kind: 'json', json: serialized(block) }];
  }
}

function toolResultWireBlocks(content: unknown): readonly CountedBlock[] {
  if (typeof content === 'string') return [{ kind: 'toolResult', content, imageCount: 0 }];
  if (!Array.isArray(content)) return [];
  let text = '';
  let imageCount = 0;
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') text += block['text'];
    else if (isRecord(block) && block['type'] === 'image') imageCount += 1;
    else text += serialized(block);
  }
  return [{ kind: 'toolResult', content: text, imageCount }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wireContentBlocks(content: unknown): readonly CountedBlock[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content }];
  return Array.isArray(content) ? wireBlocks(content) : [];
}

function wireToolBlocks(tools: unknown): readonly CountedBlock[] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    if (!isRecord(tool)) return [];
    const name = typeof tool['name'] === 'string' ? tool['name'] : '';
    const description = typeof tool['description'] === 'string' ? tool['description'] : '';
    return [{ kind: 'json', json: `${name}${description}${serialized(tool['parameters'] ?? tool['input_schema'])}` }];
  });
}

export function wireMessageBlocks(message: unknown): readonly CountedBlock[] {
  if (!isRecord(message)) return [];
  return wireContentBlocks(message['content']);
}

export function estimateMessages(messages: readonly AgentMessage[], bpt: BytesPerToken): number {
  let total = 0;
  for (const [index, message] of messages.entries()) {
    if (index === 0 && message.role === 'system') continue;
    total += countBlocks(agentMessageBlocks(message), bpt);
  }
  return total;
}

export function payloadTokens(payload: unknown, bpt: BytesPerToken): number {
  if (!isRecord(payload)) return 0;
  const messages = payload['messages'];
  const messageBlocks = Array.isArray(messages) ? messages.flatMap((message) => wireMessageBlocks(message)) : [];
  return countBlocks([...wireContentBlocks(payload['system']), ...wireToolBlocks(payload['tools']), ...messageBlocks], bpt);
}

export function payloadModelId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const model = payload['model'];
  return typeof model === 'string' && model !== '' ? model : undefined;
}
