import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

const HOST = '127.0.0.1';
const OK = 200;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const TOO_MANY_REQUESTS = 429;
const CODE_LIFETIME_SECONDS = 600;
const TOKEN_LIFETIME_SECONDS = 3600;
const POLL_INTERVAL_SECONDS = 1;

export interface RecordedRequest {
  path: string;
  authorization: string | undefined;
  body: string;
}

export type Reply = { kind: 'text'; text: string } | { kind: 'tool'; name: string; args: string } | { kind: 'status'; status: number } | { kind: 'echo-tool-output' };

export interface FakeGrok {
  readonly url: string;
  readonly requests: () => readonly RecordedRequest[];
  readonly reply: (next: Reply) => void;
  readonly replySequence: (next: readonly Reply[]) => void;
  readonly reset: () => void;
  readonly close: () => Promise<void>;
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const sse = (res: ServerResponse, events: readonly object[]): void => {
  res.writeHead(OK, { 'content-type': 'text/event-stream' });
  res.end(events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
};

const textEvents = (text: string): object[] => {
  const item = { id: 'msg_e2e', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  return [
    { type: 'response.created', response: { id: 'resp_e2e', status: 'completed', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_e2e', status: 'completed', output: [] } },
  ];
};

const toolEvents = (name: string, args: string): object[] => {
  const item = { id: 'fc_e2e', type: 'function_call', name, arguments: args, call_id: 'call_e2e' };
  return [
    { type: 'response.created', response: { id: 'resp_e2e', status: 'completed', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: args },
    { type: 'response.function_call_arguments.done', output_index: 0, arguments: args },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_e2e', status: 'completed', output: [] } },
  ];
};

const modelsBody = { data: [{ id: 'grok-4.7', name: 'Grok 4.7', context_window: 256000, api_backend: 'responses', reasoning_efforts: [{ value: 'low' }, { value: 'high' }] }] };

const sendResponses = (res: ServerResponse, body: string, reply: Reply): void => {
  if (reply.kind === 'status') return sendJson(res, reply.status, { error: { code: 'e2e', message: `status ${reply.status}` } });
  if (reply.kind === 'tool') return sse(res, toolEvents(reply.name, reply.args));
  if (reply.kind === 'echo-tool-output') return sse(res, textEvents(body.includes('E2E_TOOL_STDOUT') ? 'SAW_TOOL_OUTPUT' : 'MISSING_TOOL_OUTPUT'));
  return sse(res, textEvents(reply.text));
};

/** A device flow that answers authorization_pending once, so Pi polls at least twice. */
const sendToken = (res: ServerResponse, body: string, callNumber: number): void => {
  if (body.includes('grant_type=refresh_token')) return sendJson(res, OK, { access_token: 'e2e-refreshed-access', refresh_token: 'e2e-refreshed-refresh', expires_in: TOKEN_LIFETIME_SECONDS });
  if (callNumber === 1) return sendJson(res, BAD_REQUEST, { error: 'authorization_pending' });
  return sendJson(res, OK, { access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: TOKEN_LIFETIME_SECONDS });
};

const readBody = (req: IncomingMessage, done: (body: string) => void): void => {
  let chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    chunks = [...chunks, chunk];
  });
  req.on('end', () => done(Buffer.concat(chunks).toString()));
};

const createRoute =
  (nextReply: () => Reply, nextTokenCall: () => number) =>
  (req: IncomingMessage, res: ServerResponse, body: string): void => {
    if (req.url === '/oauth2/device/code') return sendJson(res, OK, { device_code: 'dev', user_code: 'ABCD-1234', verification_uri: 'http://127.0.0.1:9/device', expires_in: CODE_LIFETIME_SECONDS, interval: POLL_INTERVAL_SECONDS });
    if (req.url === '/oauth2/token') return sendToken(res, body, nextTokenCall());
    if (req.url === '/v1/models') return sendJson(res, OK, modelsBody);
    if (req.url === '/v1/responses') return sendResponses(res, body, nextReply());
    return sendJson(res, BAD_REQUEST, { error: 'not found' });
  };

const handlerFor =
  (record: (request: RecordedRequest) => void, route: (req: IncomingMessage, res: ServerResponse, body: string) => void) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    readBody(req, (body) => {
      record({ path: req.url ?? '', authorization: req.headers.authorization, body });
      route(req, res, body);
    });
  };

const urlOf = (server: Server): string => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the fake Grok server has no port');
  return `http://${HOST}:${address.port}`;
};

/** A local stand-in for the Grok Build OAuth and proxy endpoints. */
export async function startFakeGrok(): Promise<FakeGrok> {
  let requests: RecordedRequest[] = [];
  let script: readonly Reply[] = [{ kind: 'text', text: 'E2E_OK' }];
  let responseIndex = 0;
  let tokenCalls = 0;
  const nextReply = (): Reply => {
    const reply = script[Math.min(responseIndex, script.length - 1)] ?? { kind: 'text', text: 'E2E_OK' };
    responseIndex += 1;
    return reply;
  };
  const route = createRoute(nextReply, () => {
    tokenCalls += 1;
    return tokenCalls;
  });
  const record = (request: RecordedRequest): void => {
    requests = [...requests, request];
  };
  const server: Server = createServer(handlerFor(record, route));
  await new Promise<void>((resolve) => {
    server.listen(0, HOST, resolve);
  });
  return {
    url: urlOf(server),
    requests: () => requests,
    reply: (next) => {
      script = [next];
      responseIndex = 0;
    },
    replySequence: (next) => {
      script = next;
      responseIndex = 0;
    },
    reset: () => {
      requests = [];
      script = [{ kind: 'text', text: 'E2E_OK' }];
      responseIndex = 0;
      tokenCalls = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

export const unauthorized = { kind: 'status', status: UNAUTHORIZED } as const;
export const tooManyRequests = { kind: 'status', status: TOO_MANY_REQUESTS } as const;
