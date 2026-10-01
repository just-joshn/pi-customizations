import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { validateId } from '../src/subagents/identifiers.ts';
import { createWorktree } from '../src/subagents/worktree.ts';

test('[G2-34] unsafe worktree ID is rejected before repository lookup or directory creation', async () => {
  const fixture = await workerFixture();
  try {
    await expect(createWorktree(fixture.dir, '../../escaped')).rejects.toThrow('Invalid agent identifier.');
    await expect(readdir(join(fixture.dir, '.pi/worktrees'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fixture.close();
  }
});

import { workerFixture } from './worker-fixture.ts';

test('[G2-34] persisted parent scope ID is validated before worker directory creation', async () => {
  const fixture = await workerFixture();
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await fixture.session.prompt('persist identifier parent');
    spy = vi.spyOn(fixture.session.sessionManager, 'getSessionId').mockReturnValue('../escaped');
    await expect(fixture.call('Task', { prompt: 'unsafe parent scope', run_in_background: false })).rejects.toThrow('Invalid agent identifier.');
  } finally {
    spy?.mockRestore();
    await fixture.close();
  }
});

test.each(['../x', '..', '.', '/tmp/x', 'a/b', 'a\\b', '', null, undefined, 7])('[G2-34] unsafe identifier %j is rejected', (value) => {
  expect(() => validateId(value)).toThrow('Invalid agent identifier.');
});

test('[G2-34] normal UUID and legacy opaque ID are accepted', () => {
  expect(validateId('e330fd61-e85d-4247-9993-6a0f6a49733f')).toBe('e330fd61-e85d-4247-9993-6a0f6a49733f');
  expect(validateId('legacy_task-1')).toBe('legacy_task-1');
});

test('[G2-34] traversal-shaped resume starts no child while native UUID resumes normally', async () => {
  const fixture = await workerFixture();
  try {
    const first = await fixture.call('Task', { prompt: 'identifier first', run_in_background: false });
    const { id } = first.details as { id: string };
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const path = join(fixture.dir, 'child-input.txt');
    const before = await readFile(path, 'utf8');
    await expect(fixture.call('Task', { prompt: 'must not execute', resume: '../x', run_in_background: false })).rejects.toThrow('Invalid agent identifier.');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await fixture.call('Task', { prompt: 'identifier second', resume: id, run_in_background: false })).details).toMatchObject({ id, status: 'settled', output: 'users=2' });
  } finally {
    await fixture.close();
  }
});
