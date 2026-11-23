import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand, GIT_ENV_NAMES } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the fourteenth adversarial pass, wave A2. Each test names the finding it locks down. */

const untrustedOf = (command: string): string | undefined => analyzeShellCommand(command, '/home/tester').untrusted;
const pathsOf = (command: string): readonly { readonly path: string; readonly write: boolean }[] => analyzeShellCommand(command, '/home/tester').paths;
const writesOf = (command: string): string[] =>
  pathsOf(command)
    .filter((entry) => entry.write)
    .map((entry) => entry.path);

const RESET_REASON = 'the reset mode rewrites every tracked file the argv does not name';
const GIT_ENV_REASON = 'points git at a repository, index, editor, or helper the analyzer does not follow';

const POLICY_REFUSAL = 'is the project policy file and cannot be changed by the agent';
const IGNORE_REFUSAL = 'is protected and cannot be changed by the agent';

function hasBinary(name: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function initRepo(cwd: string): Promise<void> {
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd });
  };
  git('init', '-q', '.');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'a');
}

describe('finding 1: git checkout, restore, and reset rewrite files the argv does not name', () => {
  it('records checkout and restore path operands as writes and refuses a reset that rewrites every file', () => {
    for (const command of ['git checkout -- .piignore', 'git checkout HEAD -- a.txt b.txt', 'git restore .piignore', 'git restore --source=HEAD -- a.txt', 'git restore --staged a.txt']) {
      expect(writesOf(command), command).toContainEqual(command.includes('a.txt') ? 'a.txt' : '.piignore');
    }
    // The option values are branch names, sources, and conflict styles, never destinations.
    expect(writesOf('git checkout -b feature')).toEqual([]);
    expect(writesOf('git checkout main')).toEqual(['main']);
    expect(writesOf('git checkout --conflict=merge a.txt')).toEqual(['a.txt']);
    expect(writesOf('git restore --source HEAD a.txt')).toEqual(['a.txt']);

    for (const command of ['git reset --hard HEAD', 'git reset --hard', 'git reset -q --hard HEAD', 'git reset --har HEAD', 'git reset --keep HEAD~1', 'git reset --merge', 'git reset --merge=HEAD']) {
      expect(untrustedOf(command), command).toContain(RESET_REASON);
    }
    // A soft or mixed reset only moves HEAD and the index, which no file body changes.
    for (const command of ['git reset', 'git reset HEAD', 'git reset --soft HEAD~1', 'git reset --mixed', 'git reset -q a.txt', 'git bisect reset']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('refuses the checkout, restore, and reset that rewrite a protected or denied file', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { rules: [{ kind: 'write', action: 'deny', pattern: '**/secret.txt' }] } });
    try {
      const policy = h.file('.pi/pi-tools.json');
      const committedPolicy = JSON.stringify({ mode: 'unrestricted', rules: [] }, null, 2);
      const livePolicy = JSON.stringify({ mode: 'auto', rules: [{ kind: 'write', action: 'deny', pattern: '**/secret.txt' }] }, null, 2);
      await writeFile(policy, committedPolicy, 'utf-8');
      await writeFile(h.file('.piignore'), 'secret*\n', 'utf-8');
      await writeFile(h.file('a.txt'), 'x\n', 'utf-8');
      await initRepo(h.workspace);
      execFileSync('git', ['add', '-A'], { cwd: h.workspace });
      const commit = (...args: string[]): void => {
        execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', ...args], { cwd: h.workspace });
      };
      commit('commit', '-qm', 'initial');
      await writeFile(policy, livePolicy, 'utf-8');
      await writeFile(h.file('.piignore'), '# operator tightened the filter\n', 'utf-8');
      await writeFile(h.file('secret.txt'), 'SECRET-CHANGED\n', 'utf-8');

      const checkoutPolicy = await h.call('bash', { command: 'git checkout -- .pi/pi-tools.json' });
      expect(checkoutPolicy.isError).toBe(true);
      expect(textOf(checkoutPolicy)).toContain(POLICY_REFUSAL);
      expect(await readFile(policy, 'utf-8')).toBe(livePolicy);

      const restoreIgnore = await h.call('bash', { command: 'git restore .piignore' });
      expect(restoreIgnore.isError).toBe(true);
      expect(textOf(restoreIgnore)).toContain(IGNORE_REFUSAL);
      expect(await readFile(h.file('.piignore'), 'utf-8')).toBe('# operator tightened the filter\n');

      const reset = await h.call('bash', { command: 'git reset --hard HEAD' });
      expect(reset.isError).toBe(true);
      expect(textOf(reset)).toContain(RESET_REASON);
      expect(await readFile(h.file('secret.txt'), 'utf-8')).toBe('SECRET-CHANGED\n');

      const outside = path.join(h.root, 'outside.txt');
      await writeFile(outside, 'outside\n', 'utf-8');
      const escape = await h.call('bash', { command: `git restore ${outside}` });
      expect(escape.isError).toBe(true);
      expect(textOf(escape)).toContain('outside the workspace');

      const toolRestore = await h.call('git', { subcommand: 'restore', args: ['.piignore'] });
      expect(toolRestore.isError).toBe(true);
      expect(textOf(toolRestore)).toContain(IGNORE_REFUSAL);

      // A branch checkout, a new branch, a staged restore, and a soft reset keep working.
      expect((await h.call('bash', { command: 'git checkout -q -b feature' })).isError).toBeUndefined();
      expect((await h.call('bash', { command: 'git checkout -q main' })).isError).toBeUndefined();
      expect((await h.call('bash', { command: 'git restore --staged a.txt' })).isError).toBeUndefined();
      expect((await h.call('bash', { command: 'git reset -q --soft HEAD' })).isError).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: git environment variables escape the analyzer', () => {
  it('refuses every listed variable as an inline, env, or export assignment and in the env parameter', async () => {
    for (const name of GIT_ENV_NAMES) {
      for (const command of [`${name}=/tmp/x git init`, `env ${name}=/tmp/x git init`, `bash -c '${name}=/tmp/x git init'`, `export ${name}=/tmp/x`, `printf -v ${name} value`]) {
        const reason = untrustedOf(command);
        expect(reason, command).toContain(name);
        expect(reason, command).toContain(GIT_ENV_REASON);
      }
    }
    // A name that only shares the prefix, and an ordinary variable, stay allowed.
    expect(untrustedOf('GIT_TERMINAL_PROMPT=0 git fetch')).toBeUndefined();
    expect(untrustedOf('GIT_AUTHOR_NAME=Ada git commit --allow-empty -m x')).toBeUndefined();
    expect(untrustedOf('FOO=1 git status')).toBeUndefined();

    const h = await createHarness({ hasUI: false, confirm: false });
    const previous = process.env['GIT_DIR'];
    try {
      await h.write('.env', 'SECRET=supersecret\n');
      await h.write('a.txt', 'x\n');
      const outside = path.join(h.root, 'gitdir');
      await mkdir(outside, { recursive: true });

      const inline = await h.call('bash', { command: `GIT_DIR=${outside} git init` });
      expect(inline.isError).toBe(true);
      expect(textOf(inline)).toContain('GIT_DIR');
      expect(existsSync(path.join(outside, 'HEAD'))).toBe(false);

      const editor = await h.call('bash', { command: 'GIT_EDITOR=\'sh -c "cat .env >&2"\' git commit --allow-empty' });
      expect(editor.isError).toBe(true);
      expect(textOf(editor)).toContain('GIT_EDITOR');
      expect(textOf(editor)).not.toContain('supersecret');

      const override = await h.call('bash', { command: 'git init', env: { GIT_WORK_TREE: outside } });
      expect(override.isError).toBe(true);
      expect(textOf(override)).toContain('GIT_WORK_TREE');

      // The spawned shell inherits none of them, so the command that runs is the one analyzed.
      await initRepo(h.workspace);
      process.env['GIT_DIR'] = path.join(outside, '.git');
      const top = await h.call('bash', { command: 'git rev-parse --show-toplevel' });
      expect(top.isError).toBeUndefined();
      expect(textOf(top).trim()).toContain(path.basename(h.workspace));

      const plain = await h.call('bash', { command: 'printf %s "kept:$GIT_DIR"', env: { FOO: 'kept' } });
      expect(plain.isError).toBeUndefined();
      expect(textOf(plain)).toContain('kept');
      expect(textOf(plain)).not.toContain('.git');
    } finally {
      if (previous === undefined) {
        delete process.env['GIT_DIR'];
      } else {
        process.env['GIT_DIR'] = previous;
      }
      await h.cleanup();
    }
  });
});

describe('finding 3: zstd, pax, mkfifo, and mknod write files the analyzer never names', () => {
  it('records the zstd, pax, and node destinations as writes and keeps the stream forms', () => {
    expect(writesOf('zstd -q -f a.txt -o .pi/pi-tools.json')).toEqual(['.pi/pi-tools.json']);
    expect(writesOf('zstd -qfo .pi/pi-tools.json a.txt')).toEqual(['.pi/pi-tools.json']);
    expect(writesOf('zstd -q -f a.txt --output .piignore')).toEqual(['.piignore']);
    expect(writesOf('zstd -q -f a.txt --output=.piignore')).toEqual(['.piignore']);
    expect(writesOf('zstd -q -f a.txt -o -')).toEqual([]);
    expect(writesOf('zstd -d -q a.txt.zst')).toEqual([]);
    expect(pathsOf('zstd -d -q a.txt.zst')).toContainEqual({ path: 'a.txt.zst', write: false });
    expect(untrustedOf('zstd -q -f a.txt -o "$TARGET"')).toContain('built by an expansion');

    expect(writesOf('pax -w -f .piignore a.txt')).toEqual(['.piignore']);
    expect(writesOf('pax -wf .piignore a.txt')).toEqual(['.piignore']);
    expect(writesOf('pax -w --file .piignore a.txt')).toEqual(['.piignore']);
    expect(writesOf('pax -w --file=.piignore a.txt')).toEqual(['.piignore']);
    expect(writesOf('pax -w -f - a.txt')).toEqual([]);
    expect(pathsOf('pax -w -f out.tar a.txt')).toContainEqual({ path: 'a.txt', write: false });

    expect(writesOf('mkfifo /tmp/fifo')).toEqual(['/tmp/fifo']);
    expect(writesOf('mkfifo -m 600 a.fifo b.fifo')).toEqual(['a.fifo', 'b.fifo']);
    expect(writesOf('mknod /tmp/node p')).toEqual(['/tmp/node']);
    expect(writesOf('mknod -m 600 /tmp/node c 1 3')).toEqual(['/tmp/node']);
    expect(untrustedOf('mkfifo "$NAME"')).toContain('built by an expansion');
  });

  it('refuses a writer aimed at a protected file or outside the workspace', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    try {
      const policy = h.file('.pi/pi-tools.json');
      const before = await readFile(policy, 'utf-8');
      await h.write('a.txt', 'PLAINTEXT\n');
      await h.write('.piignore', 'secret*\n');
      const outside = path.join(h.root, 'outside.zst');

      const policyWrite = await h.call('bash', { command: 'zstd -q -f a.txt -o .pi/pi-tools.json' });
      expect(policyWrite.isError).toBe(true);
      expect(textOf(policyWrite)).toContain(POLICY_REFUSAL);
      expect(await readFile(policy, 'utf-8')).toBe(before);

      const outsideWrite = await h.call('bash', { command: `zstd -q -f a.txt -o ${outside}` });
      expect(outsideWrite.isError).toBe(true);
      expect(textOf(outsideWrite)).toContain('outside the workspace');
      expect(existsSync(outside)).toBe(false);

      const ignoreWrite = await h.call('bash', { command: 'pax -w -f .piignore a.txt' });
      expect(ignoreWrite.isError).toBe(true);
      expect(textOf(ignoreWrite)).toContain(IGNORE_REFUSAL);
      expect(await readFile(h.file('.piignore'), 'utf-8')).toBe('secret*\n');

      const fifo = await h.call('bash', { command: `mkfifo ${path.join(h.root, 'outside.fifo')}` });
      expect(fifo.isError).toBe(true);
      expect(textOf(fifo)).toContain('outside the workspace');
      expect(existsSync(path.join(h.root, 'outside.fifo'))).toBe(false);

      // An in-workspace destination still runs.
      const inside = await h.call('bash', { command: 'mkfifo pipe.fifo' });
      expect(inside.isError).toBeUndefined();
      expect(existsSync(h.file('pipe.fifo'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  it.skipIf(!hasBinary('zstd') || !hasBinary('pax'))('still writes an in-workspace zstd and pax archive', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await h.write('a.txt', 'PLAINTEXT\n');
      const zstd = await h.call('bash', { command: 'zstd -q -f a.txt -o out.zst' });
      expect(zstd.isError).toBeUndefined();
      expect(existsSync(h.file('out.zst'))).toBe(true);
      const pax = await h.call('bash', { command: 'pax -w -f out.tar a.txt' });
      expect(pax.isError).toBeUndefined();
      expect(existsSync(h.file('out.tar'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('lead review: a directory pathspec rewrites files the argv never names', () => {
  it('refuses checkout and restore on a directory while keeping a named file and a new branch', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await h.write('a.txt', 'A\n');
      execFileSync('git', ['init', '-q'], { cwd: h.workspace });
      execFileSync('git', ['add', '-A'], { cwd: h.workspace });
      execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'init'], { cwd: h.workspace });

      for (const command of ['git checkout -- .', 'git restore .', 'git restore --staged .']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('rewrites every file under a directory or glob');
      }
      for (const command of ['git checkout -- a.txt', 'git restore a.txt', 'git checkout -b feature']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBeUndefined();
      }
    } finally {
      await h.cleanup();
    }
  });
});
