import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { constants as fsConstants, promises as fsPromises } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { deriveDebugSessionId } from './debug-logs.ts';
import { type DebugServerConfig, ONE, ZERO } from './types.ts';

const LOOPBACK_HOST = '127.0.0.1';
const PORT_RANGE_START = 7242;
const PORT_RANGE_END = 7942;
const MAX_PORT = 65_535;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const NEWLINE_BYTE = 10;
const PI_DIR_NAME = '.pi';
const INGEST_PREFIX = '/ingest/';
const SESSION_ID_REGEX = /^[a-zA-Z0-9-]+$/;

function isValidPort(port: number | undefined): port is number {
  return port !== undefined && Number.isInteger(port) && port > ZERO && port <= MAX_PORT;
}

function validateSessionId(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  return SESSION_ID_REGEX.test(raw) ? raw : undefined;
}

function probePortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, host);
  });
}

async function allocatePort(preferredPort: number | undefined): Promise<number> {
  if (isValidPort(preferredPort) && (await probePortAvailable(preferredPort, LOOPBACK_HOST))) {
    return preferredPort;
  }
  const span = PORT_RANGE_END - PORT_RANGE_START + ONE;
  const startOffset = Math.floor(Math.random() * span);
  for (let offset = ZERO; offset < span; offset += ONE) {
    const candidate = PORT_RANGE_START + ((startOffset + offset) % span);
    if (await probePortAvailable(candidate, LOOPBACK_HOST)) {
      return candidate;
    }
  }
  throw new Error(`No available debug ingest ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}

function readLastByte(chunk: Buffer, fallback: number): number {
  if (chunk.length === ZERO) {
    return fallback;
  }
  return chunk[chunk.length - ONE] ?? fallback;
}

function createTrailingNewlineTransform(): Transform {
  let lastByte = NEWLINE_BYTE;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      lastByte = readLastByte(chunk, lastByte);
      callback(null, chunk);
    },
    flush(callback) {
      if (lastByte !== NEWLINE_BYTE) {
        callback(null, Buffer.from('\n'));
        return;
      }
      callback();
    },
  });
}

async function appendStreamSafely(req: IncomingMessage, logFilePath: string): Promise<void> {
  const noFollow = fsConstants.O_NOFOLLOW ?? ZERO;
  const nonBlock = fsConstants.O_NONBLOCK ?? ZERO;
  if (noFollow === ZERO) {
    const stat = await fsPromises.lstat(logFilePath).catch(() => undefined);
    if (stat?.isSymbolicLink()) {
      throw new Error('Refusing to append to a symlinked debug log file');
    }
  }
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | noFollow | nonBlock;
  const handle = await fsPromises.open(logFilePath, flags);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > ONE) {
      await handle.close();
      throw new Error('Refusing to append to a linked or special debug log file');
    }
    await pipeline(req, createTrailingNewlineTransform(), handle.createWriteStream());
  } catch (error) {
    console.error('Failed to append NDJSON debug log:', error);
    await handle.close().catch(() => undefined);
    throw new Error('Debug log append failed', { cause: error });
  }
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Debug-Session-Id');
}

async function handleIngestRequest(req: IncomingMessage, res: ServerResponse, expectedPath: string, activeLogDir: string | undefined, enqueueAppend: (req: IncomingMessage, logPath: string) => Promise<void>): Promise<void> {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(HTTP_OK);
    res.end();
    return;
  }
  if (req.method !== 'POST' || req.url !== expectedPath || !activeLogDir) {
    res.writeHead(HTTP_NOT_FOUND);
    res.end();
    return;
  }
  const rawHeader = req.headers['x-debug-session-id'];
  if (rawHeader === undefined) {
    res.writeHead(HTTP_BAD_REQUEST);
    res.end('missing-session-id');
    return;
  }
  const sessionId = validateSessionId(rawHeader);
  if (!sessionId) {
    res.writeHead(HTTP_BAD_REQUEST);
    res.end('invalid-session-id');
    return;
  }
  const logPath = join(activeLogDir, `debug-${sessionId}.log`);
  try {
    await enqueueAppend(req, logPath);
    res.writeHead(HTTP_NO_CONTENT);
    res.end();
  } catch (error) {
    console.error('NDJSON ingest request failed:', error);
    res.writeHead(HTTP_SERVER_ERROR);
    res.end('write-failed');
    throw new Error('NDJSON ingest write error', { cause: error });
  }
}

export interface DebugServerController {
  readonly getConfig: (workspaceDir: string, conversationId: string, preferredPort?: number) => Promise<DebugServerConfig>;
  readonly stop: () => Promise<void>;
}

async function startListeningServer(logDir: string, preferredPort: number | undefined, expectedPath: string, enqueueAppend: (req: IncomingMessage, logPath: string) => Promise<void>): Promise<{ server: Server; port: number }> {
  await fsPromises.mkdir(logDir, { recursive: true });
  const port = await allocatePort(preferredPort);
  const server = createServer((req, res) => {
    void handleIngestRequest(req, res, expectedPath, logDir, enqueueAppend).catch(() => undefined);
  });
  server.listen(port, LOOPBACK_HOST);
  await once(server, 'listening');
  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr !== null ? addr.port : port;
  return { server, port: boundPort };
}

interface ServerSlot {
  readonly server: Server | undefined;
  readonly port: number;
  readonly logDir: string | undefined;
  readonly rememberedPort: number;
}

export function createDebugServerController(): DebugServerController {
  const expectedPath = `${INGEST_PREFIX}${randomUUID()}`;
  let slot: ServerSlot = { server: undefined, port: ZERO, logDir: undefined, rememberedPort: ZERO };
  let writeQueue: Promise<void> = Promise.resolve();

  const setSlot = (next: ServerSlot): void => {
    slot = next;
  };

  const enqueueAppend = (req: IncomingMessage, logPath: string): Promise<void> => {
    const task = writeQueue.then(
      () => appendStreamSafely(req, logPath),
      () => appendStreamSafely(req, logPath),
    );
    writeQueue = task.catch(() => undefined);
    return task;
  };

  const stop = async (): Promise<void> => {
    const server = slot.server;
    setSlot({ server: undefined, port: ZERO, logDir: undefined, rememberedPort: slot.rememberedPort });
    if (!server) {
      return;
    }
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  };

  const ensureStarted = async (workspaceDir: string, preferredPort?: number): Promise<void> => {
    const nextLogDir = join(workspaceDir, PI_DIR_NAME);
    if (slot.server && slot.logDir === nextLogDir) {
      return;
    }
    if (slot.server) {
      await stop();
    }
    const targetPort = preferredPort ?? (slot.rememberedPort > ZERO ? slot.rememberedPort : undefined);
    const started = await startListeningServer(nextLogDir, targetPort, expectedPath, enqueueAppend);
    setSlot({ server: started.server, port: started.port, logDir: nextLogDir, rememberedPort: started.port });
  };

  const getConfig = async (workspaceDir: string, conversationId: string, preferredPort?: number): Promise<DebugServerConfig> => {
    await ensureStarted(workspaceDir, preferredPort);
    const sessionId = deriveDebugSessionId(conversationId);
    const logDir = slot.logDir ?? join(workspaceDir, PI_DIR_NAME);
    return { serverEndpoint: `http://${LOOPBACK_HOST}:${slot.port}${expectedPath}`, logPath: join(logDir, `debug-${sessionId}.log`), sessionId, port: slot.port };
  };

  return { getConfig, stop };
}
