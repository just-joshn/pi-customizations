import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { workspaceHistory } from '../src/history.ts';

test('handles UTF-8, blank prefixes, EOF headers, malformed records and symlink ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-history-boundary-'));
  try {
    const own = join(root, 'own.jsonl');
    const foreign = join(root, 'foreign.jsonl');
    await writeFile(own, `\n${JSON.stringify({ type: 'session', id: 'own', cwd: root })}\ninvalid record\n{"type":"session_info","name":"名前 🙂"}\n`);
    await writeFile(foreign, JSON.stringify({ type: 'session', id: 'foreign', cwd: join(root, 'other') }));
    await writeFile(join(root, 'malformed.jsonl'), '{bad header}\n{"type":"session_info","name":"not a session"}\n');
    await writeFile(join(root, 'missing-owner.jsonl'), '{"type":"session","id":"unowned"}\n');
    await writeFile(join(root, 'oversized.jsonl'), ' '.repeat(65536));
    await writeFile(join(root, 'ignored.txt'), '{"type":"session","id":"ignored"}\n');
    await symlink(foreign, join(root, 'foreign-alias.jsonl'));
    await symlink(own, join(root, 'own-alias.jsonl'));
    const history = await workspaceHistory(root, root);
    expect(history.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { id: 'own', path: join(root, 'own-alias.jsonl'), name: '名前 🙂' },
      { id: 'own', path: own, name: '名前 🙂' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

test('uses assistant and user activity instead of tool timestamps for ordering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-history-activity-'));
  try {
    for (const [id, timestamp] of [
      ['first', 20],
      ['second', 10],
    ]) {
      await writeFile(
        join(root, `${id}.jsonl`),
        `${JSON.stringify({ type: 'session', id, cwd: root, timestamp: '2026-01-01T00:00:00Z' })}\n${JSON.stringify({ type: 'message', timestamp: '2027-01-01T00:00:00Z', message: { role: 'assistant', content: [], timestamp } })}\n${JSON.stringify({ type: 'message', timestamp: '2029-01-01T00:00:00Z', message: { role: 'toolResult', content: [], timestamp: 999 } })}\n`,
      );
    }
    expect((await workspaceHistory(root, root)).map(({ id }) => id)).toEqual(['first', 'second']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
