import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';

export type RecordedRequest = { readonly path: string; readonly headers: IncomingHttpHeaders; readonly body: unknown };

export type Reply = (res: ServerResponse, request: RecordedRequest) => void;

export type ResponsesServer = {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  respond(reply: Reply): void;
  close(): Promise<void>;
};

export function frame(event: { readonly type: string; readonly [key: string]: unknown }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

const MESSAGE = { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };

export function responseCreatedFrame(): string {
  return frame({ type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } });
}

function okStream(): string {
  return [
    { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', content_index: 0, delta: 'OK' },
    { type: 'response.output_text.done', output_index: 0, item_id: 'msg_1', content_index: 0, text: 'OK' },
    { type: 'response.output_item.done', output_index: 0, item: MESSAGE },
    {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        status: 'completed',
        output: [MESSAGE],
        usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 12 },
      },
    },
  ]
    .map(frame)
    .join('');
}

export function okReply(): Reply {
  return (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(okStream());
  };
}

export function openStreamReply(head: string): Reply {
  return (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(head);
  };
}

export async function startResponsesServer(initial: Reply = okReply()): Promise<ResponsesServer> {
  const requests: RecordedRequest[] = [];
  const state = { reply: initial };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request = { path: req.url ?? '', headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
      requests.push(request);
      state.reply(res, request);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('responses server has no port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
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
