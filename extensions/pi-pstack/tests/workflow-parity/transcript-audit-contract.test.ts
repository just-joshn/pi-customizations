import { expect, test } from 'vitest';

import { historyFamilies } from './families/history.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const audit = historyFamilies.find((family) => family.id === 'show-me-your-work')!.checks.filter((check) => check.id === 'trail.audited-against-the-transcript');
const verdict = (name: string, args: Record<string, unknown>, isError = false) => evaluate(audit, { parent: { file: '/sessions/own.jsonl', toolCalls: [{ order: 1, name, args, isError }, { order: 2, name: 'bash', args: { command: 'sh log.sh audit corrected evidence' } }] } } as unknown as RunView)[0]?.verdict;

test('echoing the session path is not a transcript audit', () => {
  expect(verdict('bash', { command: 'echo "$PI_SESSION_FILE"' })).toBe('FAIL');
});
test('counting session lines is not reading the transcript', () => {
  expect(verdict('bash', { command: 'wc -l "$PI_SESSION_FILE"' })).toBe('FAIL');
});
test('a successful content read provides audit evidence', () => {
  expect(verdict('bash', { command: 'cat "$PI_SESSION_FILE"' })).toBe('PASS');
  expect(verdict('read', { path: '/sessions/own.jsonl' })).toBe('PASS');
});
test('a failed read and another session file provide no evidence', () => {
  expect(verdict('read', { path: '/sessions/own.jsonl' }, true)).toBe('FAIL');
  expect(verdict('read', { path: '/sessions/other.jsonl' })).toBe('FAIL');
});
