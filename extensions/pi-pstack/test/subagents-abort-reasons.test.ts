import { expect, test } from 'vitest';
import { abortInfo, normalizeAbortReason } from '../src/subagents/abort-reasons.ts';

test('a foreground permission stop becomes sync permission telemetry with a cutoff note', () => {
  expect(abortInfo('permission-stop', true)).toEqual({
    reason: 'permission-stop',
    userInitiated: false,
    telemetry: 'permission_stop_sync',
    cutoffNote: 'Agent stopped because permission was denied.',
  });
});

test('a foreground user cancel becomes user_cancel_sync while background stops keep their own telemetry', () => {
  expect(abortInfo('user-cancel', true)).toEqual({ reason: 'user-cancel', userInitiated: true, telemetry: 'user_cancel_sync' });
  expect(abortInfo('shutdown', false)).toEqual({ reason: 'shutdown', userInitiated: true, telemetry: 'shutdown' });
  expect(abortInfo('permission-stop', false)).toEqual({ reason: 'permission-stop', userInitiated: false, telemetry: 'turn_teardown' });
});

test('an AbortError unwraps its message while unrelated values fall back to unknown', () => {
  expect(abortInfo(new DOMException('subagent-park', 'AbortError'), false)).toEqual({ reason: 'subagent-park', userInitiated: true, telemetry: 'subagent_park' });
  expect(abortInfo(new DOMException('unlisted', 'AbortError'), true)).toEqual({ reason: 'unknown', userInitiated: false, telemetry: 'user_cancel_sync' });
  expect(normalizeAbortReason(42)).toBe('unknown');
  expect(normalizeAbortReason(new DOMException('ignored', 'NotAbortError'))).toBe('unknown');
});
