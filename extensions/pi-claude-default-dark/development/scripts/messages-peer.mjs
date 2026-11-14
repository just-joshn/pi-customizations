import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

export const SYNTHETIC_KEY = 'sk-ant-api03-synthetic-capture-key-0000000000000000000000000000';

const frame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const usage = { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function normalize(reply) {
  if (typeof reply === 'string') return { blocks: [{ type: 'text', text: reply }] };
  if (Array.isArray(reply)) return { blocks: reply };
  return { blocks: [], ...reply };
}

function message(model, blocks) {
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
  return { id: `msg_${randomUUID().slice(0, 8)}`, type: 'message', role: 'assistant', model, content: blocks, stop_reason: stop, stop_sequence: null, usage };
}

function stream(model, blocks) {
  const done = message(model, blocks);
  const events = [{ type: 'message_start', message: { ...done, content: [], stop_reason: null } }];
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    } else if (block.type === 'thinking') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { ...block, input: {} } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: done.stop_reason, stop_sequence: null }, usage });
  events.push({ type: 'message_stop' });
  return events.map(frame).join('');
}

const lastUserText = (body) => {
  const last = [...(body?.messages ?? [])].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  return last.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
};

export function startPeer({ script, logPath, port = 0 }) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {}
      const auth = req.headers['x-api-key'] === SYNTHETIC_KEY ? 'synthetic' : req.headers['x-api-key'] || req.headers.authorization ? 'OTHER' : 'none';
      const text = lastUserText(body);
      if (logPath) appendFileSync(logPath, `${JSON.stringify({ method: req.method, url: req.url, auth, model: body?.model, stream: body?.stream, lastUser: text.slice(0, 200) })}\n`);
      if (!req.url.includes('/messages')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end('{"type":"error","error":{"type":"not_found_error","message":"capture peer"}}');
      }
      if (req.url.includes('/count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{"input_tokens":10}');
      }
      const reply = normalize(script(body, text) ?? 'ok');
      const blocks = reply.blocks;
      setTimeout(() => respond(res, body, reply, blocks), reply.delayMs ?? 0);
    });
  });
  function respond(res, body, reply, blocks) {
    if (reply.error) {
      res.writeHead(reply.error.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: reply.error.type, message: reply.error.message } }));
    }
    if (body?.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(stream(body.model, blocks));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(message(body?.model, blocks)));
    }
  }
  return new Promise((done) =>
    server.listen(port, '127.0.0.1', () =>
      done({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () =>
          new Promise((d) => {
            server.close(() => d());
            server.closeAllConnections();
          }),
      }),
    ),
  );
}
