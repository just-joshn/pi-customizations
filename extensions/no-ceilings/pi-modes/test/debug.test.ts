import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './harness.ts';

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const SAMPLE_TS = 1_700_000_000_000;
const ONE = 1;
const TWO = 2;

let harnesses: readonly TestHarness[] = [];

function track(harness: TestHarness): TestHarness {
  harnesses = [...harnesses, harness];
  return harness;
}

afterEach(async () => {
  const current = harnesses;
  harnesses = [];
  for (const h of current) {
    await h.cleanup();
  }
});

function extractField(content: string, prefix: string): string {
  const line = content.split('\n').find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

describe('Debug mode NDJSON ingest server', () => {
  it('validates CORS, headers, paths, appends NDJSON to .pi/debug-<id>.log, and updates Runtime Logs widget', async () => {
    const h = track(createTestHarness());
    await h.emit('session_start', {});
    await h.runCommand('debug');

    const beforeStart = (await h.emit('before_agent_start', { messageType: 'user', prompt: 'Investigate crash' })) as { message?: { content: string } } | undefined;
    const promptText = beforeStart?.message?.content ?? '';
    expect(promptText).toContain('[DEBUG MODE ACTIVE]');

    const endpoint = extractField(promptText, '- Ingest endpoint:');
    const sessionId = extractField(promptText, '- Required header: X-Debug-Session-Id:');
    const logPath = extractField(promptText, '- NDJSON log file:');
    expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/ingest\/[0-9a-f-]+$/);
    expect(sessionId).toBe('sess12');

    const optionsRes = await fetch(endpoint, { method: 'OPTIONS' });
    expect(optionsRes.status).toBe(HTTP_OK);
    expect(optionsRes.headers.get('access-control-allow-origin')).toBe('*');

    const missingHeaderRes = await fetch(endpoint, { method: 'POST', body: '{"message":"no header"}' });
    expect(missingHeaderRes.status).toBe(HTTP_BAD_REQUEST);

    const badHeaderRes = await fetch(endpoint, { method: 'POST', headers: { 'X-Debug-Session-Id': '../evil' }, body: '{}' });
    expect(badHeaderRes.status).toBe(HTTP_BAD_REQUEST);

    const wrongPathRes = await fetch(`${endpoint}-nope`, { method: 'POST', headers: { 'X-Debug-Session-Id': sessionId }, body: '{}' });
    expect(wrongPathRes.status).toBe(HTTP_NOT_FOUND);

    const okRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': sessionId },
      body: JSON.stringify({ id: 'evt-1', timestamp: SAMPLE_TS, message: 'cache miss on token' }),
    });
    expect(okRes.status).toBe(HTTP_NO_CONTENT);
    expect(existsSync(logPath)).toBe(true);
    const written = readFileSync(logPath, 'utf-8');
    expect(written).toContain('cache miss on token');
    expect(written.endsWith('\n')).toBe(true);

    await h.emit('turn_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'checking' }] } });
    expect((h.getWidgets()['pi-modes-debug-logs'] ?? []).join('\n')).toContain('cache miss on token');

    await h.runCommand('logs');
    expect(h.getNotifications().at(-ONE)?.message).toContain('cache miss on token');
  });
});

describe('Debug mode reproduction_steps decision flow', () => {
  it('drives Proceed, Follow-up, and Mark as fixed decisions from <reproduction_steps>', async () => {
    const h = track(
      createTestHarness({
        selectResponses: ['1. Proceed (Issue reproduced)', '3. Write a follow-up', '2. Mark as fixed (Clean up instrumentation)'],
        inputResponses: ['It only happens on second click'],
      }),
    );
    await h.emit('session_start', {});
    await h.runCommand('debug');

    const assistantMsg = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Added logs.\n<reproduction_steps>\n1. Click login\n2. Observe timeout\n</reproduction_steps>' }],
    };

    await h.emit('agent_end', { messages: [assistantMsg] });
    expect(h.getSentUserMessages().at(-ONE)?.content).toBe('Issue reproduced, please proceed');

    await h.emit('agent_end', { messages: [assistantMsg] });
    expect(h.getSentUserMessages().at(-ONE)?.content).toBe('It only happens on second click');

    await h.emit('agent_end', { messages: [assistantMsg] });
    expect(h.getSentUserMessages().at(-ONE)?.content).toBe('The issue has been fixed. Please clean up the instrumentation.');
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
    expect(h.getSentUserMessages().length).toBeGreaterThanOrEqual(TWO);
  });
});

describe('Debug mode malformed log line resilience', () => {
  it('renders malformed {not valid json} log lines without crashing /logs or Runtime Logs widget', async () => {
    const h = track(createTestHarness());
    await h.emit('session_start', {});
    await h.runCommand('debug');

    const logDir = join(h.cwd, '.pi');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'debug-sess12.log'), '{not valid json}\n{"timestamp":1700000000000,"message":"valid entry"}\n', 'utf8');

    await h.runCommand('logs');
    const note = h.getNotifications().at(-ONE)?.message ?? '';
    expect(note).toContain('{not valid json}');
    expect(note).toContain('valid entry');
  });

  it('degrades gracefully when debug log path is a directory instead of a file', async () => {
    const h = track(createTestHarness());
    await h.emit('session_start', {});
    await h.runCommand('debug');

    mkdirSync(join(h.cwd, '.pi', 'debug-sess12.log'), { recursive: true });
    await h.runCommand('logs');
    expect(h.getNotifications().at(-ONE)?.message).toContain('Waiting for log entries...');
  });
});
