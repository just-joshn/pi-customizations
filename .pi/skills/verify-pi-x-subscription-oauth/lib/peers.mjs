// The local stand-ins for xAI and Cursor. Pi's undici EnvHttpProxyAgent tunnels every fetch
// through `proxyUrl` with CONNECT. The proxy terminates TLS for PEER_HOSTS with a leaf the scratch
// CA signed and hands the request to a recording peer; every other tunnel is refused and logged.
// Cursor's native ask (HTTP/2, which ignores proxies) reaches `cursorUrl` through net-guard.mjs.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { join } from 'node:path';

import { frames, readContextReply, readRunFrame, splitFrames } from './connect.mjs';

export const PEER_HOSTS = ['auth.x.ai', 'cli-chat-proxy.grok.com', 'api2.cursor.sh'];

// A route answers with a reply, or with a function of the recorded request that returns one.
export const reply = (status, body, headers = {}) => ({ status, body, headers });
export const sse = (body) => reply(200, body, { 'content-type': 'text/event-stream' });
// Replies in order; the last one repeats.
export function queue(...replies) {
  let next = 0;
  return () => replies[Math.min(next++, replies.length - 1)];
}

// How the Cursor peer answers a native Run. Each scenario reacts to the client's first frame (the
// Run) and, for `ok`, to its second (the context reply).
const CURSOR_SCENARIOS = {
  ok: {
    onRun: (stream) => stream.write(frames.contextRequest('verify-exec-7')),
    onContextReply: (stream) => {
      stream.write(frames.text('LOCAL_'));
      stream.write(frames.text('OK'));
      stream.end(frames.turnEnd({ input: 11, output: 3, cacheRead: 5, cacheWrite: 0 }));
    },
  },
  refusal: {
    onRun: (stream) =>
      stream.end(
        frames.error({
          error: {
            code: 'resource_exhausted',
            message: 'Error',
            details: [{ type: 'aiserver.v1.ErrorDetails', debug: { details: { title: 'Weekly usage limit reached.', detail: 'It resets in 4 days. Buy credits to keep going now, or upgrade your plan for more weekly usage.' } } }],
          },
        }),
      ),
  },
  'not-logged-in': {
    onRun: (stream) => stream.end(frames.error({ error: { code: 'unauthenticated', message: 'Error', details: [{ type: 'aiserver.v1.ErrorDetails', debug: { error: 'ERROR_NOT_LOGGED_IN' } }] } })),
  },
};

export async function startPeers({ certDir }) {
  const tls = { key: readFileSync(join(certDir, 'leaf.key')), cert: readFileSync(join(certDir, 'leaf.pem')) };
  const routes = new Map();
  const requests = [];
  const tunnels = [];
  const cursorRuns = [];
  let cursorScenario = 'ok';

  const peer = https.createServer(tls, (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const host = (req.headers.host ?? '').replace(/:443$/, '');
      const url = new URL(req.url, `https://${host}`);
      const request = { method: req.method, host, path: url.pathname, query: url.search, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      requests.push(request);
      const route = routes.get(`${req.method} ${host}${url.pathname}`);
      const answer = (typeof route === 'function' ? route(request) : route) ?? reply(404, { error: `verify peer has no route ${req.method} ${host}${url.pathname}` });
      res.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers });
      res.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
    });
  });
  peer.on('tlsClientError', () => undefined);

  const proxy = createServer((req, res) => {
    tunnels.push({ target: req.url, allowed: false });
    res.writeHead(403).end();
  });
  proxy.on('connect', (req, socket) => {
    const allowed = req.url.endsWith(':443') && PEER_HOSTS.includes(req.url.replace(/:443$/, ''));
    tunnels.push({ target: req.url, allowed });
    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    peer.emit('connection', socket);
  });

  const cursor = http2.createSecureServer(tls);
  cursor.on('stream', (stream, headers) => {
    const scenario = CURSOR_SCENARIOS[cursorScenario];
    const record = { scenario: cursorScenario, headers: { ...headers }, run: null, contextReply: null };
    cursorRuns.push(record);
    stream.respond({ ':status': 200, 'content-type': 'application/connect+proto' });
    let pending = Buffer.alloc(0);
    let received = 0;
    stream.on('data', (chunk) => {
      const { payloads, rest } = splitFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const payload of payloads) {
        received += 1;
        if (received === 1) {
          record.run = readRunFrame(payload);
          scenario.onRun(stream);
        } else if (received === 2) {
          record.contextReply = readContextReply(payload);
          scenario.onContextReply?.(stream);
        }
      }
    });
    stream.on('error', () => undefined);
  });

  const listen = (server) =>
    new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', done);
    });
  let closing;
  const close = () => {
    closing ??= (async () => {
      for (const server of [proxy, peer]) server.closeAllConnections?.();
      await Promise.all([proxy, cursor, peer].map((server) => new Promise((done) => server.close(() => done()))));
    })();
    return closing;
  };
  try {
    await Promise.all([listen(proxy), listen(cursor)]);
  } catch (error) {
    await close();
    throw error;
  }

  return {
    proxyUrl: `http://127.0.0.1:${proxy.address().port}`,
    cursorUrl: `https://127.0.0.1:${cursor.address().port}`,
    requests,
    route: (key, handler) => routes.set(key, handler),
    refused: () => tunnels.filter((t) => !t.allowed).map((t) => t.target),
    cursor: {
      runs: cursorRuns,
      use: (scenario) => {
        if (!CURSOR_SCENARIOS[scenario]) throw new Error(`Unknown Cursor scenario ${scenario}`);
        cursorScenario = scenario;
      },
    },
    close,
  };
}
