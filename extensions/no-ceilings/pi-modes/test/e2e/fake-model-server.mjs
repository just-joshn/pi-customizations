import { createServer } from 'node:http';

const ZERO = 0;

function contentText(message) {
  if (message === undefined) {
    return '';
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  return (Array.isArray(message.content) ? message.content : []).map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n');
}

function chunk(delta, finishReason = null) {
  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: ZERO,
    model: 'echo',
    choices: [{ index: ZERO, delta, finish_reason: finishReason }],
  };
}

function toolCall(name, args) {
  return { role: 'assistant', tool_calls: [{ index: ZERO, id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
}

function writeStream(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  for (const entry of chunks) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * Deterministic OpenAI-compatible model. It reads the last user message and answers with a fixed
 * text or a fixed tool call, so an end-to-end run needs no credentials and no real model.
 */
export async function startFakeModelServer() {
  let requests = [];
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.on('data', (data) => {
      raw += data;
    });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests = [...requests, body];
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const text = messages
        .filter((message) => message.role === 'user')
        .map(contentText)
        .join('\n');
      const hasToolResult = messages.some((message) => message.role === 'tool');

      if (!hasToolResult && text.includes('USE_TOOL')) {
        writeStream(res, [chunk(toolCall('bash', { command: 'rm -rf victim.txt' })), chunk({}, 'tool_calls')]);
        return;
      }
      if (!hasToolResult && text.includes('SWITCH_TO_ASK')) {
        writeStream(res, [chunk(toolCall('switch_mode', { target_mode_id: 'ask' })), chunk({}, 'tool_calls')]);
        return;
      }
      writeStream(res, [chunk({ role: 'assistant', content: hasToolResult ? 'DONE_AFTER_TOOL' : 'FAKE_OK' }), chunk({}, 'stop')]);
    });
  });

  await new Promise((resolve) => server.listen(ZERO, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    reset: () => {
      requests = [];
    },
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
