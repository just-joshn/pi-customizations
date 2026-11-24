import type { AssistantMessageEventStream, Model, ModelThinkingLevel, ProviderEnv, StreamOptions, TranscriptContext } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type { AcpClient } from './acp/client.ts';
import { connectAcp } from './acp/client.ts';
import { ACP_METHODS, AUTH_REQUIRED_CODE, CONFIG_MODEL, CONFIG_THOUGHT_LEVEL, type ContentBlock, type PermissionOutcome, type PromptCapabilities, type SessionNewParams } from './acp/protocol.ts';
import { API_ID, AUTH_RETRIES, AUTH_RETRY_DELAY_MS, CANCEL_USAGE_GRACE_MS, HANDSHAKE_TIMEOUT_MS } from './constants.ts';
import { envFlagEnabled } from './env.ts';
import { POLICY_ALLOW_ENV, policyRejection, transportFailure } from './errors.ts';
import { launchSpec } from './launch.ts';
import { emitAction, emitTerminal, EMPTY_TURN, messageFor, reduceTurn, type OpenBlock, type TokenUsage, type TurnAction, type TurnMeta, type TurnState } from './stream-state.ts';
import { declaredToolNames, instructions, renderPrompt } from './transcript.ts';
import { bridgeToolCall } from './tools.ts';

/** JSON-RPC Invalid Params. `thought_level` returns this when the model has no such effort. */
const INVALID_PARAMS_CODE = -32_602;
const PROTOCOL_VERSION = 1;
const REJECT_ONCE = 'reject_once';
const REJECT_ALWAYS = 'reject_always';

const rpcErrorSchema = z.object({ code: z.number(), message: z.string().optional() });
const toolSchema = z.object({ toolCallId: z.string().optional(), name: z.string().optional(), toolName: z.string().optional(), rawInput: z.unknown().optional() });
const updateSchema = toolSchema.extend({ sessionUpdate: z.string(), content: z.object({ type: z.string().optional(), text: z.string().optional() }).optional(), size: z.number().optional() });
const permissionSchema = z.object({ toolCall: toolSchema.optional(), options: z.array(z.object({ optionId: z.string(), kind: z.string().optional() })).optional() });

type ToolInfo = z.infer<typeof toolSchema>;
export type ConnectAcp = (providerEnv: ProviderEnv | undefined) => Promise<AcpClient>;
type TurnEnd = { kind: 'prompt'; result: unknown } | { kind: 'failed'; error: unknown } | { kind: 'tool' } | { kind: 'aborted' };
interface Drive {
  client: AcpClient;
  sessionId: string;
  context: TranscriptContext;
  signal: AbortSignal | undefined;
  capabilities: PromptCapabilities | undefined;
  /** Set only when the CLI could not take the instructions on `session/new`. */
  leadingInstructions: string | undefined;
}

function readRpcCode(error: unknown): number | undefined {
  const direct = rpcErrorSchema.safeParse(error);
  if (direct.success) return direct.data.code;
  if (typeof error !== 'object' || error === null) return undefined;
  if ('error' in error) {
    const nested = rpcErrorSchema.safeParse(error.error);
    if (nested.success) return nested.data.code;
  }
  if ('cause' in error) {
    const cause = rpcErrorSchema.safeParse(error.cause);
    if (cause.success) return cause.data.code;
  }
  return undefined;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

function failureMessage(error: unknown, client: AcpClient | undefined): string {
  const message = transportFailure(error, client?.stderrTail ?? '');
  return client?.alive === false && !/exit/i.test(message) ? `${message} (process exit)` : message;
}

function handshake(signal: AbortSignal | undefined): { signal?: AbortSignal; timeoutMs: number } {
  return signal === undefined ? { timeoutMs: HANDSHAKE_TIMEOUT_MS } : { signal, timeoutMs: HANDSHAKE_TIMEOUT_MS };
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(new Error('The Antigravity turn was cancelled.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('The Antigravity turn was cancelled.'));
      },
      { once: true },
    );
  });
}

