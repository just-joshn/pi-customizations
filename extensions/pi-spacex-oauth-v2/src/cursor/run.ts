// One agent.v1.AgentService/Run Connect bidi stream: sends the run request, answers the server's
// context, MCP-state and blob requests, and turns server messages into typed events.

import { randomUUID } from 'node:crypto';
import { connect } from 'node:http2';

import { cursorHeaders } from './models.ts';
import { decode, decodeValueMap, EnvelopeReader, encode, encodeValue, type Field, frame, type Json, msg, num, raw, str } from './proto.ts';

export const AGENT_URL = 'https://agentn.global.api5.cursor.sh';
const PI_SERVER = 'pi';
const TOOL_WAIT_MS = 30 * 60_000;

export interface PiTool {
  name: string;
  description: string;
  parameters: Json;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

export type RunEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'tool_calls'; calls: { id: string; name: string; args: Record<string, Json> }[] }
  | { type: 'turn_ended'; usage: Usage }
  /** contextTokens is Cursor's count of the conversation's current context (token_details.used_tokens). */
  | { type: 'checkpoint'; state: Uint8Array; contextTokens: number }
  | { type: 'end'; error?: string };

export interface RunRequest {
  token: string;
  conversationId: string;
  modelId: string;
  userText: string;
  systemPrompt: string;
  tools: PiTool[];
  checkpoint: Uint8Array | undefined;
  blobs: Map<string, Uint8Array>;
}

const toolDefinition = (t: PiTool): Field[] => [
  [1, t.name],
  [2, t.description],
  [3, encodeValue(t.parameters)],
  [4, PI_SERVER],
  [5, t.name],
];

export function runRequestMessage(req: RunRequest): Uint8Array {
  const userMessage: Field[] = [
    [1, req.userText],
    [2, randomUUID()],
    [4, 1], // AgentMode.AGENT
  ];
  return encode([
    [
      1,
      [
        [1, req.checkpoint ?? []],
        [2, [[1, [[1, userMessage]]]]],
        [4, req.tools.map((t): Field => [1, toolDefinition(t)])],
        [5, req.conversationId],
        [9, [[1, req.modelId]]],
      ],
    ],
  ]);
}

/** Parses a Connect end-stream error into the most readable message Cursor sent. */
export function endStreamError(json: string): string | undefined {
  try {
    const body = JSON.parse(json) as { error?: { code?: string; message?: string; details?: { debug?: { details?: { title?: string; detail?: string } } }[] } };
    if (!body.error) return undefined;
    const detail = body.error.details?.find((d) => d.debug?.details?.title)?.debug?.details;
    if (detail?.title) return detail.detail ? `${detail.title}. ${detail.detail}` : detail.title;
    return body.error.message ?? body.error.code ?? 'Cursor request failed';
  } catch {
    return json || undefined;
  }
}

/** The byte pipe under a Run; HTTP/2 in production, recorded bytes in tests. */
export interface Transport {
  write(bytes: Uint8Array): void;
  close(): void;
}

export class CursorRun {
  private reader = new EnvelopeReader();
  private mcpStarted = new Set<string>();
  private mcpArgs = new Map<string, { id: string; name: string; args: Record<string, Json> }>();
  private listed = false;
  private pendingExec = new Map<string, { id: number; execId: string }>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private turnEnded = false;
  private finished = false;
  private req: RunRequest;
  private transport: Transport;
  onEvent: (e: RunEvent) => void = () => {};

  constructor(req: RunRequest, transport: Transport) {
    this.req = req;
    this.transport = transport;
    this.send(runRequestMessage(req));
  }

