// pi streamSimple adapter for Cursor. Cursor keeps the agent loop on its side, so a tool call pauses the
// Run: this turn ends with toolUse, and the next pi turn feeds the tool results back into the same Run.
import { createHash, randomUUID } from 'node:crypto';

import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { resolveCursorModelId } from './models.ts';
import type { Json } from './proto.ts';
import { type CursorRun, openCursorRun, type PiTool, type RunEvent } from './run.ts';

interface Session {
  conversationId: string;
  checkpoint: Uint8Array | undefined;
  blobs: Map<string, Uint8Array>;
  /** Number of non-system pi messages the checkpoint already covers. */
  covered: number;
  /** Text of the last assistant reply the checkpoint covers, to catch edited or branched histories. */
  lastReply: string;
  waiting: CursorRun | undefined;
}

const sessions = new Map<string, Session>();
const MAX_SESSIONS = 32;

/** Map order doubles as recency: re-inserting on use keeps the least recently used session first. */
function remember(key: string, session: Session) {
  sessions.delete(key);
  sessions.set(key, session);
  for (const [oldKey, old] of sessions) {
    if (sessions.size <= MAX_SESSIONS) break;
    old.waiting?.close();
    sessions.delete(oldKey);
  }
}

/** pi's session id, or the opening message when there is none, so separate conversations never share Cursor state. */
const sessionKey = (sessionId: string | undefined, messages: Message[]) =>
  sessionId ??
  `first:${createHash('sha256')
    .update(messages[0] ? textOf(messages[0].content) : '')
    .digest('hex')}`;

const newSession = (): Session => ({ conversationId: randomUUID(), checkpoint: undefined, blobs: new Map(), covered: 0, lastReply: '', waiting: undefined });

const textOf = (content: Message['content']): string =>
  typeof content === 'string' ? content : content.map((c) => (c.type === 'text' ? c.text : c.type === 'thinking' ? '' : c.type === 'toolCall' ? `[tool call ${c.name} ${JSON.stringify(c.arguments)}]` : '[image]')).join('');

/** Replays a transcript Cursor has never seen as plain text, for a fresh Cursor conversation. */
export function flattenTranscript(messages: Message[]): string {
  const last = messages.at(-1);
  const prior = last?.role === 'user' ? messages.slice(0, -1) : messages;
  const latest = last?.role === 'user' ? textOf(last.content) : 'Continue from the tool results above.';
  if (prior.length === 0) return latest;
  const lines = prior.map((m) => {
    if (m.role === 'user') return `User: ${textOf(m.content)}`;
    if (m.role === 'assistant') return `Assistant: ${textOf(m.content)}`;
    if (m.role === 'toolResult') return `[tool result ${m.toolName}${m.isError ? ' (error)' : ''}] ${textOf(m.content)}`;
    return '';
  });
  return `<conversation_so_far>\n${lines.join('\n')}\n</conversation_so_far>\n\n${latest}`;
}

class Emitter {
  readonly message: AssistantMessage;
  private readonly stream: AssistantMessageEventStream;
  private open: { kind: 'text' | 'thinking'; index: number } | undefined;

  constructor(stream: AssistantMessageEventStream, model: Model<Api>) {
    this.stream = stream;
    this.message = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'pending',
      timestamp: Date.now(),
    };
  }

  begin() {
    this.stream.push({ type: 'start', partial: this.message });
  }

  private close() {
    if (!this.open) return;
    const { kind, index } = this.open;
    const block = this.message.content[index];
    this.open = undefined;
    if (kind === 'text' && block?.type === 'text') this.stream.push({ type: 'text_end', contentIndex: index, content: block.text, partial: this.message });
    if (kind === 'thinking' && block?.type === 'thinking') this.stream.push({ type: 'thinking_end', contentIndex: index, content: block.thinking, partial: this.message });
  }

  delta(kind: 'text' | 'thinking', delta: string) {
    if (!delta) return;
    if (this.open?.kind !== kind) {
      this.close();
      const index = this.message.content.push(kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' }) - 1;
      this.open = { kind, index };
      this.stream.push({ type: kind === 'text' ? 'text_start' : 'thinking_start', contentIndex: index, partial: this.message });
    }
    const index = this.open.index;
    const block = this.message.content[index];
    if (block?.type === 'text') block.text += delta;
    if (block?.type === 'thinking') block.thinking += delta;
    this.stream.push({ type: kind === 'text' ? 'text_delta' : 'thinking_delta', contentIndex: index, delta, partial: this.message });
  }

  endThinking() {
    if (this.open?.kind === 'thinking') this.close();
  }

  toolCall(id: string, name: string, args: Record<string, Json>) {
    this.close();
    const index = this.message.content.push({ type: 'toolCall', id, name, arguments: args }) - 1;
    const toolCall = this.message.content[index];
    if (toolCall?.type !== 'toolCall') return;
    this.stream.push({ type: 'toolcall_start', contentIndex: index, partial: this.message });
    this.stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(args), partial: this.message });
    this.stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial: this.message });
  }

  usage(u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
    Object.assign(this.message.usage, u, { totalTokens: u.input + u.output + u.cacheRead + u.cacheWrite });
  }

  done(reason: 'stop' | 'toolUse') {
    this.close();
    this.message.stopReason = reason;
    this.stream.push({ type: 'done', reason, message: this.message });
    this.stream.end();
  }

  fail(reason: 'error' | 'aborted', errorMessage: string) {
    this.close();
    this.message.stopReason = reason;
    this.message.errorMessage = errorMessage;
    this.stream.push({ type: 'error', reason, error: this.message });
    this.stream.end();
  }
}