async function openSession(client: AcpClient, signal: AbortSignal | undefined, instructions: string | undefined): Promise<string> {
  const params: SessionNewParams = {
    cwd: process.cwd(),
    mcpServers: [],
    ...(instructions === undefined ? {} : { _meta: { antigravity: { systemPrompt: { append: instructions } } } }),
  };
  for (let attempt = 0; attempt <= AUTH_RETRIES; attempt += 1) {
    try {
      const result = await client.request(ACP_METHODS.newSession, params, handshake(signal));
      const parsed = z.object({ sessionId: z.string().min(PROTOCOL_VERSION) }).safeParse(result);
      if (!parsed.success) throw new Error('Antigravity session/new did not return a session id');
      return parsed.data.sessionId;
    } catch (error: unknown) {
      if (readRpcCode(error) !== AUTH_REQUIRED_CODE || attempt >= AUTH_RETRIES || signal?.aborted === true) throw error;
      await wait(AUTH_RETRY_DELAY_MS, signal);
    }
  }
  throw new Error('Antigravity session did not start');
}

async function selectEffort(client: AcpClient, sessionId: string, meta: TurnMeta, signal: AbortSignal | undefined): Promise<TurnMeta> {
  if (meta.thinkingLevel === undefined || meta.model.thinkingLevelMap === undefined) return meta;
  const mapped = meta.model.thinkingLevelMap[meta.thinkingLevel];
  if (typeof mapped !== 'string') return meta;
  try {
    await client.request(ACP_METHODS.setConfigOption, { sessionId, configId: CONFIG_THOUGHT_LEVEL, value: mapped }, handshake(signal));
    return { ...meta, providerThinkingLevel: mapped };
  } catch (error: unknown) {
    if (readRpcCode(error) === INVALID_PARAMS_CODE) return meta;
    throw error;
  }
}

/** The CLI advertises whether it accepts client system-prompt text on `session/new`. */
function acceptsSystemPrompt(result: unknown): boolean {
  const schema = z.object({ agentCapabilities: z.object({ _meta: z.object({ antigravity: z.object({ systemPrompt: z.object({ append: z.boolean().optional() }).optional() }).optional() }).optional() }).optional() });
  const parsed = schema.safeParse(result);
  return parsed.success && parsed.data.agentCapabilities?._meta?.antigravity?.systemPrompt?.append === true;
}

function readCapabilities(result: unknown): PromptCapabilities | undefined {
  const schema = z.object({ image: z.boolean().optional(), audio: z.boolean().optional(), embeddedContext: z.boolean().optional() });
  const parsed = z.object({ agentCapabilities: z.object({ promptCapabilities: schema.optional() }).optional() }).safeParse(result);
  const value = parsed.success ? parsed.data.agentCapabilities?.promptCapabilities : undefined;
  if (value === undefined) return undefined;
  return { ...(value.image === undefined ? {} : { image: value.image }), ...(value.audio === undefined ? {} : { audio: value.audio }), ...(value.embeddedContext === undefined ? {} : { embeddedContext: value.embeddedContext }) };
}

function visiblePrompt(blocks: readonly ContentBlock[], capabilities: PromptCapabilities | undefined): readonly ContentBlock[] {
  return blocks.filter((block) => {
    if (block.type === 'image') return capabilities?.image !== false;
    if (block.type === 'audio') return capabilities?.audio !== false;
    return true;
  });
}

function bridged(info: ToolInfo | undefined, declared: ReadonlySet<string>): TurnAction | undefined {
  const name = info?.name ?? info?.toolName;
  if (info === undefined || name === undefined || name === '') return undefined;
  const call = bridgeToolCall({ name, rawInput: info.rawInput, callId: info.toolCallId }, declared);
  return call === undefined ? undefined : { kind: 'tool', call };
}

/** The CLI reports per-turn tokens on the prompt result, not only the context size. */
function tokensFrom(result: unknown): TokenUsage | undefined {
  const schema = z.object({
    usage: z
      .object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        cachedReadTokens: z.number().optional(),
        cachedWriteTokens: z.number().optional(),
        thoughtTokens: z.number().optional(),
        totalTokens: z.number().optional(),
      })
      .optional(),
  });
  const parsed = schema.safeParse(result);
  const usage = parsed.success ? parsed.data.usage : undefined;
  if (usage === undefined) return undefined;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return {
    input,
    output,
    cacheRead: usage.cachedReadTokens ?? 0,
    cacheWrite: usage.cachedWriteTokens ?? 0,
    reasoning: usage.thoughtTokens ?? 0,
    totalTokens: usage.totalTokens ?? input + output,
  };
}

