import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { link, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/**
 * Regressions for the seventeenth adversarial pass, wave B: `rsync` and `ditto` sources never reached
 * the copy walk, and the walk skipped symlinks and hardlinks inside a copied tree.
 */

const copySourcesOf = (command: string, root = '/ws'): readonly string[] => analyzeShellCommand(command, '/home/tester', root).copySources;

function hasCommand(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasRsync = hasCommand('rsync');
const hasDitto = hasCommand('ditto');

describe('finding 1: rsync and ditto sources reach the copy walk', () => {
  it('names every rsync source but the last and the ditto source, and skips remote and no-op forms', () => {
    expect(copySourcesOf('rsync -a secrets copied')).toEqual(['/ws/secrets']);
    expect(copySourcesOf('rsync -a a.txt b.txt dest/')).toEqual(['/ws/a.txt', '/ws/b.txt']);
    expect(copySourcesOf('rsync -a host:secrets copied')).toEqual([]);
    expect(copySourcesOf('rsync -a root@host:/srv/secrets copied')).toEqual([]);
    expect(copySourcesOf('rsync://host/module/secrets copied')).toEqual([]);
    expect(copySourcesOf('rsync -a --list-only secrets dest/')).toEqual([]);
    expect(copySourcesOf('rsync -a ./a:b.txt copied')).toEqual(['/ws/a:b.txt']);

    expect(copySourcesOf('ditto secrets copied')).toEqual(['/ws/secrets']);
    expect(copySourcesOf('ditto -c -k payload pkg.zip')).toEqual(['/ws/payload']);
    expect(copySourcesOf('ditto -x -k evil.zip .')).toEqual([]);
    expect(copySourcesOf('ditto notes.txt')).toEqual([]);
  });

  it.skipIf(!hasRsync)('refuses rsync -a of a directory that holds a denied file', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/src/.env' }] } });
    try {
      await h.write('src/.env', 'SECRET_BYTES_17\n');
      const copied = await h.call('bash', { command: 'rsync -a src/ dest/' });
      expect(copied.isError).toBe(true);
      expect(textOf(copied)).toContain('the copy includes src/.env, which a rule denies');
      expect(existsSync(h.file('dest/.env'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  it.skipIf(!hasDitto)('refuses ditto of a directory that holds a denied file', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/src/.env' }] } });
    try {
      await h.write('src/.env', 'SECRET_BYTES_17\n');
      const copied = await h.call('bash', { command: 'ditto src dest' });
      expect(copied.isError).toBe(true);
      expect(textOf(copied)).toContain('the copy includes src/.env, which a rule denies');
      expect(existsSync(h.file('dest/.env'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  it('still copies an ordinary rsync and ditto directory', async () => {
    const h = await createHarness({ config: { mode: 'auto', rules: [] } });
    try {
      await h.write('docs/readme.md', 'plain\n');
      await h.write('docs/deep/note.txt', 'deep\n');
      if (hasRsync) {
        const rsync = await h.call('bash', { command: 'rsync -a docs/ rsync-copy/' });
        expect(rsync.isError).toBeUndefined();
        expect(existsSync(h.file('rsync-copy/deep/note.txt'))).toBe(true);
      }
      if (hasDitto) {
        const ditto = await h.call('bash', { command: 'ditto docs ditto-copy' });
        expect(ditto.isError).toBeUndefined();
        expect(existsSync(h.file('ditto-copy/deep/note.txt'))).toBe(true);
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: a symlink inside a copied tree is judged by its target', () => {
  it('refuses cp -RL, rsync -aL, and ditto when the link reaches a denied file', async () => {
    const commands = ['cp -RL src dest', ...(hasRsync ? ['rsync -aL src/ dest/'] : []), ...(hasDitto ? ['ditto src dest'] : [])];
    for (const command of commands) {
      const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
      try {
        await h.write('.env', 'SECRET_BYTES_17\n');
        await mkdir(h.file('src'), { recursive: true });
        await symlink(h.file('.env'), h.file('src/link'));
        const copied = await h.call('bash', { command });
        expect(copied.isError, command).toBe(true);
        expect(textOf(copied), command).toContain('src/link (a symlink to .env), which a rule denies');
        expect(existsSync(h.file('dest/link')), command).toBe(false);
        expect(existsSync(h.file('dest')), command).toBe(false);
      } finally {
        await h.cleanup();
      }
    }
  });

  it('refuses a symlink that resolves outside the workspace', async () => {
    const h = await createHarness({ config: { mode: 'auto', rules: [] } });
    try {
      await mkdir(h.file('src'), { recursive: true });
      await writeFile(path.join(h.root, 'outside.txt'), 'OUTSIDE\n', 'utf-8');
      await symlink(path.join(h.root, 'outside.txt'), h.file('src/link'));
      const copied = await h.call('bash', { command: 'cp -R src dest' });
      expect(copied.isError).toBe(true);
      expect(textOf(copied)).toContain('which reaches outside the workspace');
      expect(existsSync(h.file('dest'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  it('walks the directory a symlink reaches and refuses a denied file inside it', async () => {
    const h = await createHarness({ config: { mode: 'auto', rules: [{ kind: 'read', action: 'deny', pattern: '**/secret.txt' }] } });
    try {
      await h.write('hidden/secret.txt', 'TOP_SECRET\n');
      await mkdir(h.file('src'), { recursive: true });
      await symlink(h.file('hidden'), h.file('src/tree'));
      const copied = await h.call('bash', { command: 'cp -R src dest' });
      expect(copied.isError).toBe(true);
      expect(textOf(copied)).toContain('hidden/secret.txt');
      expect(existsSync(h.file('dest'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  it('keeps a link to an allowed file and terminates on a link loop', async () => {
    const h = await createHarness({ config: { mode: 'auto', rules: [] } });
    try {
      await h.write('notes.txt', 'hello\n');
      await mkdir(h.file('src'), { recursive: true });
      await symlink(h.file('notes.txt'), h.file('src/link.txt'));
      await symlink(h.file('src'), h.file('src/self'));

      const copied = await h.call('bash', { command: 'cp -R src dest' });
      expect(copied.isError).toBeUndefined();
      const read = await h.call('read', { path: 'dest/link.txt' });
      expect(read.isError).toBeUndefined();
      expect(textOf(read)).toContain('hello');

      const again = await h.call('bash', { command: 'cp -R src dest2' });
      expect(again.isError).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: a hardlinked file inside a copied tree is refused', () => {
  it('refuses cp -R and rsync -a of a tree with a second link to a denied file', async () => {
    const commands = ['cp -R src dest', ...(hasRsync ? ['rsync -a src/ dest/'] : [])];
    for (const command of commands) {
      const h = await createHarness({ config: { mode: 'auto', rules: [] } });
      try {
        await h.write('.env', 'SECRET_BYTES_17\n');
        await mkdir(h.file('src'), { recursive: true });
        await link(h.file('.env'), h.file('src/alias'));
        const copied = await h.call('bash', { command });
        expect(copied.isError, command).toBe(true);
        expect(textOf(copied), command).toContain('the copy includes src/alias, and it has 2 hard links');
        expect(existsSync(h.file('dest/alias')), command).toBe(false);
        expect(existsSync(h.file('dest')), command).toBe(false);
      } finally {
        await h.cleanup();
      }
    }
  });

  it('copies a tree whose files each have one link', async () => {
    const h = await createHarness({ config: { mode: 'auto', rules: [] } });
    try {
      await h.write('src/one.txt', 'one\n');
      await h.write('src/two.txt', 'two\n');
      const copied = await h.call('bash', { command: 'cp -R src dest' });
      expect(copied.isError).toBeUndefined();
      expect(existsSync(h.file('dest/one.txt'))).toBe(true);
      expect(existsSync(h.file('dest/two.txt'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});