function attach(run: CursorRun, emitter: Emitter, session: Session, piMessageCount: number, model: Model<Api>, options: SimpleStreamOptions | undefined) {
  const signal = options?.signal;
  let settled = false;
  emitter.begin();
  const onAbort = () => {
    if (settled) return;
    settled = true;
    session.waiting = undefined;
    run.close();
    emitter.fail('aborted', 'Request aborted');
  };
  if (signal?.aborted) return onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  run.onEvent = (e: RunEvent) => {
    void options?.onProviderStreamEvent?.(e, model);
    if (e.type === 'checkpoint') {
      session.checkpoint = e.state;
      return;
    }
    if (settled) {
      if (e.type === 'end' && session.waiting === run) session.waiting = undefined;
      return;
    }
    switch (e.type) {
      case 'text':
      case 'thinking':
        emitter.delta(e.type, e.delta);
        return;
      case 'thinking_end':
        emitter.endThinking();
        return;
      case 'tool_calls':
        for (const c of e.calls) emitter.toolCall(c.id, c.name, c.args);
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        session.waiting = run;
        emitter.done('toolUse');
        return;
      case 'turn_ended':
        emitter.usage(e.usage);
        return;
      case 'end':
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        session.waiting = undefined;
        if (e.error) return emitter.fail('error', e.error);
        session.covered = piMessageCount + 1;
        session.lastReply = textOf(emitter.message.content);
        emitter.done('stop');
    }
  };
}

export function streamCursor(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const emitter = new Emitter(stream, model);
  start(model, context, options, emitter).catch((err: unknown) => emitter.fail('error', err instanceof Error ? err.message : String(err)));
  return stream;
}

async function start(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined, emitter: Emitter) {
  const token = options?.apiKey;
  if (!token) throw new Error('Not signed in to Cursor. Run /login and choose Cursor.');
  const messages = context.messages.filter((m): m is Message => m.role !== 'system');
  const key = sessionKey(options?.sessionId, messages);
  const last = messages.at(-1);
  let session = sessions.get(key);
  if (session) remember(key, session);

  if (last?.role === 'toolResult' && session?.waiting && !session.waiting.closed) {
    const run = session.waiting;
    const results = messages.slice(messages.findLastIndex((m) => m.role !== 'toolResult') + 1).flatMap((m) => (m.role === 'toolResult' ? [{ id: m.toolCallId, text: textOf(m.content), isError: m.isError }] : []));
    session.waiting = undefined;
    run.submitToolResults(results);
    attach(run, emitter, session, messages.length, model, options);
    return;
  }

  session?.waiting?.close();
  const previous = messages.at(-2);
  const continues = session?.checkpoint !== undefined && session.covered === messages.length - 1 && last?.role === 'user' && previous !== undefined && textOf(previous.content) === session.lastReply;
  if (!session || !continues) {
    session = newSession();
    remember(key, session);
  }
  const payload = {
    conversationId: session.conversationId,
    modelId: resolveCursorModelId(model.id, model.thinkingLevelMap, options?.reasoning),
    userText: continues && last ? textOf(last.content) : flattenTranscript(messages),
    systemPrompt: getCurrentSystemPrompt(context.messages),
    tools: getCurrentTools(context.messages).map((t): PiTool => ({ name: t.name, description: t.description, parameters: t.parameters as Json })),
  };
  const final = ((await options?.onPayload?.(payload, model)) as typeof payload | undefined) ?? payload;
  const run = openCursorRun({ ...final, token, checkpoint: continues ? session.checkpoint : undefined, blobs: session.blobs }, (status, headers) => void options?.onResponse?.({ status, headers }, model));
  attach(run, emitter, session, messages.length, model, options);
}
