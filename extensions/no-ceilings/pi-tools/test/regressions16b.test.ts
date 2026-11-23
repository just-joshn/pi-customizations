import { existsSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { COPY_WALK_LIMIT } from '../src/core/session.ts';
import { createHarness, textOf } from './harness.ts';

/**
 * Regressions for the sixteenth adversarial pass, wave B: a directory copy or move created new paths
 * that no rule named, so the rules never saw the files inside the tree.
 */

const copySourcesOf = (command: string, root = '/ws'): readonly string[] => analyzeShellCommand(command, '/home/tester', root).copySources;

/** Write `count` empty files into an existing directory, a batch at a time. */
async function writeMany(directory: string, count: number): Promise<void> {
  const batch = 200;
  for (let start = 0; start < count; start += batch) {
    const writes: Promise<void>[] = [];
    for (let index = start; index < Math.min(start + batch, count); index += 1) {
      writes.push(writeFile(path.join(directory, `f${index}.txt`), ''));
    }
    await Promise.all(writes);
  }
}

describe('copySources: the analyzer names every cp and mv source as an absolute path', () => {
  it('reports all but the last operand, and every operand when the target is a flag', () => {
    expect(copySourcesOf('cp -r secrets copied')).toEqual(['/ws/secrets']);
    expect(copySourcesOf('mv secrets moved')).toEqual(['/ws/secrets']);
    expect(copySourcesOf('cp a.txt b.txt c.txt')).toEqual(['/ws/a.txt', '/ws/b.txt']);
    expect(copySourcesOf(`cp -t /ws/out a b`)).toEqual(['/ws/a', '/ws/b']);
    expect(copySourcesOf('cp --target-directory=out a b')).toEqual(['/ws/a', '/ws/b']);
    expect(copySourcesOf(`cp -t /ws/out -- a`)).toEqual(['/ws/a']);
    expect(copySourcesOf(`cp ~/notes copied`)).toEqual(['/home/tester/notes']);

    expect(copySourcesOf('touch a.txt')).toEqual([]);
    expect(copySourcesOf('rsync -a secrets copied')).toEqual(['/ws/secrets']);
  });
});

describe('finding 5a: mv of a directory the policy denies is refused', () => {
  it('names the denied file and leaves the tree where it was', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: 'secrets/*' }] } });
    try {
      await h.write('secrets/token.txt', 'TOP_SECRET\n');

      const moved = await h.call('bash', { command: 'mv secrets moved' });
      expect(moved.isError).toBe(true);
      expect(textOf(moved)).toContain('the copy includes secrets/token.txt, which a rule denies');
      expect(existsSync(h.file('secrets/token.txt'))).toBe(true);
      expect(existsSync(h.file('moved'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5b: cp -r of a directory the policy denies is refused', () => {
  it('names the denied file and creates no copy', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/token.txt' }] } });
    try {
      await h.write('secrets/token.txt', 'TOP_SECRET\n');
      await h.write('secrets/notes.txt', 'plain\n');

      const copied = await h.call('bash', { command: 'cp -r secrets copied' });
      expect(copied.isError).toBe(true);
      expect(textOf(copied)).toContain('the copy includes secrets/token.txt, which a rule denies');
      expect(existsSync(h.file('copied'))).toBe(false);

      // The same tree reached through a nested directory is judged at any depth.
      const nested = await h.call('bash', { command: 'cp -r . bundle' });
      expect(nested.isError).toBe(true);
      expect(textOf(nested)).toContain('secrets/token.txt');
      expect(existsSync(h.file('bundle'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5c: a directory holding ignored content is refused', () => {
  it('names the ignored file and creates no copy', async () => {
    const h = await createHarness({ config: { mode: 'auto', rules: [] } });
    try {
      await h.write('.gitignore', 'secret.log\n');
      await h.write('docs/readme.md', 'plain\n');
      await h.write('docs/deep/secret.log', 'hidden\n');

      const copied = await h.call('bash', { command: 'cp -r docs copied' });
      expect(copied.isError).toBe(true);
      expect(textOf(copied)).toContain('the copy includes docs/deep/secret.log, which .gitignore filters out');
      expect(existsSync(h.file('copied'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5d: a plain directory copy and move still work', () => {
  it('copies and moves a tree with no denied or ignored file', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: 'secrets/*' }] } });
    try {
      await h.write('secrets/token.txt', 'TOP_SECRET\n');
      await h.write('docs/readme.md', 'plain\n');
      await h.write('docs/deep/note.txt', 'deep\n');
      await h.write('assets/.keep', '');

      const copied = await h.call('bash', { command: 'cp -r docs copied' });
      expect(copied.isError).toBeUndefined();
      expect(existsSync(h.file('copied/deep/note.txt'))).toBe(true);

      const moved = await h.call('bash', { command: 'mv copied moved' });
      expect(moved.isError).toBeUndefined();
      expect(existsSync(h.file('copied'))).toBe(false);

      const read = await h.call('read', { path: 'moved/deep/note.txt' });
      expect(read.isError).toBeUndefined();
      expect(textOf(read)).toContain('deep');

      // A symlink to a denied file is refused, because `cp -RL`, `ditto`, and `rsync -L` copy the
      // bytes behind it. A link to an allowed file still copies.
      await symlink(path.join(h.workspace, 'secrets/token.txt'), h.file('docs/link.txt'));
      const linked = await h.call('bash', { command: 'cp -r docs linked-copy' });
      expect(linked.isError).toBe(true);
      expect(textOf(linked)).toContain('docs/link.txt (a symlink to secrets/token.txt), which a rule denies');
      expect(existsSync(h.file('linked-copy'))).toBe(false);

      const empty = await h.call('bash', { command: 'cp -r assets assets-copy' });
      expect(empty.isError).toBeUndefined();
      expect(existsSync(h.file('assets-copy/.keep'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5e: a tree past the walk cap is refused unseen', () => {
  it('refuses the copy instead of walking it partially', async () => {
    const h = await createHarness({ config: { mode: 'auto', rules: [] } });
    try {
      const big = h.file('big');
      await mkdir(big, { recursive: true });
      await writeMany(big, COPY_WALK_LIMIT + 1);

      const copied = await h.call('bash', { command: 'cp -r big copied' });
      expect(copied.isError).toBe(true);
      expect(textOf(copied)).toContain(`the copy holds more than ${COPY_WALK_LIMIT} entries`);
      expect(existsSync(h.file('copied'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  }, 60_000);
});
