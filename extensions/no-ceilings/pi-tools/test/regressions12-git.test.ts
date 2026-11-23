import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the twelfth adversarial pass, wave A2. Each test names the finding it locks down. */

const untrustedOf = (command: string): string | undefined => analyzeShellCommand(command, '/home/tester').untrusted;

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf-8' });

/** A repository with a committed read-denied file, a committed ignored file, and a plain file. */
async function repository(): Promise<Awaited<ReturnType<typeof createHarness>>> {
  const h = await createHarness({
    hasUI: false,
    confirm: false,
    config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] },
  });
  await h.write('.env', 'TOPSECRET=1\n');
  await h.write('.piignore', 'ignored.txt\n');
  await h.write('ignored.txt', 'IGNORED-SECRET\n');
  await h.write('keep.txt', 'keep\n');
  git(h.workspace, 'init', '-q');
  git(h.workspace, 'config', 'user.email', 'a@b.c');
  git(h.workspace, 'config', 'user.name', 'a');
  git(h.workspace, 'add', '-f', '.env', 'ignored.txt', 'keep.txt');
  git(h.workspace, 'commit', '-qm', 'init');
  return h;
}

describe('finding 5: git grep walks the files git chooses', () => {
  it('refuses git grep in every form and returns neither a denied nor an ignored file body', async () => {
    for (const command of ['git grep --no-index TOPSECRET', 'git grep --no-index IGNORED', 'git grep IGNORED', 'git grep -n TOPSECRET', 'git grep --cached TOPSECRET', 'git -C . grep TOPSECRET', 'git diff | git grep TOPSECRET']) {
      expect(untrustedOf(command), command).toContain('git grep walks the files git chooses');
    }
    expect(untrustedOf('git status')).toBeUndefined();

    const h = await repository();
    try {
      for (const command of ['git grep --no-index TOPSECRET', 'git grep --no-index IGNORED', 'git grep IGNORED']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('git grep walks the files git chooses');
        expect(textOf(result), command).not.toContain('TOPSECRET');
        expect(textOf(result), command).not.toContain('IGNORED-SECRET');
      }
      const fromTool = await h.call('git', { subcommand: 'grep', args: ['--no-index', 'TOPSECRET'] });
      expect(fromTool.isError).toBe(true);
      expect(textOf(fromTool)).toContain('git grep walks the files git chooses');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: a revision path opens a file the analyzer never named', () => {
  it('checks the path half of <rev>:<path> as a read, including the repo-root form', async () => {
    for (const command of ['git show HEAD:.env', 'git cat-file -p HEAD:.env', 'git show HEAD~1:.env', 'git show :/.env']) {
      expect(analyzeShellCommand(command, '/home/tester').paths, command).toContainEqual({ path: '.env', write: false });
    }
    // The index pathspec forms keep their existing handling.
    expect(analyzeShellCommand('git show :.env', '/home/tester').paths).toContainEqual({ path: '.env', write: false });
    expect(analyzeShellCommand('git show :0:.env', '/home/tester').paths).toContainEqual({ path: '.env', write: false });

    const h = await repository();
    try {
      for (const command of ['git show HEAD:.env', 'git cat-file -p HEAD:.env', 'git show HEAD~1:.env', 'git show :/.env']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('rule: **/.env');
        expect(textOf(result), command).not.toContain('TOPSECRET');
      }
      const ignored = await h.call('bash', { command: 'git show HEAD:ignored.txt' });
      expect(ignored.isError).toBe(true);
      expect(textOf(ignored)).toContain('.piignore');
      expect(textOf(ignored)).not.toContain('IGNORED-SECRET');

      const shown = await h.call('bash', { command: 'git show HEAD:keep.txt' });
      expect(shown.isError).toBeUndefined();
      expect(textOf(shown)).toContain('keep');

      for (const subcommand of [
        { subcommand: 'show', args: ['HEAD:.env'] },
        { subcommand: 'cat-file', args: ['-p', 'HEAD:.env'] },
      ]) {
        const fromTool = await h.call('git', subcommand);
        expect(fromTool.isError, JSON.stringify(subcommand)).toBe(true);
        expect(textOf(fromTool), JSON.stringify(subcommand)).toContain('rule: **/.env');
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: git log and git show print whole file bodies', () => {
  it('refuses a patch-graph log without a path and a show without a path or a summary flag', async () => {
    const logRefusals = ['git log -p', 'git log --patch', 'git log -u', 'git log --full-diff --all', 'git log --oneline -p', 'git log -p --all'];
    for (const command of logRefusals) {
      expect(untrustedOf(command), command).toContain('the commit diff prints the body of every file it touches');
    }
    for (const command of ['git show', 'git show HEAD', 'git show HEAD~1']) {
      expect(untrustedOf(command), command).toContain('the commit diff prints the body of every file it touches');
    }

    // A path operand narrows the log, and a path operand or a summary flag narrows the show.
    for (const command of [
      'git log -p -- .',
      'git log -p -- src/file.ts',
      'git log --patch -- keep.txt',
      'git log -n 5',
      'git show HEAD -- keep.txt',
      'git show HEAD:keep.txt',
      'git show ./.keep',
      'git show --stat HEAD',
      'git show --name-only HEAD',
      'git show --name-status HEAD',
      'git show --numstat HEAD',
      'git show --shortstat HEAD',
      'git show --summary HEAD',
    ]) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
    for (const command of ['git log', 'git log --oneline', 'git log -1', 'git diff', 'git diff -- .env']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }

    const h = await repository();
    try {
      for (const command of ['git log -p --all', 'git log --patch --all', 'git log -u --all']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('the commit diff prints the body of every file it touches');
        expect(textOf(result), command).not.toContain('TOPSECRET');
      }
      const shown = await h.call('bash', { command: 'git show HEAD' });
      expect(shown.isError).toBe(true);
      expect(textOf(shown)).not.toContain('TOPSECRET');

      const narrowed = await h.call('bash', { command: 'git log -p -- keep.txt' });
      expect(narrowed.isError).toBeUndefined();
      expect(textOf(narrowed)).toContain('keep');
      const stat = await h.call('bash', { command: 'git show --stat HEAD' });
      expect(stat.isError).toBeUndefined();

      const fromTool = await h.call('git', { subcommand: 'log', args: ['-p', '--all'] });
      expect(fromTool.isError).toBe(true);
      expect(textOf(fromTool)).toContain('the commit diff prints the body of every file it touches');
      expect(textOf(fromTool)).not.toContain('TOPSECRET');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 8: git init --template installs hooks the layer never sees', () => {
  it('refuses every template spelling and leaves no hook behind', async () => {
    for (const command of ['git init --template tpl .', 'git init --template=tpl .', 'git init -q --template tpl .']) {
      expect(untrustedOf(command), command).toContain('a template installs hooks the analyzer does not read');
    }
    expect(untrustedOf('git init -q .')).toBeUndefined();
    expect(untrustedOf('git init --shared .')).toBeUndefined();

    const h = await createHarness({ hasUI: false, confirm: false, config: { rules: [] } });
    try {
      await h.write('a.txt', 'hi\n');
      await h.write('tpl/hooks/post-checkout', '#!/bin/sh\necho HOOK-RAN > hook-proof.txt\n');
      expect((await h.call('bash', { command: 'git init -q .' })).isError).toBeUndefined();
      for (const command of ['git init --template=tpl .', 'git init --template tpl .']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('a template installs hooks the analyzer does not read');
      }
      expect(existsSync(path.join(h.workspace, '.git/hooks/post-checkout'))).toBe(false);
      expect((await h.call('bash', { command: 'git checkout -q -b feature' })).isError).toBeUndefined();
      expect(existsSync(path.join(h.workspace, 'hook-proof.txt'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 9: a trailing read flag does not make git config a read', () => {
  it('refuses a config call with a key and a value even when a read flag is present', async () => {
    for (const command of [
      "git config alias.pwn '!echo PROOF' --get",
      "git config alias.pwn '!echo PROOF' --get-all",
      "git config alias.pwn '!echo PROOF' -l",
      'git config user.name Ada --get',
      'git config --get user.name Ada',
      'git config --add alias.pwn value',
    ]) {
      expect(untrustedOf(command), command).toContain('git config writes a value the analyzer does not follow');
    }
    for (const command of ['git config --get user.name', 'git config --get-regexp user', 'git config --list', 'git config user.name', 'git config --show-origin user.name']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }

    const h = await createHarness({ hasUI: false, confirm: false, config: { rules: [] } });
    try {
      await h.write('a.txt', 'hi\n');
      git(h.workspace, 'init', '-q');
      const written = await h.call('bash', { command: "git config alias.pwn '!echo PROOF > alias-proof.txt' --get" });
      expect(written.isError).toBe(true);
      const alias = await h.call('bash', { command: 'git config --get alias.pwn' });
      expect(textOf(alias)).not.toContain('PROOF');
      const ran = await h.call('git', { subcommand: 'pwn' });
      expect(ran.isError).toBe(true);
      expect(existsSync(path.join(h.workspace, 'alias-proof.txt'))).toBe(false);
      expect(readFileSync(path.join(h.workspace, 'a.txt'), 'utf8')).toBe('hi\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('lead review: a transport colon is not a revision path', () => {
  it('does not turn an https URL or an scp remote into a local path', () => {
    const clone = analyzeShellCommand('git clone https://example.com', '/home/tester');
    expect(clone.paths).toEqual([{ path: 'https://example.com', write: false }]);
    expect(clone.untrusted).toBeUndefined();

    const scp = analyzeShellCommand('git clone git@github.com:user/repo.git', '/home/tester');
    expect(scp.paths).toEqual([{ path: 'git@github.com:user/repo.git', write: false }]);

    const remote = analyzeShellCommand('git remote add origin https://example.com/x.git', '/home/tester');
    expect(remote.paths.some((entry) => entry.path === '//example.com/x.git')).toBe(false);
  });
});