  /** Feeds bytes received from Cursor. */
  receive(chunk: Uint8Array) {
    try {
      for (const env of this.reader.push(chunk)) {
        if (env.end) this.finish(endStreamError(env.json) ?? (this.turnEnded ? undefined : 'Cursor ended the turn before it finished'));
        else this.handle(env.payload);
      }
    } catch (err) {
      this.finish(`Could not read Cursor's response: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Ends the Run because the connection failed. */
  fail(error?: string) {
    this.finish(error);
  }

  /** The connection closed; that is only a failure if the turn had not finished yet. */
  peerClosed() {
    this.finish(this.turnEnded ? undefined : 'Cursor closed the connection before the turn finished');
  }

  private send(message: Uint8Array) {
    if (!this.finished) this.transport.write(frame(message));
  }

  private execReply(id: number, execId: string, payload: Field) {
    this.send(encode([[2, [[1, id], [15, execId], payload]]]));
    this.send(encode([[5, [[1, [[1, id]]]]]]));
  }

  private handle(payload: Uint8Array) {
    const m = decode(payload);
    const update = msg(m, 1);
    if (update) return this.handleUpdate(update);
    const exec = msg(m, 2);
    if (exec) return this.handleExec(exec);
    const checkpoint = raw(m, 3);
    if (checkpoint) {
      const tokenDetails = msg(decode(checkpoint), 5);
      return this.onEvent({ type: 'checkpoint', state: checkpoint, contextTokens: tokenDetails ? num(tokenDetails, 1) : 0 });
    }
    const kv = msg(m, 4);
    if (kv) return this.handleKv(kv);
  }

  private handleUpdate(u: ReturnType<typeof decode>) {
    const text = msg(u, 1);
    if (text) return this.onEvent({ type: 'text', delta: str(text, 1) });
    const thinking = msg(u, 4);
    if (thinking) return this.onEvent({ type: 'thinking', delta: str(thinking, 1) });
    if (u.bytes.has(5)) return this.onEvent({ type: 'thinking_end' });
    const started = msg(u, 2);
    if (started) {
      const toolCall = msg(started, 2);
      if (toolCall?.bytes.has(15)) this.mcpStarted.add(str(started, 1));
      return;
    }
    if (u.bytes.has(27)) {
      this.listed = true;
      return this.maybeEmitToolCalls();
    }
    const ended = msg(u, 14);
    if (!ended) return;
    this.turnEnded = true;
    // Cursor's input_tokens includes the cache reads; pi's input does not.
    const cacheRead = num(ended, 3);
    this.onEvent({ type: 'turn_ended', usage: { input: num(ended, 1) - cacheRead, output: num(ended, 2), cacheRead, cacheWrite: num(ended, 4), reasoning: num(ended, 5) } });
  }

  private handleExec(e: ReturnType<typeof decode>) {
    const id = num(e, 1);
    const execId = str(e, 15);
    const tools = this.req.tools.map((t): Field => [7, toolDefinition(t)]);
    if (e.bytes.has(10)) {
      const context: Field[] = [
        [
          2,
          [
            [1, '/pi/system-prompt.md'],
            [2, this.req.systemPrompt],
            [3, [[1, []]]],
            [15, true],
          ],
        ],
        [
          4,
          [
            [1, process.platform],
            [2, process.cwd()],
            [3, process.env['SHELL'] ?? ''],
            [10, Intl.DateTimeFormat().resolvedOptions().timeZone],
            [21, process.cwd()],
          ],
        ],
        ...tools,
      ];
      return this.execReply(id, execId, [10, [[1, [[1, context]]]]]);
    }
    if (e.bytes.has(36)) {
      const server: Field[] = [[1, PI_SERVER], [2, PI_SERVER], ...this.req.tools.map((t): Field => [5, toolDefinition(t)]), [7, 'connected']];
      return this.execReply(id, execId, [36, [[1, [[1, server]]]]]);
    }
    const mcp = msg(e, 11);
    if (mcp) {
      const callId = str(mcp, 3);
      this.mcpArgs.set(callId, { id: callId, name: str(mcp, 5) || str(mcp, 1), args: decodeValueMap(mcp, 2) });
      this.pendingExec.set(callId, { id, execId });
      this.mcpStarted.add(callId);
      return this.maybeEmitToolCalls();
    }
    // Any other client-side exec (Cursor's own tools) is refused; the allowed-tools header should prevent these.
    this.send(
      encode([
        [
          5,
          [
            [
              2,
              [
                [1, id],
                [2, 'This tool is not available in pi.'],
              ],
            ],
          ],
        ],
      ]),
    );
  }

  private maybeEmitToolCalls() {
    if (!this.listed || this.mcpStarted.size === 0) return;
    if (![...this.mcpStarted].every((id) => this.mcpArgs.has(id))) return;
    const calls = [...this.mcpArgs.values()];
    this.mcpStarted.clear();
    this.mcpArgs.clear();
    this.listed = false;
    this.heartbeat = setInterval(() => this.send(encode([[7, []]])), 15_000).unref();
    // A Run pi never resumes (abort, /new, session switch) is closed instead of held open forever.
    this.idle = setTimeout(() => this.finish('Timed out waiting for pi to return tool results'), TOOL_WAIT_MS).unref();
    this.onEvent({ type: 'tool_calls', calls });
  }

  /** Sends pi's tool results back into the waiting Run so the model can continue. */
  submitToolResults(results: { id: string; text: string; isError: boolean }[]) {
    clearInterval(this.heartbeat);
    clearTimeout(this.idle);
    const byId = new Map(results.map((r) => [r.id, r]));
    for (const [id, exec] of this.pendingExec) {
      // Every paused call must be answered or the Run waits forever.
      const r = byId.get(id) ?? { id, text: 'pi returned no result for this tool call.', isError: true };
      const result: Field = r.isError
        ? [2, [[1, r.text]]]
        : [
            1,
            [
              [1, [[1, [[1, r.text]]]]],
              [2, false],
            ],
          ];
      this.execReply(exec.id, exec.execId, [11, [result]]);
    }
    this.pendingExec.clear();
  }

  private handleKv(kv: ReturnType<typeof decode>) {
    const id = num(kv, 1);
    const set = msg(kv, 3);
    if (set) {
      const blobId = raw(set, 1);
      const data = raw(set, 2);
      if (blobId && data) this.req.blobs.set(Buffer.from(blobId).toString('base64'), data);
      return this.send(
        encode([
          [
            3,
            [
              [1, id],
              [3, []],
            ],
          ],
        ]),
      );
    }
    const get = msg(kv, 2);
    if (get) {
      const blobId = raw(get, 1);
      const data = blobId ? this.req.blobs.get(Buffer.from(blobId).toString('base64')) : undefined;
      this.send(
        encode([
          [
            3,
            [
              [1, id],
              [2, data ? [[1, data]] : []],
            ],
          ],
        ]),
      );
    }
  }

  get closed() {
    return this.finished;
  }

  private finish(error?: string) {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.idle);
    this.onEvent(error ? { type: 'end', error } : { type: 'end' });
    this.transport.close();
  }

  close() {
    this.finish();
  }
}

export function openCursorRun(req: RunRequest, onResponse: (status: number, headers: Record<string, string>) => void): CursorRun {
  const session = connect(AGENT_URL);
  const stream = session.request({
    ':method': 'POST',
    ':path': '/agent.v1.AgentService/Run',
    'content-type': 'application/connect+proto',
    'connect-protocol-version': '1',
    'x-request-id': randomUUID(),
    'x-cursor-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    // Only MCP tools, so every tool call goes to pi instead of Cursor's own file and shell tools.
    'x-cursor-agent-allowed-tools': 'mcp_tool_call,get_mcp_tools_tool_call',
    ...cursorHeaders(req.token),
  });
  const run = new CursorRun(req, {
    write: (bytes) => stream.write(bytes),
    close: () => {
      stream.close();
      session.close();
    },
  });
  session.on('error', (err) => run.fail(err.message));
  stream.on('response', (headers) => {
    onResponse(Number(headers[':status']), Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)])));
    if (headers[':status'] !== 200) run.fail(`Cursor answered HTTP ${headers[':status']}`);
  });
  stream.on('data', (chunk: Buffer) => run.receive(chunk));
  stream.on('error', (err) => run.fail(err.message));
  stream.on('close', () => run.peerClosed());
  return run;
}
