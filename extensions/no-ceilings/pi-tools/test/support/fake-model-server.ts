import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One scripted assistant turn. A tool-call turn produces one response with every call in it. */
export interface FakeToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly id?: string;
}

export interface FakeTurn {
  readonly toolCalls?: readonly FakeToolCall[];
  readonly text?: string;
}

export interface FakeRequest {
  readonly model: string;
  readonly messages: readonly unknown[];
  readonly toolNames: readonly string[];
}

export interface FakeModelServer {
  /** Base URL to put in `models.json`, including `/v1`. */
  readonly baseUrl: string;
  readonly requests: FakeRequest[];
  close(): Promise<void>;
}

interface ChatBody {
  readonly model?: string;
  readonly messages?: readonly unknown[];
  readonly tools?: readonly { readonly function?: { readonly name?: string } }[];
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    request.on('error', reject);
  });
}

function chunk(model: string, delta: unknown, finishReason: string | null) {
  return { id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

const USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

/**
 * Deterministic OpenAI-compatible chat endpoint. It streams the scripted turns in order and records
 * every request, so a test can assert which tools the model was offered and what the dispatcher sent
 * back. It never calls a network service and never varies between runs.
 */
export async function startFakeModel(turns: readonly FakeTurn[], options: { readonly model?: string } = {}): Promise<FakeModelServer> {
  const model = options.model ?? 'fake-model';
  const requests: FakeRequest[] = [];
  let turnIndex = 0;

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model' }] }));
      return;
    }
    if (request.method !== 'POST' || (request.url !== '/v1/chat/completions' && request.url !== '/chat/completions')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: `unexpected path ${request.url ?? ''}` } }));
      return;
    }

    const body = JSON.parse(await readBody(request)) as ChatBody;
    requests.push({
      model: body.model ?? model,
      messages: body.messages ?? [],
      toolNames: (body.tools ?? []).map((tool) => tool.function?.name ?? ''),
    });

    const turn = turns[Math.min(turnIndex, Math.max(0, turns.length - 1))];
    turnIndex++;

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (payload: unknown): void => {
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    if (turn?.toolCalls !== undefined && turn.toolCalls.length > 0) {
      const toolCalls = turn.toolCalls.map((call, index) => ({
        index,
        id: call.id ?? `call_${turnIndex}_${index}`,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }));
      send(chunk(model, { role: 'assistant', tool_calls: toolCalls }, null));
      send(chunk(model, {}, 'tool_calls'));
    } else {
      send(chunk(model, { role: 'assistant', content: turn?.text ?? '' }, null));
      send(chunk(model, {}, 'stop'));
    }
    send({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [], usage: USAGE });
    response.write('data: [DONE]\n\n');
    response.end();
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    async close() {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}
