import type { ContextBudget } from './tokens.ts';

export const OMITTED_MARKER = '[Pi context guard: middle of the conversation omitted to fit the model request limit]';
// Pi's compaction and branch-summarization system prompt opens with this sentence.
const SUMMARIZATION_SYSTEM_OPENING = 'You are a context summarization assistant.';

interface WireMessage {
  readonly role: string;
  readonly content: unknown;
}

interface CapturedPayload {
  readonly payload: Record<string, unknown>;
  readonly messages: readonly WireMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWireMessage(value: unknown): value is WireMessage {
  if (!isRecord(value)) return false;
  if (typeof value['role'] !== 'string') return false;
  const content = value['content'];
  return typeof content === 'string' || Array.isArray(content);
}

function capture(payload: unknown): CapturedPayload | undefined {
  if (!isRecord(payload)) return undefined;
  const messages = payload['messages'];
  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isWireMessage)) return undefined;
  return { payload, messages };
}

function hasContentBlock(message: WireMessage, type: string): boolean {
  return Array.isArray(message.content) && message.content.some((block) => isRecord(block) && block['type'] === type);
}

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') return block['text'];
  }
  return undefined;
}

function replaceFirstText(content: unknown, next: string): unknown {
  if (typeof content === 'string') return next;
  if (!Array.isArray(content)) return content;
  let replaced = false;
  return content.map((block) => {
    if (replaced || !isRecord(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') return block;
    replaced = true;
    return { ...block, text: next };
  });
}

function withMarker(message: WireMessage): WireMessage {
  const content = message.content;
  if (typeof content === 'string')
    return {
      ...message,
      content: [
        { type: 'text', text: OMITTED_MARKER },
        { type: 'text', text: content },
      ],
    };
  if (!Array.isArray(content)) return message;
  return { ...message, content: [{ type: 'text', text: OMITTED_MARKER }, ...content] };
}

function framed(filler: string): string {
  return `\n${filler}\n`;
}

function utf8Head(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const point of text) {
    const size = Buffer.byteLength(point, 'utf8');
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += point.length;
  }
  return text.slice(0, end);
}

function utf8Tail(text: string, maxBytes: number): string {
  const target = Buffer.byteLength(text, 'utf8') - maxBytes;
  if (target <= 0) return text;
  let bytes = 0;
  let index = 0;
  for (const point of text) {
    if (bytes >= target) break;
    bytes += Buffer.byteLength(point, 'utf8');
    index += point.length;
  }
  return text.slice(index);
}

function fitSummarization(captured: CapturedPayload, budget: ContextBudget, estimate: (payload: unknown) => number): unknown {
  const users = captured.messages.filter((message) => message.role === 'user');
  const [message] = users;
  if (!message || users.length !== 1) return captured.payload;
  if (captured.messages.some((candidate) => candidate.role !== 'user' && candidate.role !== 'system')) return captured.payload;
  const index = captured.messages.indexOf(message);
  const text = textOf(message.content);
  if (text === undefined || text === '') return captured.payload;
  const replaced = (content: string): readonly WireMessage[] => captured.messages.map((candidate, position) => (position === index ? { ...candidate, content: replaceFirstText(candidate.content, content) } : candidate));
  const rest = estimate({ ...captured.payload, messages: replaced('') });
  const textTokens = estimate(captured.payload) - rest;
  const bytesPerEstimatedToken = textTokens > 0 ? Buffer.byteLength(text, 'utf8') / textTokens : budget.bytesPerToken;
  let available = Math.max(0, Math.floor((budget.blockAt - 1 - rest) * bytesPerEstimatedToken) - Buffer.byteLength(OMITTED_MARKER, 'utf8') - 2 * budget.bytesPerToken);
  for (let attempt = 0; attempt < 4 && available > 0; attempt += 1) {
    const shrunk = `${utf8Head(text, Math.floor(available * 0.4))}${framed(OMITTED_MARKER)}${utf8Tail(text, Math.floor(available * 0.6))}`;
    const candidate = { ...captured.payload, messages: replaced(shrunk) };
    if (estimate(candidate) < budget.blockAt) return candidate;
    available = Math.floor(available * 0.8);
  }
  return captured.payload;
}

type ToolChangeBlock = Readonly<Record<string, unknown>> & { readonly type: 'tool_addition' | 'tool_removal' };

function isToolChangeBlock(block: unknown): block is ToolChangeBlock {
  return isRecord(block) && (block['type'] === 'tool_addition' || block['type'] === 'tool_removal');
}

function toolChanges(dropped: readonly WireMessage[]): readonly ToolChangeBlock[] {
  return dropped.flatMap((message) => (message.role === 'system' && Array.isArray(message.content) ? message.content.filter(isToolChangeBlock) : []));
}

function isPrompt(message: WireMessage): boolean {
  return message.role === 'user' && !hasContentBlock(message, 'tool_result');
}

/** Keeps the prompt at `prompt` and every message from `tail` on, carrying the tool changes of what is dropped. */
function keptAround(captured: CapturedPayload, { prompt, tail }: { prompt: number; tail: number }): unknown {
  const { messages } = captured;
  const kept = messages[prompt];
  if (kept === undefined) return captured.payload;
  const changes = toolChanges([...messages.slice(0, prompt), ...messages.slice(prompt + 1, tail)]);
  const carried: readonly WireMessage[] = changes.length > 0 ? [{ role: 'system', content: changes }] : [];
  return { ...captured.payload, messages: [withMarker(kept), ...carried, ...messages.slice(tail)] };
}

function fitConversation(captured: CapturedPayload, budget: ContextBudget, estimate: (payload: unknown) => number): unknown {
  const { messages } = captured;
  for (let prompt = 1; prompt < messages.length; prompt += 1) {
    const message = messages[prompt];
    if (message === undefined || !isPrompt(message)) continue;
    const candidate = keptAround(captured, { prompt, tail: prompt + 1 });
    if (estimate(candidate) < budget.blockAt) return candidate;
  }
  // One prompt's own tool loop can outgrow the window. A tail that starts at an assistant turn keeps every tool_use with its tool_result.
  const latest = messages.findLastIndex(isPrompt);
  for (let tail = latest + 2; latest >= 0 && tail < messages.length; tail += 1) {
    if (messages[tail]?.role !== 'assistant') continue;
    const candidate = keptAround(captured, { prompt: latest, tail });
    if (estimate(candidate) < budget.blockAt) return candidate;
  }
  return captured.payload;
}

export function isSummarizationRequest(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const system = payload['system'];
  const texts = typeof system === 'string' ? [system] : Array.isArray(system) ? system.flatMap((block) => (isRecord(block) && typeof block['text'] === 'string' ? [block['text']] : [])) : [];
  return texts.some((text) => text.trimStart().startsWith(SUMMARIZATION_SYSTEM_OPENING));
}

export function fitPayload(payload: unknown, budget: ContextBudget, estimate: (payload: unknown) => number): unknown {
  const captured = capture(payload);
  if (!captured || estimate(payload) < budget.blockAt) return payload;
  if (isSummarizationRequest(payload)) {
    const shrunk = fitSummarization(captured, budget, estimate);
    if (shrunk !== payload) return shrunk;
  }
  return fitConversation(captured, budget, estimate);
}
