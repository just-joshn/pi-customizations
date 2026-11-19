import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { clip } from '../src/jobs.ts';
import { workerReport } from '../src/transcript.ts';

let dir: string;
const EMOJI_REPEATS = 100;
const CLIP_HEAD_BYTES = 11;
const CLIP_TAIL_BYTES = 9;
const SHORT_CLIP_BYTES = 4;
const since = '2026-01-01T00:00:00.000Z';
const timestamp = '2026-01-01T00:00:01.000Z';
const user = (text: string) => ({ type: 'message', message: { role: 'user', content: text } });
const answer = (text: string, stopReason = 'stop', errorMessage?: string) => ({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason, errorMessage } });
const wake = { type: 'custom_message', customType: 'pstack-job', content: 'late result', display: true };
const transcript = (turns: object[], name = 'session.jsonl') => {
  const path = join(dir, name);
  writeFileSync(
    path,
    [{ type: 'session', version: 3, id: name, timestamp, cwd: dir }, ...turns.map((turn, index) => ({ id: `${index}`, parentId: index ? `${index - 1}` : null, timestamp, ...turn }))].map((entry) => JSON.stringify(entry)).join('\n'),
  );
  return path;
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-transcript-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test.for(['stop', 'length'])('keeps completed %s answers and later corrections in chronological order', (reason) => {
  const path = transcript([user('brief'), answer('REPORT', reason), wake, answer('CORRECTION'), wake, answer('ACK')]);
  expect(workerReport(dir, since)).toEqual({ path, answers: [reason === 'length' ? '[Worker answer ended with length]\nREPORT' : 'REPORT', 'CORRECTION', 'ACK'], toolCalls: 0 });
});

test('counts the tool calls the worker made after its brief', () => {
  const tool = { type: 'message', message: { role: 'toolResult', toolCallId: 't', toolName: 'bash', content: [], isError: false } };
  transcript([tool, user('brief'), answer('', 'toolUse'), tool, answer('', 'toolUse'), tool, answer('REPORT')]);
  expect(workerReport(dir, since)?.toolCalls).toBe(2);
});

test.for(['error', 'aborted'])('retains the prior report when continuation ends with %s', (reason) => {
  transcript([user('brief'), answer('REPORT'), wake, answer('incomplete', reason, 'synthetic downstream failure')]);
  expect(workerReport(dir, since)?.answers).toEqual(['REPORT', `[Worker answer ended with ${reason}]\nincomplete\nsynthetic downstream failure`]);
});

test.for(['error', 'aborted'])('leaves out a %s turn the worker recovered from', (reason) => {
  transcript([user('brief'), answer('', reason, 'capacity'), answer('', reason, 'capacity'), answer('REPORT')]);
  expect(workerReport(dir, since)?.answers).toEqual(['REPORT']);
});

test.for(['toolUse', 'pending', 'deferred'])('ignores %s turns and empty assistant text', (reason) => {
  transcript([user('brief'), answer('working', reason), { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'result' }] } }, answer(' '), answer('REPORT')]);
  expect(workerReport(dir, since)?.answers).toEqual(['REPORT']);
});

test('a resume reports only the latest user invocation', () => {
  transcript([user('old brief'), answer('OLD'), user('new brief'), answer('NEW'), wake, answer('ACK')]);
  expect(workerReport(dir, since)?.answers).toEqual(['NEW', 'ACK']);
});

test('a resume that never appends its prompt does not replay an old report', () => {
  transcript([user('old brief'), answer('OLD')]);
  expect(workerReport(dir, '2026-01-02T00:00:00.000Z')?.answers).toEqual([]);
});

test('reads the active parent chain rather than an abandoned branch', () => {
  transcript([user('brief'), answer('ABANDONED'), { ...answer('ACTIVE'), parentId: '0' }, wake, answer('ACK')]);
  expect(workerReport(dir, since)?.answers).toEqual(['ACTIVE', 'ACK']);
});

test('selects the newest regular session file and ignores symlinked transcripts', () => {
  const old = transcript([user('brief'), answer('OLD')], 'old.jsonl');
  const current = transcript([user('brief'), answer('NEW')], 'new.jsonl');
  utimesSync(old, 1, 1);
  utimesSync(current, 2, 2);
  symlinkSync(old, join(dir, 'linked.jsonl'));
  expect(workerReport(dir, since)).toEqual({ path: current, answers: ['NEW'], toolCalls: 0 });
});

test('missing, symlinked, and unreadable session locations fall back to stdout', () => {
  expect(workerReport(undefined, since)).toBeUndefined();
  expect(workerReport(join(dir, 'missing'), since)).toBeUndefined();
  const nested = join(dir, 'nested');
  mkdirSync(nested);
  symlinkSync(nested, join(dir, 'linked'));
  expect(workerReport(join(dir, 'linked'), since)).toBeUndefined();
  writeFileSync(join(dir, 'invalid.jsonl'), 'not json');
  expect(workerReport(dir, since)).toBeUndefined();
});

test('clipped derived reports preserve UTF-8 and name the transcript holding the omitted bytes', () => {
  const text = `VERDICT\n${'🙂'.repeat(EMOJI_REPEATS)}\nACK`;
  const clipped = clip(text, CLIP_HEAD_BYTES, CLIP_TAIL_BYTES, '/session.jsonl');
  expect(clipped).toMatch(/^VERDICT\n[\s\S]*full output at \/session.jsonl[\s\S]*ACK$/);
  expect(clipped).not.toContain('\uFFFD');
  expect(clip('REPORT', SHORT_CLIP_BYTES, SHORT_CLIP_BYTES, '/session.jsonl')).toBe('REPORT');
});
