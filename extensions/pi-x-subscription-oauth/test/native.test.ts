import { readFile } from 'node:fs/promises';
import type { ServerHttp2Stream } from 'node:http2';
import http2 from 'node:http2';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { createModels, InMemoryCredentialStore, type OAuthCredential } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import { NativeTransportError, openCursorRun } from '../src/cursor/native/http2.ts';
import { readAssistantText } from '../src/cursor/native/turn.ts';
import { decodeFrame, encodeContextRequestFrame, encodeErrorFrame, encodeRunFrame, encodeTextFrame, encodeTurnEndFrame, FrameBuffer } from '../src/cursor/native/wire.ts';
import { createCursorProvider } from '../src/cursor/provider.ts';
import { test } from './network-guard.ts';
import { oauthCredential } from './support/credentials.ts';

const fixtureUrl = new URL('./fixtures/cursor/native-run.json', import.meta.url);
const SUCCESS = `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'pong' })}\n`;

function cursorCredential(access = 'cursor-access'): OAuthCredential {
  return { ...oauthCredential(), access, refresh: 'cursor-refresh' };
}

async function storeCursor(credential: OAuthCredential): Promise<InMemoryCredentialStore> {
  const store = new InMemoryCredentialStore();
  await store.modify('cursor', async () => credential);
  return store;
}

function listen(onStream: (stream: ServerHttp2Stream) => void): Promise<{ url: string; close(): Promise<void> }> {
  const server = http2.createServer();
  server.on('stream', onStream);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function happyStream(stream: ServerHttp2Stream): void {
  stream.respond({ ':status': 200, 'content-type': 'application/connect+proto' });
  const buffer = new FrameBuffer();
  let stage = 0;
  stream.on('data', (chunk: Buffer) => {
    for (const frame of buffer.push(chunk)) {
      stage += 1;
      if (stage === 1 && frame.toString('utf8').includes('ping')) stream.write(encodeContextRequestFrame());
      if (stage === 2) {
        stream.write(encodeTextFrame('pong'));
        stream.write(encodeTurnEndFrame());
        stream.end();
      }
    }
  });
}

async function ask(baseUrl: string, access = 'cursor-access') {
  let agentCalled = false;
  const provider = createCursorProvider({
    openNative: (input) => openCursorRun({ ...input, baseUrl }),
    runAgent: async () => {
      agentCalled = true;
      throw new Error('agent should not run');
    },
  });
  const models = createModels({ credentials: await storeCursor(cursorCredential(access)) });
  models.setProvider(provider);
  const model = models.getModel('cursor', 'composer-2.5');
  if (!model) throw new Error('cursor/composer-2.5 is not listed');
  const message = await models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }).result();
  return { message, agentCalled };
}

test('the redacted capture fixture is the native run rpc', async () => {
  const fixture = JSON.parse(await readFile(fileURLToPath(fixtureUrl), 'utf8')) as { endpoint: string; prompt: string; modelId: string };
  expect(fixture.endpoint).toBe('/agent.v1.AgentService/Run');
  const frame = encodeRunFrame({ prompt: fixture.prompt, modelId: fixture.modelId, messageId: 'msg', conversationId: 'conv', runId: 'run' });
  expect(frame.toString('utf8')).toContain('composer-2.5');
  expect(frame.toString('utf8')).toContain('[redacted]');
  expect(frame.toString('utf8')).not.toContain('eyJ');
  expect(decodeFrame(encodeTextFrame('pong'))).toEqual([{ type: 'text', text: 'pong' }]);
  expect(decodeFrame(encodeErrorFrame('You have no credits left for this usage period.'))).toEqual([{ type: 'error', message: 'You have no credits left for this usage period.' }]);
});

