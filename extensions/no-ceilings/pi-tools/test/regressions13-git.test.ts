import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the thirteenth adversarial pass, wave A2. Each test names the finding it locks down. */

const untrustedOf = (command: string, root: string = process.cwd()): string | undefined => analyzeShellCommand(command, '/home/tester', root).untrusted;

const DIFF_REASON = 'the commit diff prints the body of every file it touches';
const CAT_FILE_REASON = 'the command prints git objects it picks by id or in bulk';
const FAST_EXPORT_REASON = 'the export streams the body of every file in the history';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf-8' });

/** A repository whose read-denied file is gone from the working tree, so only history holds its body. */
async function historyOnly(): Promise<Awaited<ReturnType<typeof createHarness>>> {
  const h = await createHarness({
    hasUI: false,
    confirm: false,
    config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] },
  });
  await h.write('.env', 'TOPSECRET=1\n');
  await h.write('keep.txt', 'keep\n');
  await h.write('sub/notes.md', 'notes\n');
  git(h.workspace, 'init', '-q');
  git(h.workspace, 'config', 'user.email', 'a@b.c');
  git(h.workspace, 'config', 'user.name', 'a');
  git(h.workspace, 'add', '-f', '-A');
  git(h.workspace, 'commit', '-qm', 'init');
  await h.call('bash', { command: 'git rm -q .env && git -c user.email=a@b.c -c user.name=a commit -qm drop' });
  return h;
}

describe('finding 1: a directory pathspec does not narrow a commit diff', () => {
  it('treats a directory, a trailing slash, a glob, and an exclusion pathspec as no narrowing at all', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await h.write('sub/notes.md', 'notes\n');
      for (const command of ['git log -p -- sub', 'git log -p -- ./sub', 'git show HEAD -- sub']) {
        expect(untrustedOf(command, h.workspace), command).toContain(DIFF_REASON);
      }
    } finally {
      await h.cleanup();
    }

    // None of these needs the filesystem to prove the diff still reaches files the argv never spells out.
    for (const command of ['git log -p -- .', 'git show HEAD -- .', 'git show HEAD -- ./', 'git log -p -- sub/', 'git log -p -- "*.txt"', 'git log -p -- :!keep.txt', "git show HEAD -- ':(exclude)keep.txt'"]) {
      expect(untrustedOf(command), command).toContain(DIFF_REASON);
    }

    // A file pathspec, an explicit path, and a `rev:path` still narrow the output.
    for (const command of ['git log -p -- keep.txt', 'git show HEAD -- keep.txt', 'git show ./.keep', 'git show HEAD:keep.txt', 'git log --stat -- .']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('refuses the whole-diff spellings and prints no denied body', async () => {
    const h = await historyOnly();
    try {
      for (const command of ['git log -p -- .', 'git show HEAD -- .', 'git log -p -- sub', 'git log -p -- "*.txt"', 'git -C . log -p -- .']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain(DIFF_REASON);
        expect(textOf(result), command).not.toContain('TOPSECRET');
      }
      const fromTool = await h.call('git', { subcommand: 'log', args: ['-p', '--', '.'] });
      expect(fromTool.isError).toBe(true);
      expect(textOf(fromTool)).toContain(DIFF_REASON);
      expect(textOf(fromTool)).not.toContain('TOPSECRET');

      const narrowed = await h.call('bash', { command: 'git log -p -- keep.txt' });
      expect(narrowed.isError).toBeUndefined();
      expect(textOf(narrowed)).toContain('keep');
      const shown = await h.call('bash', { command: 'git show HEAD -- sub/notes.md' });
      expect(shown.isError).toBeUndefined();
      expect(textOf(shown)).toContain('notes');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: git cat-file prints a raw object by id or in bulk', () => {
  it('refuses every --batch form and any operand that looks like an object id', () => {
    const sha = '9e8a5de827b5f1731560f663232b75c90b1be70e';
    for (const command of [
      'git cat-file --batch-all-objects --batch',
      'git cat-file --batch',
      'git cat-file --batch --buffer',
      'git cat-file --batch=%(objectname)',
      'git cat-file --batch-check',
      'git cat-file --batch-command',
      `git cat-file -p ${sha}`,
      `git cat-file blob ${sha}`,
      'git cat-file -p 9e8a',
      'git cat-file -p 9E8A5DE^{tree}',
      'git cat-file -t "$SHA"',
    ]) {
      expect(untrustedOf(command), command).toContain(CAT_FILE_REASON);
    }

    // A revision, a `rev:path`, and a named file keep working.
    for (const command of ['git cat-file -p HEAD:keep.txt', 'git cat-file -p HEAD', 'git cat-file -t HEAD', 'git cat-file -s HEAD:keep.txt', 'git cat-file -e HEAD:keep.txt']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('refuses the id that ls-tree prints and the bulk dump, from bash and from the git tool', async () => {
    const h = await historyOnly();
    try {
      const tree = await h.call('bash', { command: 'git ls-tree -r HEAD' });
      expect(tree.isError).toBeUndefined();
      const sha = textOf(tree)
        .split('\n')
        .find((line) => line.includes('.env'))
        ?.trim()
        .split(/\s+/)[2];
      expect(sha).toBeDefined();

      const byId = await h.call('bash', { command: `git cat-file -p ${sha ?? ''}` });
      expect(byId.isError).toBe(true);
      expect(textOf(byId)).toContain(CAT_FILE_REASON);
      expect(textOf(byId)).not.toContain('TOPSECRET');

      for (const command of ['git cat-file --batch-all-objects --batch', 'git ls-tree -r HEAD | git cat-file --batch']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).not.toContain('TOPSECRET');
      }

      const fromTool = await h.call('git', { subcommand: 'cat-file', args: ['--batch-all-objects', '--batch'] });
      expect(fromTool.isError).toBe(true);
      expect(textOf(fromTool)).toContain(CAT_FILE_REASON);
      expect(textOf(fromTool)).not.toContain('TOPSECRET');

      // The `rev:path` deny keeps its own message, and the plain file form still prints.
      const revPath = await h.call('git', { subcommand: 'cat-file', args: ['-p', 'HEAD:.env'] });
      expect(revPath.isError).toBe(true);
      expect(textOf(revPath)).toContain('rule: **/.env');
      const named = await h.call('bash', { command: 'git cat-file -p HEAD:keep.txt' });
      expect(named.isError).toBeUndefined();
      expect(textOf(named)).toContain('keep');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: git fast-export streams every blob body', () => {
  it('refuses fast-export in every form', () => {
    for (const command of ['git fast-export HEAD', 'git fast-export --all', 'git fast-export --no-data HEAD', 'git -C sub fast-export HEAD', 'git fast-export 9e8a']) {
      expect(untrustedOf(command), command).toContain(FAST_EXPORT_REASON);
    }
  });

  it('prints no denied body from bash or from the git tool', async () => {
    const h = await historyOnly();
    try {
      for (const command of ['git fast-export HEAD', 'git fast-export --all']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain(FAST_EXPORT_REASON);
        expect(textOf(result), command).not.toContain('TOPSECRET');
      }
      const fromTool = await h.call('git', { subcommand: 'fast-export', args: ['HEAD'] });
      expect(fromTool.isError).toBe(true);
      expect(textOf(fromTool)).toContain(FAST_EXPORT_REASON);
      expect(textOf(fromTool)).not.toContain('TOPSECRET');
    } finally {
      await h.cleanup();
    }
  });
});
