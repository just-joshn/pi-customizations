/**
 * Deterministic OpenAI-compatible model server for tests.
 *
 * The parent request receives a `task` tool call. The child request (recognized by a marker in its
 * system prompt) receives a `read` tool call and then reports the file contents. The parent then
 * echoes the child's report. Nothing here contacts a real model or needs credentials.
 */
import { createServer } from 'node:http';

const ZERO = 0;
const ONE = 1;

function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')).join('');
}

function lastToolText(messages) {
  const tool = [...messages].reverse().find((message) => message.role === 'tool');
  return tool === undefined ? '' : textOf(tool).trim();
}

function chunk(model, delta, finishReason = null) {
  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: ZERO,
    model,
    choices: [{ index: ZERO, delta, finish_reason: finishReason }],
  };
}

function writeEvent(response, data) {
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function streamText(response, model, text) {
  writeEvent(response, chunk(model, { role: 'assistant', content: text }));
  writeEvent(response, chunk(model, {}, 'stop'));
  writeEvent(response, {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: ZERO,
    model,
    choices: [],
    usage: { prompt_tokens: ONE, completion_tokens: ONE, total_tokens: 2 },
  });
  response.write('data: [DONE]\n\n');
  response.end();
}

function streamToolCall(response, model, call) {
  writeEvent(response, chunk(model, { role: 'assistant', tool_calls: [{ index: ZERO, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }));
  writeEvent(response, chunk(model, {}, 'tool_calls'));
  writeEvent(response, {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: ZERO,
    model,
    choices: [],
    usage: { prompt_tokens: ONE, completion_tokens: ONE, total_tokens: 2 },
  });
  response.write('data: [DONE]\n\n');
  response.end();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (part) => {
      body += part;
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

export async function startFakeModelServer(options = {}) {
  const childMarker = options.childMarker ?? 'FAKE_CHILD_MARKER';
  const childFile = options.childFile ?? 'marker.txt';
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) {
      response.writeHead(404).end();
      return;
    }
    let body;
    try {
      body = await readBody(request);
    } catch {
      response.writeHead(400).end();
      return;
    }
    requests.push(body);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const isChild = messages.some((message) => message.role === 'system' && textOf(message).includes(childMarker));
    const hasToolResult = messages.some((message) => message.role === 'tool');
    const model = typeof body.model === 'string' ? body.model : 'fake-model';

    if (options.onRequest !== undefined) {
      const handled = await options.onRequest({ body, messages, isChild, hasToolResult, model, response, streamText, streamToolCall });
      if (handled) {
        return;
      }
    }

    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    if (isChild && !hasToolResult) {
      streamToolCall(response, model, { id: 'call_child_read', name: 'read', args: { path: childFile } });
      return;
    }
    if (isChild) {
      streamText(response, model, `CHILD_SAW:${lastToolText(messages)}`);
      return;
    }
    if (!hasToolResult) {
      streamToolCall(response, model, {
        id: 'call_parent_task',
        name: 'task',
        args: { description: 'Deterministic delegation', prompt: `Read ${childFile} and report its contents.`, subagent_type: 'worker' },
      });
      return;
    }
    streamText(response, model, `PARENT_SAW:${lastToolText(messages)}`);
  });

  await new Promise((resolve) => server.listen(ZERO, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : ZERO;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
