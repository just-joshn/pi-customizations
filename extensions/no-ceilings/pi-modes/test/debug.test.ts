import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { double, type TestHarness, useTestHarness } from './harness.ts';

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const SAMPLE_TS = 1_700_000_000_000;
const ONE = 1;

const reproductionMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'Added logs.\n<reproduction_steps>\n1. Click login\n2. Observe timeout\n</reproduction_steps>' }],
};

interface DebugPrompt {
  readonly promptText: string;
  readonly endpoint: string;
  readonly sessionId: string;
  readonly logPath: string;
}

interface RejectedIngest {
  readonly name: string;
  readonly status: number;
  readonly header: string | undefined;
  readonly suffix: string;
  readonly body: string;
}

function extractField(content: string, prefix: string): string {
  const line = content.split('\n').find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

async function enterDebug(h: TestHarness): Promise<DebugPrompt> {
  await h.emit('session_start', {});
  await h.runCommand('debug');
  const beforeStart = double<{ message?: { content: string } } | undefined>(await h.emit('before_agent_start', { messageType: 'user', prompt: 'Investigate crash' }));
  const promptText = beforeStart?.message?.content ?? '';
  return {
    promptText,
    endpoint: extractField(promptText, '- Ingest endpoint:'),
    sessionId: extractField(promptText, '- Required header: X-Debug-Session-Id:'),
    logPath: extractField(promptText, '- NDJSON log file:'),
  };
}

describe('Debug mode NDJSON ingest server', () => {
  it('injects [DEBUG MODE ACTIVE] with the ingest endpoint, session id, and log path', async () => {
    const h = useTestHarness();
    const debug = await enterDebug(h);
    expect(debug.promptText).toContain('[DEBUG MODE ACTIVE]');
    expect(debug.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/ingest\/[0-9a-f-]+$/);
    expect(debug.sessionId).toBe('sess12');
    expect(debug.logPath).toContain('.pi/debug-sess12.log');
  });

  it('responds 200 with a wildcard CORS header to an OPTIONS preflight', async ({ signal }) => {
    const h = useTestHarness();
    const debug = await enterDebug(h);
    const optionsRes = await fetch(debug.endpoint, { method: 'OPTIONS', signal });
    expect(optionsRes.status).toBe(HTTP_OK);
    expect(optionsRes.headers.get('access-control-allow-origin')).toBe('*');
  });

  it.for<RejectedIngest>([
    { name: 'a missing session header', status: HTTP_BAD_REQUEST, header: undefined, suffix: '', body: '{"message":"no header"}' },
    { name: 'a ../evil session header', status: HTTP_BAD_REQUEST, header: '../evil', suffix: '', body: '{}' },
    { name: 'an unknown path', status: HTTP_NOT_FOUND, header: 'sess12', suffix: '-nope', body: '{}' },
  ])('rejects $name', async (rejected, { signal }) => {
    const h = useTestHarness();
    const debug = await enterDebug(h);
    const headers = rejected.header === undefined ? {} : { 'X-Debug-Session-Id': rejected.header };
    const response = await fetch(`${debug.endpoint}${rejected.suffix}`, { method: 'POST', headers, body: rejected.body, signal });
    expect(response.status).toBe(rejected.status);
  });

  it('appends a valid NDJSON event to .pi/debug-<id>.log with a trailing newline', async ({ signal }) => {
    const h = useTestHarness();
    const debug = await enterDebug(h);
    const okRes = await fetch(debug.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': debug.sessionId },
      body: JSON.stringify({ id: 'evt-1', timestamp: SAMPLE_TS, message: 'cache miss on token' }),
      signal,
    });
    expect(okRes.status).toBe(HTTP_NO_CONTENT);
    expect(existsSync(debug.logPath)).toBe(true);
    const written = readFileSync(debug.logPath, 'utf-8');
    expect(written).toContain('cache miss on token');
    expect(written.endsWith('\n')).toBe(true);
  });

  it('refreshes the Runtime Logs widget on turn_end and prints entries on /logs', async ({ signal }) => {
    const h = useTestHarness();
    const debug = await enterDebug(h);
    const okRes = await fetch(debug.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': debug.sessionId },
      body: JSON.stringify({ id: 'evt-1', timestamp: SAMPLE_TS, message: 'cache miss on token' }),
      signal,
    });
    expect(okRes.status).toBe(HTTP_NO_CONTENT);
    await h.emit('turn_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'checking' }] } });
    expect((h.getWidgets()['pi-modes-debug-logs'] ?? []).join('\n')).toContain('cache miss on token');
    await h.runCommand('logs');
    expect(h.getNotifications().at(-ONE)?.message).toContain('cache miss on token');
  });
});

describe('Debug mode reproduction_steps decision flow', () => {
  it('sends the proceed message when the user chooses Proceed', async () => {
    const h = useTestHarness({ selectResponses: ['1. Proceed (Issue reproduced)'] });
    await h.emit('session_start', {});
    await h.runCommand('debug');
    await h.emit('agent_end', { messages: [reproductionMessage] });
    expect(h.getSentUserMessages()).toHaveLength(ONE);
    expect(h.getSentUserMessages()[0]?.content).toBe('Issue reproduced, please proceed');
  });

  it('sends the typed follow-up when the user chooses Follow-up', async () => {
    const h = useTestHarness({ selectResponses: ['3. Write a follow-up'], inputResponses: ['It only happens on second click'] });
    await h.emit('session_start', {});
    await h.runCommand('debug');
    await h.emit('agent_end', { messages: [reproductionMessage] });
    expect(h.getSentUserMessages()).toHaveLength(ONE);
    expect(h.getSentUserMessages()[0]?.content).toBe('It only happens on second click');
  });

  it('sends the cleanup message and leaves debug when the user marks the issue fixed', async () => {
    const h = useTestHarness({ selectResponses: ['2. Mark as fixed (Clean up instrumentation)'] });
    await h.emit('session_start', {});
    await h.runCommand('debug');
    await h.emit('agent_end', { messages: [reproductionMessage] });
    expect(h.getSentUserMessages()).toHaveLength(ONE);
    expect(h.getSentUserMessages()[0]?.content).toBe('The issue has been fixed. Please clean up the instrumentation.');
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
  });
});

describe('Debug mode malformed log line resilience', () => {
  it('renders malformed {not valid json} log lines without crashing /logs or Runtime Logs widget', async () => {
    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('debug');

    const logDir = join(h.cwd, '.pi');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'debug-sess12.log'), '{not valid json}\n{"timestamp":1700000000000,"message":"valid entry"}\n', 'utf8');

    await h.emit('turn_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'checking' }] } });
    const widget = (h.getWidgets()['pi-modes-debug-logs'] ?? []).join('\n');
    expect(widget).toContain('{not valid json}');
    expect(widget).toContain('valid entry');

    await h.runCommand('logs');
    const note = h.getNotifications().at(-ONE)?.message ?? '';
    expect(note).toContain('{not valid json}');
    expect(note).toContain('valid entry');
  });

  it('degrades gracefully when debug log path is a directory instead of a file', async () => {
    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('debug');

    mkdirSync(join(h.cwd, '.pi', 'debug-sess12.log'), { recursive: true });
    await h.runCommand('logs');
    expect(h.getNotifications().at(-ONE)?.message).toContain('Waiting for log entries...');
  });
});
