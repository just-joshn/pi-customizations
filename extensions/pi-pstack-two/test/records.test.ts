import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { storeDir, subagentDir, workspaceSlug } from '../src/paths.ts';
import { acquireRunLock, readRecord } from '../src/task/records.ts';

const id = '11111111-2222-4333-8444-555555555555';
let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'locks-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('run lock: one writer per agent ID (review: security 3, architecture 2)', () => {
  test('a second acquire while the holder lives is refused, naming the lock file', () => {
    const lock = acquireRunLock(dir, id);
    expect(() => acquireRunLock(dir, id)).toThrow(`Agent ${id} is still running (pid ${process.pid}; lock ${join(dir, `${id}.lock`)}). Wait for its completion before resuming it.`);
    lock.release();
    expect(existsSync(join(dir, `${id}.lock`))).toBe(false);
  });

  test('the lock follows the child that writes the transcript (recheck)', () => {
    const lock = acquireRunLock(dir, id);
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
    lock.holdFor(Number(child));
    expect(readFileSync(join(dir, `${id}.lock`), 'utf8')).toBe(child);
    lock.release();
  });

  test('a lock with no readable pid counts as held, naming the file to remove (fail closed)', () => {
    writeFileSync(join(dir, `${id}.lock`), '');
    expect(() => acquireRunLock(dir, id)).toThrow(`Agent ${id} is still running (pid unknown; lock ${join(dir, `${id}.lock`)}). Wait for its completion before resuming it.`);
  });

  test('release leaves a lock that another live holder took over', () => {
    const lock = acquireRunLock(dir, id);
    writeFileSync(join(dir, `${id}.lock`), String(process.ppid));
    lock.release();
    expect(readFileSync(join(dir, `${id}.lock`), 'utf8')).toBe(String(process.ppid));
  });

  test('release never throws, because a leftover lock is taken over once its holder is gone (review r2: security)', () => {
    const lock = acquireRunLock(dir, id);
    chmodSync(dir, 0o500);
    try {
      lock.release();
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(readFileSync(join(dir, `${id}.lock`), 'utf8')).toBe(String(process.pid));
  });

  test('a lock left by a dead process is taken over', () => {
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
    writeFileSync(join(dir, `${id}.lock`), dead);
    const lock = acquireRunLock(dir, id);
    expect(readFileSync(join(dir, `${id}.lock`), 'utf8')).toBe(String(process.pid));
    expect(() => acquireRunLock(dir, id)).toThrow('is still running');
    lock.release();
  });
});

describe('agent records (review r2: architecture 5)', () => {
  test.for(['{not json', '{"agentId":"x"}', '[]'])('a corrupt or partial record %j fails with a clear error', (text) => {
    writeFileSync(join(dir, `${id}.json`), text);
    expect(() => readRecord(dir, id)).toThrow(`Agent record ${join(dir, `${id}.json`)} is unreadable; delete it and start a new agent.`);
  });
});

describe('per-workspace state (review: parity 4)', () => {
  test('names a workspace the way Pi names a session folder', () => {
    expect([workspaceSlug('/Users/me/src/app'), workspaceSlug('/w/a:b')]).toEqual(['--Users-me-src-app--', '--w-a-b--']);
  });

  test('keeps subagents and the agent store under the workspace', () => {
    const base = join(process.env['PI_CODING_AGENT_DIR'] ?? join(process.env['HOME'] ?? '', '.pi/agent'), 'pstack-two/workspaces/--w-app--');
    expect([subagentDir('/w/app'), storeDir('/w/app', 'session-1')]).toEqual([join(base, 'subagents'), join(base, 'store/session-1')]);
  });
});
