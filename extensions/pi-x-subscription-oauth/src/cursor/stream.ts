import { execFile } from 'node:child_process';

import { type Api, type AssistantMessage, type AssistantMessageEventStream, createAssistantMessageEventStream, type Model, type ProviderStreams, type SimpleStreamOptions, type TranscriptContext, type Usage } from '@earendil-works/pi-ai';
import { scrubText } from './auth.ts';
import { CURSOR_BIN_HINT, CURSOR_LOGIN_HINT } from './catalog.ts';
import { type NativeOpener, NativeTransportError } from './native/http2.ts';
import { readAssistantText } from './native/turn.ts';
import type { TurnUsage } from './native/wire.ts';

export type AgentRun = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type AgentRunner = (args: readonly string[], signal: AbortSignal | undefined) => Promise<AgentRun>;

type AgentPayload = {
  readonly type?: unknown;
  readonly subtype?: unknown;
  readonly is_error?: unknown;
  readonly result?: unknown;
  readonly usage?: unknown;
};

export type AgentReply = { readonly kind: 'text'; readonly text: string; readonly usage: Usage } | { readonly kind: 'error'; readonly message: string };

const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

export function cursorAgentArgs(modelId: string, prompt: string): readonly string[] {
  return ['--trust', '--print', '--output-format', 'json', '--mode', 'ask', '--model', modelId, '--', prompt];
}

type TranscriptMessage = TranscriptContext['messages'][number];
type ContentPart = Exclude<TranscriptMessage['content'], string>[number];

function partText(part: ContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'image':
      return '[image not sent]';
    case 'thinking':
      return '';
    case 'toolCall':
      return `[called tool ${part.name}]`;
    default: {
      const _exhaustive: never = part;
      return _exhaustive;
    }
  }
}

function contentText(content: TranscriptMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map(partText)
    .filter((text) => text.length > 0)
    .join('\n');
}

