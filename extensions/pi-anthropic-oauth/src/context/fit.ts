// Request-local fitting: shrink one outgoing Anthropic payload under the
// model's blocking threshold without producing a payload the API rejects.
import type { ContextBudget } from './tokens.ts';

export const OMITTED_MARKER = '[Pi context guard: middle of the conversation omitted to fit the model request limit]';
const SUMMARIZATION_SYSTEM_MARKER = 'summarization assistant';

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

/** Prepends the marker as a plain text block, keeping every existing block and its cache_control. */
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

/**
 * Shrinks Pi's serialization-shaped single user message head-and-tail. The
 * request may carry trailing system messages (the mid-conversation output
 * config), which are preserved. Only a request whose system prompt identifies
 * summarization is rewritten, so a user's own oversized first prompt is never
 * silently truncated.
 */
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
  let available = Math.max(0, (budget.blockAt - 1 - rest) * budget.bytesPerToken - Buffer.byteLength(OMITTED_MARKER, 'utf8') - 2 * budget.bytesPerToken);
  for (let attempt = 0; attempt < 4 && available > 0; attempt += 1) {
    const shrunk = `${utf8Head(text, Math.floor(available * 0.4))}${framed(OMITTED_MARKER)}${utf8Tail(text, Math.floor(available * 0.6))}`;
    const candidate = { ...captured.payload, messages: replaced(shrunk) };
    if (estimate(candidate) < budget.blockAt) return candidate;
    available = Math.floor(available * 0.8);
  }
  return captured.payload;
}

/**
 * Drops the smallest prefix that ends immediately before a kept, text-only
 * user message. Cutting only there preserves every tool_use/tool_result pair
 * and keeps the first message user.
 */
function fitConversation(captured: CapturedPayload, budget: ContextBudget, estimate: (payload: unknown) => number): unknown {
  const { messages } = captured;
  let lastUser = -1;
  for (let index = 0; index < messages.length; index += 1) if (messages[index]?.role === 'user') lastUser = index;
  for (let start = 1; start <= lastUser; start += 1) {
    const message = messages[start];
    if (message === undefined) continue;
    if (message.role !== 'user' || hasContentBlock(message, 'tool_result')) continue;
    const candidate = { ...captured.payload, messages: [withMarker(message), ...messages.slice(start + 1)] };
    if (estimate(candidate) < budget.blockAt) return candidate;
  }
  return captured.payload;
}

/** True for Pi's compaction and branch-summarization requests. */
export function isSummarizationRequest(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const system = payload['system'];
  const text = typeof system === 'string' ? system : Array.isArray(system) ? system.flatMap((block) => (isRecord(block) && typeof block['text'] === 'string' ? [block['text']] : [])).join('\n') : '';
  return text.toLowerCase().includes(SUMMARIZATION_SYSTEM_MARKER);
}

/**
 * Returns the payload unchanged when it already fits or cannot validly be
 * shrunk. A single message larger than the model window is that boundary; the
 * endpoint's rejection then surfaces exactly as it does today.
 */
export function fitPayload(payload: unknown, budget: ContextBudget, estimate: (payload: unknown) => number): unknown {
  const captured = capture(payload);
  if (!captured || estimate(payload) < budget.blockAt) return payload;
  if (isSummarizationRequest(payload)) {
    const shrunk = fitSummarization(captured, budget, estimate);
    if (shrunk !== payload) return shrunk;
  }
  return fitConversation(captured, budget, estimate);
}
