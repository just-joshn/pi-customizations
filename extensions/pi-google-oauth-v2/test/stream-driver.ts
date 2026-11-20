import type { Message, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { ROUTE_STREAM } from './constants.ts';
import type { Responder } from './google.ts';
import { startSession } from './session.ts';
import { part, stopChunk } from './sse.ts';

export const STREAM_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse';
export const FLASH_MODEL = 'gemini-3.8-flash';

const SENT_BODY = z.object({ project: z.string(), request: z.object({ contents: z.array(z.json()) }) });
const HI: Message[] = [{ role: 'user', content: 'hi', timestamp: 1 }];

export interface Sent {
  url: string;
  headers: Record<string, string>;
  body: z.infer<typeof SENT_BODY>;
}

export type Reply = Response | Responder;

const asResponder =
  (reply: Reply): Responder =>
  (request, attempt) =>
    typeof reply === 'function' ? reply(request, attempt) : reply;

/** Streams one prompt through the registered provider while Google answers with `reply`. */
export async function run(reply: Reply, options: SimpleStreamOptions = {}, messages: Message[] = HI) {
  const session = await startSession({ routes: { [ROUTE_STREAM]: asResponder(reply) } });
  const stream = await session.stream(session.model(FLASH_MODEL), messages, options);
  return {
    session,
    stream,
    get sent(): Sent[] {
      return session.google.requestsTo(ROUTE_STREAM).map((request) => ({ url: request.url, headers: request.headers, body: SENT_BODY.parse(request.json) }));
    },
    /** Counts the requests Google has received so far. A function, so destructuring it does not freeze the count. */
    requestCount: (): number => session.google.requestsTo(ROUTE_STREAM).length,
  };
}

export { part, stopChunk };