/** What one `session/update` means for a Pi turn. A tool update always ends the turn. */
type UpdateOutcome = { kind: 'none' } | { kind: 'content'; action: TurnAction } | { kind: 'tool'; action: TurnAction | undefined; agyTool: string };

function outcomeForUpdate(params: unknown, declared: ReadonlySet<string>): UpdateOutcome {
  const parsed = z.object({ update: updateSchema.optional() }).safeParse(params);
  const update = parsed.success ? parsed.data.update : undefined;
  if (update === undefined) return { kind: 'none' };
  const text = update.content?.text;
  const textOk = text !== undefined && (update.content?.type === undefined || update.content.type === 'text');
  if (update.sessionUpdate === 'agent_message_chunk' && textOk && text !== undefined) return { kind: 'content', action: { kind: 'text', delta: text } };
  if (update.sessionUpdate === 'agent_thought_chunk' && textOk && text !== undefined) return { kind: 'content', action: { kind: 'thinking', delta: text } };
  if (update.sessionUpdate === 'usage_update' && update.size !== undefined) return { kind: 'content', action: { kind: 'usage', contextSize: update.size } };
  if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return { kind: 'none' };
  return { kind: 'tool', action: bridged(update, declared), agyTool: update.name ?? update.toolName ?? 'an unnamed tool' };
}

/** `allow_*` is never selected. The CLI must not run the tool. */
function rejectionOutcome(params: unknown): PermissionOutcome {
  const parsed = permissionSchema.safeParse(params);
  const options = parsed.success ? parsed.data.options : undefined;
  const once = options?.find((option) => option.kind === REJECT_ONCE);
  if (once !== undefined) return { outcome: 'selected', optionId: once.optionId };
  const always = options?.find((option) => option.kind === REJECT_ALWAYS);
  if (always !== undefined) return { outcome: 'selected', optionId: always.optionId };
  return { outcome: 'cancelled' };
}

function stopAction(reason: string): TurnAction {
  if (reason === 'max_tokens') return { kind: 'stop', reason: 'max_tokens' };
  if (reason === 'refusal') return { kind: 'stop', reason: 'refusal' };
  if (reason === 'cancelled') return { kind: 'stop', reason: 'cancelled' };
  return { kind: 'stop', reason: 'end_turn' };
}

function blockedText(state: TurnState): string | undefined {
  if (envFlagEnabled(process.env[POLICY_ALLOW_ENV])) return undefined;
  const text = state.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  return policyRejection(text);
}

function once<T>(resolve: (value: T) => void): (value: T) => void {
  let used = false;
  return (value) => {
    if (used) return;
    used = true;
    resolve(value);
  };
}