function turnOf(message: TranscriptMessage): { readonly speaker: string; readonly text: string } {
  switch (message.role) {
    case 'system':
      return { speaker: 'System', text: [contentText(message.content), ...Object.values(message.sections ?? {}).filter((section) => section !== null)].filter((text) => text.length > 0).join('\n\n') };
    case 'user':
      return { speaker: 'User', text: contentText(message.content) };
    case 'assistant':
      return { speaker: 'Assistant', text: contentText(message.content) };
    case 'toolResult':
      return { speaker: `Tool result (${message.toolName})`, text: contentText(message.content) };
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

export function promptFrom(messages: TranscriptContext['messages']): string {
  return messages
    .map(turnOf)
    .filter((turn) => turn.text.trim().length > 0)
    .map((turn) => `${turn.speaker}:\n${turn.text.trim()}`)
    .join('\n\n');
}

function usageOf(counts: TurnUsage): Usage {
  return { ...counts, totalTokens: counts.input + counts.output + counts.cacheRead + counts.cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function usageNumber(record: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function usageFrom(value: unknown): Usage {
  if (!value || typeof value !== 'object') return ZERO_USAGE;
  const record = value as Record<string, unknown>;
  const input = usageNumber(record, ['inputTokens', 'input_tokens']);
  const output = usageNumber(record, ['outputTokens', 'output_tokens']);
  const cacheRead = usageNumber(record, ['cacheReadTokens', 'cache_read_tokens', 'cache_read_input_tokens']);
  const cacheWrite = usageNumber(record, ['cacheWriteTokens', 'cache_write_tokens', 'cache_creation_input_tokens']);
  return { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function parseResultLine(line: string): AgentPayload | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (parsed && typeof parsed === 'object' && 'type' in parsed && parsed.type === 'result') return parsed;
    return undefined;
  } catch {
    return undefined;
  }
}

export function readAgentResult(stdout: string): AgentReply {
  let payload: AgentPayload | undefined;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    const parsed = parseResultLine(trimmed);
    if (parsed) payload = parsed;
  }
  if (!payload) return { kind: 'error', message: 'Cursor returned a reply Pi cannot read.' };
  if (payload.is_error === true || (payload.subtype !== undefined && payload.subtype !== 'success')) {
    return { kind: 'error', message: typeof payload.result === 'string' && payload.result.trim().length > 0 ? payload.result : 'Cursor request failed.' };
  }
  if (typeof payload.result !== 'string' || payload.result.trim().length === 0) return { kind: 'error', message: 'Cursor returned an empty reply.' };
  return { kind: 'text', text: payload.result, usage: usageFrom(payload.usage) };
}

export function runCursorAgent(args: readonly string[], signal: AbortSignal | undefined): Promise<AgentRun> {
  return new Promise((resolve, reject) => {
    execFile('cursor-agent', args, { signal, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const errno = error as NodeJS.ErrnoException | null;
      if (errno?.code === 'ENOENT') {
        reject(new Error(CURSOR_BIN_HINT));
        return;
      }
      if (errno?.name === 'AbortError') {
        reject(errno);
        return;
      }
      const code = error === null ? 0 : typeof errno?.code === 'number' ? errno.code : 1;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function failureText(run: AgentRun, reply: AgentReply, secret: string | undefined): string {
  const stderr = run.stderr.trim();
  const secrets = secret ? [secret] : [];
  if (run.code !== 0 && stderr.length > 0) return scrubText(stderr, secrets);
  if (run.code !== 0 && run.stdout.trim().length === 0) return `cursor-agent exited ${run.code}.`;
  const parsed = reply.kind === 'error' ? reply.message : reply.text.trim();
  return scrubText(parsed || stderr || `cursor-agent exited ${run.code}.`, secrets);
}

function emptyMessage(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: 'pending',
    timestamp: Date.now(),
  };
}

function publish(output: AssistantMessage, stream: AssistantMessageEventStream, text: string, usage: Usage): void {
  output.usage = usage;
  output.content.push({ type: 'text', text: '' });
  stream.push({ type: 'start', partial: output });
  stream.push({ type: 'text_start', contentIndex: 0, partial: output });
  const block = output.content[0];
  if (block?.type === 'text') block.text = text;
  stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: output });
  stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: output });
  output.stopReason = 'stop';
  stream.push({ type: 'done', reason: 'stop', message: output });
  stream.end();
}

async function run(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined, runAgent: AgentRunner, openNative: NativeOpener | undefined, stream: AssistantMessageEventStream): Promise<void> {
  const output = emptyMessage(model);
  try {
    if (!options?.apiKey) throw new Error(CURSOR_LOGIN_HINT);
    const prompt = promptFrom(context.messages);
    if (prompt.length === 0) throw new Error('Cursor ask needs text. This adapter does not send images or tool calls.');
    if (openNative) {
      let opened = false;
      try {
        const session = await openNative({ token: options.apiKey, signal: options.signal });
        opened = true;
        const reply = await readAssistantText(session, { prompt, modelId: model.id }, options.signal);
        publish(output, stream, reply.text, usageOf(reply.usage));
        return;
      } catch (error) {
        if (opened || !(error instanceof NativeTransportError)) throw error;
      }
    }
    const agent = await runAgent(cursorAgentArgs(model.id, prompt), options.signal);
    const reply = readAgentResult(agent.stdout);
    if (agent.code !== 0 || reply.kind === 'error') throw new Error(failureText(agent, reply, options.apiKey));
    publish(output, stream, reply.text, reply.usage);
  } catch (error) {
    const aborted = options?.signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
    output.stopReason = aborted ? 'aborted' : 'error';
    output.errorMessage = aborted ? 'Request was aborted' : scrubText(error instanceof Error ? error.message : 'Cursor request failed.', options?.apiKey ? [options.apiKey] : []);
    stream.push({ type: 'error', reason: output.stopReason, error: output });
    stream.end();
  }
}

export function createCursorStreams(runAgent: AgentRunner = runCursorAgent, openNative?: NativeOpener): ProviderStreams {
  const streamSimple = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();
    void run(model, context, options, runAgent, openNative, stream);
    return stream;
  };
  return { stream: streamSimple, streamSimple };
}