function flagged(flags: number, payload: Buffer): Buffer {
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = flags;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

test('decode ignores broken frames and keeps readable errors', () => {
  expect(decodeFrame(Buffer.alloc(0))).toEqual([]);
  expect(decodeFrame(Buffer.from([0, 0, 0, 0, 5, 1]))).toEqual([]);
  expect(decodeFrame(flagged(1, Buffer.from('nope')))).toEqual([]);
  const text = encodeTextFrame('pong');
  expect(decodeFrame(flagged(1, gzipSync(text.subarray(5))))).toEqual([{ type: 'text', text: 'pong' }]);
  expect(decodeFrame(flagged(2, Buffer.alloc(0)))).toEqual([]);
  expect(decodeFrame(flagged(2, Buffer.from('nope')))).toEqual([{ type: 'error', message: 'nope' }]);
  expect(decodeFrame(flagged(2, Buffer.from('{"error":{}}')))).toEqual([]);
});

test('an ended run with no text is an empty reply', async () => {
  const closed = { value: false };
  await expect(
    readAssistantText(
      {
        write() {},
        async *frames() {
          yield encodeTurnEndFrame();
        },
        close() {
          closed.value = true;
        },
      },
      { prompt: 'ping', modelId: 'composer-2.5' },
    ),
  ).rejects.toThrow('Cursor returned an empty reply.');
  expect(closed.value).toBe(true);
});

test('a run that never answers times out', async () => {
  await expect(
    readAssistantText(
      {
        write() {},
        async *frames() {
          yield encodeContextRequestFrame();
        },
        close() {},
      },
      { prompt: 'ping', modelId: 'composer-2.5' },
      undefined,
      0,
    ),
  ).rejects.toThrow('Cursor ask timed out.');
});

test('an aborted ask stops before the model answers', async () => {
  const signal = new AbortController();
  signal.abort();
  await expect(
    readAssistantText(
      {
        write() {},
        async *frames() {},
        close() {},
      },
      { prompt: 'ping', modelId: 'composer-2.5' },
      signal.signal,
    ),
  ).rejects.toThrow('aborted');
});

test('a native ask returns model text without cursor-agent', async () => {
  const server = await listen(happyStream);
  try {
    const { message, agentCalled } = await ask(server.url);
    expect(message.stopReason).toBe('stop');
    expect(message.content).toEqual([{ type: 'text', text: 'pong' }]);
    expect(agentCalled).toBe(false);
  } finally {
    await server.close();
  }
});

test('native HTTP 401 names Cursor login and hides the token', async () => {
  const server = await listen((stream) => {
    stream.respond({ ':status': 401 });
    stream.end();
  });
  try {
    const { message, agentCalled } = await ask(server.url, 'cursor-secret');
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toContain('HTTP 401');
    expect(message.errorMessage).toContain('/login');
    expect(message.errorMessage).not.toContain('cursor-secret');
    expect(agentCalled).toBe(false);
  } finally {
    await server.close();
  }
});

test('a native quota error names credits and does not crash', async () => {
  const server = await listen((stream) => {
    stream.respond({ ':status': 200, 'content-type': 'application/connect+proto' });
    stream.write(encodeErrorFrame('You have no credits left for this usage period.'));
    stream.end();
  });
  try {
    const { message, agentCalled } = await ask(server.url);
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toContain('credits');
    expect(agentCalled).toBe(false);
  } finally {
    await server.close();
  }
});

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function contextRequest(id: number): Buffer {
  const tag = (field: number, wire: number) => {
    let rest = BigInt((field << 3) | wire);
    const bytes: number[] = [];
    while (rest > 127n) {
      bytes.push(Number((rest & 127n) | 128n));
      rest >>= 7n;
    }
    bytes.push(Number(rest));
    return Buffer.from(bytes);
  };
  const idField = Buffer.concat([tag(1, 0), Buffer.from([id])]);
  const inner = Buffer.concat([idField, tag(10, 2), Buffer.from([0])]);
  const body = Buffer.concat([tag(2, 2), Buffer.from([inner.length]), inner]);
  return flagged(0, body);
}

test('later text still joins the reply', async () => {
  const text = await readAssistantText(
    {
      write() {},
      async *frames() {
        yield encodeTextFrame('hello');
        await pause(1_600);
        yield encodeTextFrame(' world');
        yield encodeTurnEndFrame();
      },
      close() {},
    },
    { prompt: 'ping', modelId: 'composer-2.5' },
  );
  expect(text).toBe('hello world');
});

test('a credits error after the first text still fails the ask', async () => {
  await expect(
    readAssistantText(
      {
        write() {},
        async *frames() {
          yield encodeTextFrame('hello');
          await pause(1_600);
          yield encodeErrorFrame('You have no credits left for this usage period.');
        },
        close() {},
      },
      { prompt: 'ping', modelId: 'composer-2.5' },
    ),
  ).rejects.toThrow(/credits/i);
});

test('a connect not-logged-in error tells the user to log in', async () => {
  const body = Buffer.from(
    JSON.stringify({
      error: {
        code: 'unauthenticated',
        message: 'Error',
        details: [{ type: 'aiserver.v1.ErrorDetails', debug: { error: 'ERROR_NOT_LOGGED_IN', details: { detail: 'If you are logged in, try logging out and back in.' } } }],
      },
    }),
  );
  const server = await listen((stream) => {
    stream.respond({ ':status': 200, 'content-type': 'application/connect+proto' });
    stream.write(flagged(2, body));
    stream.end();
  });
  try {
    const { message, agentCalled } = await ask(server.url, 'cursor-secret');
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toBe('Cursor rejected the session (HTTP 401). Run /login and choose Cursor.');
    expect(message.errorMessage).not.toContain('cursor-secret');
    expect(agentCalled).toBe(false);
  } finally {
    await server.close();
  }
});

test('a context reply copies the exec id and returns the model text', async () => {
  const server = await listen((stream) => {
    stream.respond({ ':status': 200, 'content-type': 'application/connect+proto' });
    const buffer = new FrameBuffer();
    let stage = 0;
    stream.on('data', (chunk: Buffer) => {
      for (const frame of buffer.push(chunk)) {
        stage += 1;
        if (stage === 1) stream.write(contextRequest(42));
        if (stage === 2) {
          if (!frame.includes(Buffer.from([0x08, 42]))) {
            stream.end();
            return;
          }
          stream.write(encodeTextFrame('pong'));
          stream.write(encodeTurnEndFrame());
          stream.end();
        }
      }
    });
  });
  try {
    const { message, agentCalled } = await ask(server.url);
    expect(message.stopReason).toBe('stop');
    expect(message.content).toEqual([{ type: 'text', text: 'pong' }]);
    expect(agentCalled).toBe(false);
  } finally {
    await server.close();
  }
});

test('an accepted ask that dies does not call cursor-agent', async () => {
  const server = http2.createServer();
  server.on('session', (session) => {
    session.on('error', () => undefined);
  });
  server.on('stream', (stream) => {
    stream.on('error', () => undefined);
    stream.respond({ ':status': 200, 'content-type': 'application/connect+proto' });
    stream.on('data', () => {
      stream.session?.destroy(new Error('reset after headers'));
    });
  });
  const url = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
  let agentCalled = false;
  const provider = createCursorProvider({
    openNative: (input) => openCursorRun({ ...input, baseUrl: url }),
    runAgent: async () => {
      agentCalled = true;
      return { code: 0, stdout: SUCCESS, stderr: '' };
    },
  });
  const models = createModels({ credentials: await storeCursor(cursorCredential()) });
  models.setProvider(provider);
  const model = models.getModel('cursor', 'composer-2.5');
  if (!model) throw new Error('cursor/composer-2.5 is not listed');
  try {
    const message = await models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }).result();
    expect(agentCalled).toBe(false);
    expect(message.stopReason).toBe('error');
    expect(message.content).toEqual([]);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test('a silent TCP accept falls back to cursor-agent', async () => {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address && typeof address === 'object' ? address.port : 0);
    });
  });
  const provider = createCursorProvider({
    openNative: (input) => openCursorRun({ ...input, baseUrl: `http://127.0.0.1:${port}`, prefaceMs: 200 }),
    runAgent: async () => ({ code: 0, stdout: SUCCESS, stderr: '' }),
  });
  const models = createModels({ credentials: await storeCursor(cursorCredential()) });
  models.setProvider(provider);
  const model = models.getModel('cursor', 'composer-2.5');
  if (!model) throw new Error('cursor/composer-2.5 is not listed');
  try {
    const message = await models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }).result();
    expect(message.stopReason).toBe('stop');
    expect(message.content).toEqual([{ type: 'text', text: 'pong' }]);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test('a broken native connection falls back to cursor-agent', async () => {
  const provider = createCursorProvider({
    openNative: async () => {
      throw new NativeTransportError('socket closed');
    },
    runAgent: async () => ({ code: 0, stdout: SUCCESS, stderr: '' }),
  });
  const models = createModels({ credentials: await storeCursor(cursorCredential()) });
  models.setProvider(provider);
  const model = models.getModel('cursor', 'composer-2.5');
  if (!model) throw new Error('cursor/composer-2.5 is not listed');
  const message = await models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }).result();
  expect(message.stopReason).toBe('stop');
  expect(message.content).toEqual([{ type: 'text', text: 'pong' }]);
});