function armAbort(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (signal === undefined) return () => undefined;
  if (signal.aborted) {
    onAbort();
    return () => undefined;
  }
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

function bindTurn(drive: Drive, apply: (action: TurnAction) => void, finish: (end: TurnEnd) => void): () => void {
  const declared = declaredToolNames(drive.context);
  let ending = false;
  /**
   * End the turn at a tool request. `defer` is set on the permission path: the
   * reply to the CLI is written when the handler's promise settles, so the turn
   * must not tear the process down first.
   */
  const sealTool = (defer: boolean): void => {
    apply({ kind: 'stop', reason: 'end_turn' });
    if (ending) return;
    ending = true;
    const settle = (): void => {
      void drive.client.request(ACP_METHODS.cancel, { sessionId: drive.sessionId }).catch(() => undefined);
      finish({ kind: 'tool' });
    };
    if (defer) setTimeout(settle, 0);
    else settle();
  };
  const unsubscribe = drive.client.onNotification((method, params) => {
    if (method !== ACP_METHODS.update) return;
    const outcome = outcomeForUpdate(params, declared);
    if (outcome.kind === 'content') {
      apply(outcome.action);
      return;
    }
    if (outcome.kind !== 'tool') return;
    // A tool update ends the turn whether or not it maps. Approving or ignoring one
    // is what would let the CLI act, so an unmapped request is reported, never passed
    // through and never merely dropped.
    if (outcome.action === undefined) apply({ kind: 'unsupported', agyTool: outcome.agyTool });
    else apply(outcome.action);
    sealTool(false);
  });
  drive.client.setServerRequestHandler(async (method, params) => {
    if (method !== ACP_METHODS.requestPermission) return {};
    const outcome = rejectionOutcome(params);
    const parsed = permissionSchema.safeParse(params);
    const action = bridged(parsed.success ? parsed.data.toolCall : undefined, declared);
    if (action !== undefined) apply(action);
    // A permission request is always the end of a Pi turn, mapped or not, because
    // approving it would let the CLI act on its own.
    sealTool(true);
    return { outcome };
  });
  return () => {
    unsubscribe();
    drive.client.setServerRequestHandler(undefined);
  };
}

interface Driven {
  end: TurnEnd;
  /** Present when the CLI answered the prompt, including a cancelled one. */
  usage: TokenUsage | undefined;
}

async function driveTurn(drive: Drive, apply: (action: TurnAction) => void): Promise<Driven> {
  let resolveEnd: (end: TurnEnd) => void = () => undefined;
  const ended = new Promise<TurnEnd>((resolve) => {
    resolveEnd = once(resolve);
  });
  const detach = bindTurn(drive, apply, (end) => resolveEnd(end));
  const disarm = armAbort(drive.signal, () => {
    void drive.client.request(ACP_METHODS.cancel, { sessionId: drive.sessionId }).catch(() => undefined);
    apply({ kind: 'stop', reason: 'cancelled' });
    resolveEnd({ kind: 'aborted' });
  });
  try {
    const conversation = renderPrompt(drive.context);
    const withInstructions = drive.leadingInstructions === undefined ? conversation : [{ type: 'text' as const, text: drive.leadingInstructions }, ...conversation];
    const prompt = visiblePrompt(withInstructions, drive.capabilities);
    const options = drive.signal === undefined ? undefined : { signal: drive.signal };
    const sent = options === undefined ? drive.client.request(ACP_METHODS.prompt, { sessionId: drive.sessionId, prompt }) : drive.client.request(ACP_METHODS.prompt, { sessionId: drive.sessionId, prompt }, options);
    const answered = sent.then(
      (result) => result,
      () => undefined,
    );
    void sent.then(
      (result) => resolveEnd({ kind: 'prompt', result }),
      (error: unknown) => resolveEnd({ kind: 'failed', error }),
    );
    const end = await ended;
    // A turn sealed at a tool call leaves the prompt unanswered for a moment.
    // Waiting for it is what keeps the token counts honest on tool turns.
    return { end, usage: tokensFrom(end.kind === 'prompt' ? end.result : await withGrace(answered, drive.signal)) };
  } finally {
    disarm();
    detach();
  }
}

/** Resolve with the prompt result, or undefined once the grace window closes or the turn aborts. */
async function withGrace(answered: Promise<unknown>, signal: AbortSignal | undefined): Promise<unknown> {
  if (signal?.aborted === true) return undefined;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), CANCEL_USAGE_GRACE_MS);
  });
  try {
    return await Promise.race([answered, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function settle(end: TurnEnd, state: TurnState, signal: AbortSignal | undefined, client: AcpClient): TurnAction | undefined {
  if (state.stopReason !== 'pending') return undefined;
  if (end.kind === 'aborted' || (end.kind === 'failed' && isAbort(end.error, signal))) return { kind: 'stop', reason: 'cancelled' };
  if (end.kind === 'failed') return { kind: 'fail', message: failureMessage(end.error, client) };
  if (end.kind !== 'prompt') return undefined;
  const rejection = blockedText(state);
  if (rejection !== undefined) return { kind: 'fail', message: rejection };
  const parsed = z.object({ stopReason: z.string().optional() }).safeParse(end.result);
  return stopAction(parsed.success ? (parsed.data.stopReason ?? 'end_turn') : 'end_turn');
}

async function playTurn(stream: AssistantMessageEventStream, drive: Drive, meta: TurnMeta): Promise<void> {
  let state = EMPTY_TURN;
  let open: OpenBlock | undefined;
  let published = false;
  const apply = (action: TurnAction): void => {
    const emitted = emitAction(stream, meta, state, open, action);
    state = emitted.state;
    open = emitted.open;
  };
  const publish = (): void => {
    if (published) return;
    published = true;
    emitTerminal(stream, meta, state, open);
  };
  try {
    stream.push({ type: 'start', partial: messageFor(meta, state) });
    const driven = await driveTurn(drive, apply);
    if (driven.usage !== undefined) apply({ kind: 'tokens', tokens: driven.usage });
    const action = settle(driven.end, state, drive.signal, drive.client);
    if (action !== undefined) apply(action);
    publish();
  } catch (error: unknown) {
    if (state.stopReason === 'pending') apply(isAbort(error, drive.signal) ? { kind: 'stop', reason: 'cancelled' } : { kind: 'fail', message: failureMessage(error, drive.client) });
    publish();
  }
}

async function runTurn(stream: AssistantMessageEventStream, model: Model<typeof API_ID>, context: TranscriptContext, options: (StreamOptions & { reasoning?: ModelThinkingLevel }) | undefined, open: ConnectAcp): Promise<void> {
  let client: AcpClient | undefined;
  let sessionId: string | undefined;
  const meta: TurnMeta = { model, timestamp: Date.now(), ...(options?.reasoning === undefined ? {} : { thinkingLevel: options.reasoning }) };
  try {
    if (options?.signal?.aborted === true) throw new Error('The Antigravity turn was cancelled.');
    client = await open(options?.env);
    const initialized = await client.request(ACP_METHODS.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: {}, terminal: false } }, handshake(options?.signal));
    // Without the append capability the instructions travel as a leading prompt
    // block rather than being dropped.
    const appendSupported = acceptsSystemPrompt(initialized);
    sessionId = await openSession(client, options?.signal, appendSupported ? instructions(context) : undefined);
    await client.request(ACP_METHODS.setConfigOption, { sessionId, configId: CONFIG_MODEL, value: model.id }, handshake(options?.signal));
    const ready = await selectEffort(client, sessionId, meta, options?.signal);
    await playTurn(stream, { client, sessionId, context, signal: options?.signal, capabilities: readCapabilities(initialized), leadingInstructions: appendSupported ? undefined : instructions(context) }, ready);
  } catch (error: unknown) {
    const aborted = isAbort(error, options?.signal);
    const state = aborted ? reduceTurn(EMPTY_TURN, { kind: 'stop', reason: 'cancelled' }) : reduceTurn(EMPTY_TURN, { kind: 'fail', message: failureMessage(error, client) });
    emitTerminal(stream, meta, state, undefined);
  } finally {
    await shutdown(client, sessionId);
  }
}

async function shutdown(client: AcpClient | undefined, sessionId: string | undefined): Promise<void> {
  if (client === undefined) return;
  try {
    // A CLI that never answers close must not keep the process alive.
    if (sessionId !== undefined) await client.request(ACP_METHODS.close, { sessionId }, { timeoutMs: HANDSHAKE_TIMEOUT_MS });
  } catch {
    // A dead process has nothing left to close.
  } finally {
    client.close();
  }
}

async function defaultConnect(providerEnv: ProviderEnv | undefined): Promise<AcpClient> {
  const spec = launchSpec(providerEnv, { worker: true });
  return connectAcp({ command: spec.command, args: spec.args, env: spec.env, cwd: process.cwd() });
}

/** Injectable for tests. Defaults to `launchSpec` + `connectAcp`. */
export function createStream(connect?: ConnectAcp): (model: Model<typeof API_ID>, context: TranscriptContext, options?: StreamOptions & { reasoning?: ModelThinkingLevel }) => AssistantMessageEventStream {
  const open = connect ?? defaultConnect;
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    void runTurn(stream, model, context, options, open).catch((error: unknown) => {
      const aborted = isAbort(error, options?.signal);
      const meta = { model, timestamp: Date.now() };
      const state = aborted ? reduceTurn(EMPTY_TURN, { kind: 'stop', reason: 'cancelled' }) : reduceTurn(EMPTY_TURN, { kind: 'fail', message: failureMessage(error, undefined) });
      emitTerminal(stream, meta, state, undefined);
    });
    return stream;
  };
}

export const streamAgy: ReturnType<typeof createStream> = createStream();
