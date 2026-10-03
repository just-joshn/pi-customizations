import { describe, expect, test } from 'vitest';
import maintainerExtension from '../index.ts';
import { createHarness, type MaintainerHarness } from './helpers/fake-pi.ts';

function startSession(harness: MaintainerHarness): Promise<unknown> {
  return harness.emit('session_start', { type: 'session_start', reason: 'startup' });
}

const PARSE_FAILURE_NOTIFICATIONS = [
  { message: 'Unable to parse --lint-cmd "rust:"', type: 'error' },
  { message: 'The arg should be "language: cmd --args ..."', type: 'info' },
  { message: 'For example: --lint-cmd "python: flake8 --select=E9"', type: 'info' },
];

describe('session_start with a failing --lint-cmd', () => {
  test('emits the parse guidance on its channels and exits with code 1', async () => {
    const harness = createHarness({ flags: { 'lint-cmd': 'rust:' } });
    maintainerExtension(harness.pi);
    const before = process.exitCode;
    await startSession(harness);
    expect(harness.notifications).toEqual(PARSE_FAILURE_NOTIFICATIONS);
    expect(harness.shutdowns()).toBe(1);
    expect(process.exitCode).toBe(1);
    process.exitCode = before;
  });

  test('records the parse guidance as entries when no UI is attached', async () => {
    const harness = createHarness({ hasUI: false, flags: { 'lint-cmd': 'rust:' } });
    maintainerExtension(harness.pi);
    const before = process.exitCode;
    await startSession(harness);
    expect(harness.entries).toEqual([
      { customType: 'maintainer-output', data: { message: PARSE_FAILURE_NOTIFICATIONS[0]?.message, type: 'error' } },
      { customType: 'maintainer-output', data: { message: PARSE_FAILURE_NOTIFICATIONS[1]?.message, type: 'info' } },
      { customType: 'maintainer-output', data: { message: PARSE_FAILURE_NOTIFICATIONS[2]?.message, type: 'info' } },
    ]);
    expect(harness.shutdowns()).toBe(1);
    expect(process.exitCode).toBe(1);
    process.exitCode = before;
  });

  test('exits even when no one-shot mode was requested', async () => {
    const harness = createHarness({ flags: { 'lint-cmd': 'rust:', lint: false, test: false } });
    maintainerExtension(harness.pi);
    const before = process.exitCode;
    await startSession(harness);
    expect(harness.shutdowns()).toBe(1);
    process.exitCode = before;
  });
});

describe('session_start with a valid --lint-cmd', () => {
  test('keeps the session alive', async () => {
    const harness = createHarness({ flags: { 'lint-cmd': 'python: flake8' } });
    maintainerExtension(harness.pi);
    await startSession(harness);
    expect(harness.shutdowns()).toBe(0);
    expect(harness.notifications).toEqual([]);
  });
});
