import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';

import { type AnthropicEvent, frames } from './sse.ts';

export type Reply = (res: ServerResponse, request: RecordedRequest) => void;

export interface RecordedRequest {
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

export interface MessagesServer {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  respond(reply: Reply): void;
  close(): Promise<void>;
}

export function sseReply(events: readonly AnthropicEvent[]): Reply {
  return (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(frames(events));
  };
}

export function rawSseReply(body: string): Reply {
  return (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(body);
  };
}

export function errorReply(status: number, message: string): Reply {
  return (res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }));
  };
}

export function splitReply(body: string, splitAfterByte: number): Reply {
  const bytes = new TextEncoder().encode(body);
  return (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(bytes.subarray(0, splitAfterByte), () => setImmediate(() => res.end(bytes.subarray(splitAfterByte))));
  };
}

export function openStreamReply(head: string): Reply {
  return (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(head);
  };
}

async function readBody(req: AsyncIterable<Buffer | string>): Promise<unknown> {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startMessagesServer(initial: Reply): Promise<MessagesServer> {
  const requests: RecordedRequest[] = [];
  const state = { reply: initial };
  const server = createServer((req, res) => {
    readBody(req).then(
      (body) => {
        const request = { headers: req.headers, body };
        requests.push(request);
        state.reply(res, request);
      },
      () => {
        res.writeHead(400).end();
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('messages server has no TCP address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    get requests() {
      return [...requests];
    },
    respond(reply) {
      state.reply = reply;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
