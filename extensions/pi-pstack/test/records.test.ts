import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { storeDir, subagentDir, workspaceSlug, workspaceStateDir, worktreesDir } from '../src/paths.ts';
import { acquireRunLock, readonlyLaunchRestores, readRecord, writeRecord } from '../src/task/records.ts';

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

  test("a cloud agent's worktree survives a write and read (TASK-010)", () => {
    const worktree = { path: '/s/wt', cwd: '/s/wt/pkg', branch: `pstack/${id}`, base: 'main', commit: 'abc' };
    writeRecord(dir, { agentId: id, type: 'generalPurpose', readonly: false, cwd: '/w/app', createdAt: 't', worktree });
    expect(readRecord(dir, id)?.worktree).toEqual(worktree);
  });

  test.for([
    { label: 'no createdAt', record: { agentId: id, type: 'generalPurpose', readonly: false, cwd: '/w/app' } },
    { label: 'a model that is a string', record: { agentId: id, type: 'generalPurpose', readonly: false, cwd: '/w/app', createdAt: 't', model: 'p/m' } },
    { label: 'a model without an id', record: { agentId: id, type: 'generalPurpose', readonly: false, cwd: '/w/app', createdAt: 't', model: { provider: 'p' } } },
    { label: 'a thinking level that is not a string', record: { agentId: id, type: 'generalPurpose', readonly: false, cwd: '/w/app', createdAt: 't', model: { provider: 'p', id: 'm', thinking: 3 } } },
  ])('a record with $label is unreadable (C-L3)', ({ record }) => {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(record));
    expect(() => readRecord(dir, id)).toThrow(`Agent record ${join(dir, `${id}.json`)} is unreadable; delete it and start a new agent.`);
  });

  test('a record whose worktree lacks a field is unreadable (TASK-010)', () => {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ agentId: id, type: 'generalPurpose', readonly: false, cwd: '/w/app', createdAt: 't', worktree: { path: '/s/wt' } }));
    expect(() => readRecord(dir, id)).toThrow(`Agent record ${join(dir, `${id}.json`)} is unreadable; delete it and start a new agent.`);
  });
});

describe('per-workspace state (review: parity 4)', () => {
  test('names a workspace the way Pi names a session folder', () => {
    expect([workspaceSlug('/Users/me/src/app'), workspaceSlug('/w/a:b')]).toEqual(['--Users-me-src-app--', '--w-a-b--']);
  });

  test("a subagent uses its main chat's workspace state, wherever it runs (C-M2)", () => {
    expect([workspaceStateDir('/w/worktrees/agent-1', '/state/root-workspace'), workspaceStateDir('/w/app', undefined).endsWith('pstack/workspaces/--w-app--')]).toEqual(['/state/root-workspace', true]);
  });

  test('keeps subagents and the agent store under the workspace', () => {
    const base = join(process.env['PI_CODING_AGENT_DIR'] ?? join(process.env['HOME'] ?? '', '.pi/agent'), 'pstack/workspaces/--w-app--');
    expect([subagentDir('/w/app'), storeDir('/w/app', 'session-1'), worktreesDir('/w/app')]).toEqual([join(base, 'subagents'), join(base, 'store/session-1'), join(base, 'worktrees')]);
  });
});

describe('tool loadout after a plan-mode launch (C-M1)', () => {
  const tool = (name: string) => ({ name, description: name, parameters: { type: 'object' } });
  const system = (id: string, parentId: string | null, added: string[], removed: string[] = []) => ({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-10-28T10:00:00.000Z',
    message: { role: 'system', content: '', toolsAdded: added.map(tool), toolsRemoved: removed.map((name) => ({ name })), timestamp: 0 },
  });
  const transcript = (...entries: unknown[]) => {
    const path = join(dir, `2026-10-28T10-00-00-000Z_${id}.jsonl`);
    writeFileSync(path, [{ type: 'session', version: 3, id, timestamp: '2026-10-28T10:00:00.000Z', cwd: '/w/app' }, ...entries].map((entry) => `${JSON.stringify(entry)}\n`).join(''));
    return path;
  };

  test('gives back the tools a readonly launch took from the last writable loadout', () => {
    const path = transcript(system('s1', null, ['read', 'bash', 'edit', 'write', 'Task']), system('s2', 's1', ['grep', 'bash'], ['bash', 'edit', 'write', 'Task']));
    expect(readonlyLaunchRestores(path).toSorted()).toEqual(['Task', 'edit', 'write']);
  });

  test('gives back nothing when the loadout is writable or was never writable', () => {
    const writable = readonlyLaunchRestores(transcript(system('s1', null, ['read', 'bash', 'edit', 'write'])));
    const neverWritable = readonlyLaunchRestores(transcript(system('s1', null, ['read', 'grep'])));
    expect({ writable, neverWritable }).toEqual({ writable: [], neverWritable: [] });
  });
});
