import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { isProcessAlive, LOCK_POLL_INTERVAL, LOCK_WAIT_SECONDS, LockTimeoutError, lockPathFor, withFileLock } from '../../src/compress/lock.ts';

let dataHome = '';
beforeEach(() => {
  dataHome = realpathSync(mkdtempSync(join(tmpdir(), 'caveman-lock-')));
  vi.stubEnv('XDG_DATA_HOME', dataHome);
  vi.stubEnv('LOCALAPPDATA', dataHome);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dataHome, { recursive: true, force: true });
});

async function seedLock(content: string): Promise<string> {
  const lock = await lockPathFor('/proj/docs/a.md');
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, content);
  return lock;
}

test('lockPathFor is a 16-hex digest under locks', async () => {
  const lock = await lockPathFor('/proj/docs/a.md');
  expect(dirname(lock)).toBe(join(dataHome, 'caveman-compress', 'locks'));
  expect(/^[0-9a-f]{16}\.lock$/.test(lock.slice(dirname(lock).length + 1))).toBe(true);
});

test('withFileLock returns the body result', async () => {
  expect(await withFileLock('/proj/docs/a.md', undefined, async () => 'done')).toBe('done');
});

test('withFileLock releases the lock after the body throws', async () => {
  const lock = await lockPathFor('/proj/docs/a.md');
  await expect(withFileLock('/proj/docs/a.md', undefined, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  expect(existsSync(lock)).toBe(false);
});

test('withFileLock reclaims a lock held by a dead pid', async () => {
  await seedLock('2147483646');
  expect(await withFileLock('/proj/docs/a.md', undefined, async () => 'ran')).toBe('ran');
});

test('withFileLock rejects immediately with an already-aborted signal', async () => {
  const lock = await seedLock(String(process.pid));
  await expect(withFileLock('/proj/docs/a.md', AbortSignal.abort(new Error('stop')), async () => 'ran')).rejects.toThrow('stop');
  expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
});

test('withFileLock treats an unparsable lock as live', async () => {
  await seedLock('garbage');
  await expect(withFileLock('/proj/docs/a.md', AbortSignal.abort(new Error('stop')), async () => 'ran')).rejects.toThrow('stop');
});

test('withFileLock times out on a live holder', async () => {
  const lock = await seedLock(String(process.pid));
  vi.spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValue(LOCK_WAIT_SECONDS * 1000);
  await expect(withFileLock('/proj/docs/a.md', undefined, async () => 'ran')).rejects.toThrow(
    new LockTimeoutError(`Another caveman-compress run appears to be compressing /proj/docs/a.md (lock: ${lock}). Giving up after 900s — retry once it finishes.`),
  );
});

test.skipIf(process.platform === 'win32')('withFileLock refuses a symlinked lock directory', async () => {
  const target = join(dataHome, 'elsewhere');
  mkdirSync(target);
  mkdirSync(join(dataHome, 'caveman-compress'));
  symlinkSync(target, join(dataHome, 'caveman-compress', 'locks'));
  await expect(withFileLock('/proj/docs/a.md', undefined, async () => 'ran')).rejects.toThrow('Refusing to use lock directory through a symlink');
});

test.skipIf(process.platform === 'win32')('withFileLock refuses a symlinked lock file', async () => {
  const lock = await lockPathFor('/proj/docs/a.md');
  mkdirSync(dirname(lock), { recursive: true });
  symlinkSync(join(dataHome, 'target'), lock);
  await expect(withFileLock('/proj/docs/a.md', undefined, async () => 'ran')).rejects.toThrow('Refusing to open lock file through a symlink');
});

test('isProcessAlive is true for this process', () => {
  expect(isProcessAlive(process.pid)).toBe(true);
});
test('isProcessAlive is false for an unused pid', () => {
  expect(isProcessAlive(2147483646)).toBe(false);
});

test('withFileLock acquires once the live holder releases', async () => {
  const lock = await seedLock(String(process.pid));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const pending = withFileLock('/proj/docs/a.md', undefined, async () => 'ran');
  await vi.advanceTimersByTimeAsync(0);
  rmSync(lock);
  await vi.advanceTimersByTimeAsync(LOCK_POLL_INTERVAL * 1000);
  expect(await pending).toBe('ran');
});

test('withFileLock stops waiting when aborted mid-poll', async () => {
  await seedLock(String(process.pid));
  const controller = new AbortController();
  const pending = withFileLock('/proj/docs/a.md', controller.signal, async () => 'ran');
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('late stop'));
  await expect(pending).rejects.toThrow('late stop');
});
