import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the fifteenth adversarial pass, wave A. Each test names the finding it locks down. */

const untrustedOf = (command: string): string | undefined => analyzeShellCommand(command, '/home/tester').untrusted;

const PROCESS_SUBSTITUTION_REASON = 'the command uses process substitution, which the analyzer cannot vouch for';
const CONFIG_ENV_REASON = 'git --config-env builds a config value from the environment, so the analyzer cannot see what runs';
const EXEC_PATH_REASON = 'git --exec-path runs git from a directory the analyzer does not read';
const FILTER_BRANCH_REASON = 'git filter-branch runs a filter command the analyzer does not follow';
const RSYNC_TRANSPORT_REASON = 'rsync -e runs a transport command the analyzer does not follow';
const CLEAN_REASON = 'the command deletes files the argv does not name';
const READ_TREE_REASON = 'the update rewrites worktree files the argv does not name';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd });
}

function initRepo(cwd: string): void {
  git(cwd, 'init', '-q', '.');
  git(cwd, 'config', 'user.email', 'a@b.c');
  git(cwd, 'config', 'user.name', 'a');
}

describe('finding 1: process substitution hides the file a command reads or writes', () => {
  it('refuses every unquoted substitution but keeps quoted text, subshells, and arithmetic', () => {
    for (const command of [
      'cat <(true) .env',
      'cat <(true) hidden.txt',
      'cp <(printf hacked) ../outside.txt',
      'cp <(printf pwned) .pi/pi-tools.json',
      'cat -- <(true)',
      'diff <(cat .env) <(cat ok.txt)',
      'cat >(tee .env)',
      'sh -c "cat <(true) .env"',
      'cat $(cat <(true) .env)',
    ]) {
      expect(untrustedOf(command), command).toContain(PROCESS_SUBSTITUTION_REASON);
    }

    for (const command of ['cat .env', "echo '<(true)' .env", 'echo "<(true)" .env', 'echo \\<(true) .env', '(cat .env)', 'echo $((1 + 2))']) {
      expect(untrustedOf(command) ?? '', command).not.toContain(PROCESS_SUBSTITUTION_REASON);
    }
  });

  it('refuses the write that would replace the policy and leaves the file alone', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    try {
      await h.write('.env', 'SECRET_TOKEN=denied\n');
      await h.write('ok.txt', 'visible\n');
      const policy = h.file('.pi/pi-tools.json');
      const before = await readFile(policy, 'utf8');

      const read = await h.call('bash', { command: 'cat <(true) .env' });
      const write = await h.call('bash', { command: 'cp <(printf pwned) .pi/pi-tools.json' });

      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain(PROCESS_SUBSTITUTION_REASON);
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain(PROCESS_SUBSTITUTION_REASON);
      expect(await readFile(policy, 'utf8')).toBe(before);
      expect(textOf(await h.call('bash', { command: 'cat ok.txt' }))).toContain('visible');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: git --config-env and --exec-path open a command channel the argv does not show', () => {
  it('refuses both options in every form and keeps -c, the global options, and plain subcommands', () => {
    for (const command of [
      "ZZCMD='show HEAD:.env' git --config-env=alias.zz=ZZCMD zz",
      'git --config-env=alias.zz=ZZCMD zz',
      'git --config-en alias.zz=ZZCMD zz',
      'git --config-env alias.zz=ZZCMD zz',
      'git --exec-path=/tmp/bin evil',
      'git --exec-path=/tmp/bin',
      'git --exec-p=/tmp/bin evil',
      'git -C sub --exec-path=/tmp/bin evil',
    ]) {
      const reason = untrustedOf(command);
      expect(reason, command).toMatch(new RegExp(`${CONFIG_ENV_REASON}|${EXEC_PATH_REASON}`));
    }

    // `-c` keeps its own rule: a plain setting is allowed, and a key git executes is refused.
    expect(untrustedOf('git -c core.quotePath=false status')).toBeUndefined();
    expect(untrustedOf('git -c color.ui=never log')).toBeUndefined();
    expect(untrustedOf("git -c alias.zz='status' zz")).toContain('git -c runs a command the analyzer does not follow');
    for (const command of ['git --git-dir=.git log', 'git -C sub status', 'git show HEAD:.env']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('refuses an alias that reads a denied file and a binary from an outside exec path', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] }, env: { ZZCMD: 'show HEAD:.env' } });
    try {
      await h.write('.env', 'SECRET_TOKEN=denied\n');
      initRepo(h.workspace);
      git(h.workspace, 'add', '-f', '.env');
      git(h.workspace, 'commit', '-qm', 'init');
      const bin = path.join(h.root, 'bin');
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(bin, 'evil'), '#!/bin/sh\necho PWNED > ../marker\n', { mode: 0o755 });

      const alias = await h.call('bash', { command: "ZZCMD='show HEAD:.env' git --config-env=alias.zz=ZZCMD zz" });
      const exec = await h.call('bash', { command: `git --exec-path=${bin} evil` });

      expect(alias.isError).toBe(true);
      expect(textOf(alias)).not.toContain('SECRET_TOKEN');
      expect(textOf(alias)).toContain(CONFIG_ENV_REASON);
      expect(exec.isError).toBe(true);
      expect(textOf(exec)).toContain(EXEC_PATH_REASON);
      expect(existsSync(path.join(h.root, 'marker'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: git filter-branch and an rsync remote shell run a command the analyzer never reads', () => {
  it('refuses every filter-branch form and every rsync transport form, and keeps ordinary copies', () => {
    for (const command of [
      "git filter-branch -f --tree-filter 'touch /tmp/x' HEAD",
      "git filter-branch --index-filter 'git rm --cached .env' HEAD",
      "git filter-branch --env-filter 'export X=1' HEAD",
      'git filter-branch --prune-empty HEAD',
      'git filter-branch',
    ]) {
      expect(untrustedOf(command), command).toContain(FILTER_BRANCH_REASON);
    }

    for (const command of [
      'rsync -e \'sh -c "touch /tmp/x"\' a.txt host:/tmp/x',
      'rsync -e ssh a.txt host:/tmp/x',
      'rsync --rsh=ssh a.txt host:/tmp/x',
      'rsync --rsh ssh a.txt host:/tmp/x',
      'rsync --rsync-path=/tmp/x a.txt host:/tmp/x',
      'rsync --rsync-path=/tmp/x a.txt b.txt',
      'rsync -avze ssh a.txt host:/tmp/x',
      'rsync -eSSH a.txt host:/tmp/x',
    ]) {
      expect(untrustedOf(command), command).toContain(RSYNC_TRANSPORT_REASON);
    }

    for (const command of ['rsync -a a.txt copy.txt', 'rsync -av a.txt copy.txt', 'rsync --list-only a.txt dest/', 'rsync -T e a.txt dest/', 'rsync -f e a.txt copy.txt']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('refuses the filter body and the transport command before either runs', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'plain a\n');
      initRepo(h.workspace);
      git(h.workspace, 'add', 'a.txt');
      git(h.workspace, 'commit', '-qm', 'init');
      const filter = path.join(h.root, 'pwned-filter');
      const transport = path.join(h.root, 'pwned-rsync');

      const filtered = await h.call('bash', { command: `git filter-branch -f --tree-filter 'touch ${filter}' HEAD` });
      const rsynced = await h.call('bash', { command: `rsync -e 'sh -c "touch ${transport}"' a.txt nowhere:/tmp/x` });
      const copied = await h.call('bash', { command: 'rsync -a a.txt copy.txt' });

      expect(filtered.isError).toBe(true);
      expect(textOf(filtered)).toContain(FILTER_BRANCH_REASON);
      expect(existsSync(filter)).toBe(false);
      expect(rsynced.isError).toBe(true);
      expect(textOf(rsynced)).toContain(RSYNC_TRANSPORT_REASON);
      expect(existsSync(transport)).toBe(false);
      expect(copied.isError).toBeUndefined();
      expect(existsSync(h.file('copy.txt'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: git clean deletes files the argv never names', () => {
  it('refuses a clean that deletes and keeps the dry runs', () => {
    for (const command of ['git clean -fdx', 'git clean -f', 'git clean -fd', 'git clean -x', 'git clean', 'git clean -e .env', 'git clean -ffdx', 'git -C sub clean -fdx']) {
      expect(untrustedOf(command), command).toContain(CLEAN_REASON);
    }

    for (const command of ['git clean -n', 'git clean -ndx', 'git clean --dry-run', 'git clean --dry', 'git clean -n -e .env', 'git clean -nd -e .env']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('refuses the clean that would remove a denied file and the policy, and allows the dry run', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }], mode: 'auto' } });
    try {
      await h.write('.env', 'SECRET_TOKEN=denied\n');
      await h.write('a.txt', 'plain a\n');
      await h.write('.gitignore', '.env\n');
      initRepo(h.workspace);
      git(h.workspace, 'add', 'a.txt', '.gitignore');
      git(h.workspace, 'commit', '-qm', 'init');

      const cleaned = await h.call('bash', { command: 'git clean -fdx' });
      expect(cleaned.isError).toBe(true);
      expect(textOf(cleaned)).toContain(CLEAN_REASON);
      expect(existsSync(h.file('.env'))).toBe(true);
      expect(existsSync(h.file('.pi/pi-tools.json'))).toBe(true);

      const preview = await h.call('bash', { command: 'git clean -ndx' });
      expect(preview.isError).toBeUndefined();
      expect(textOf(preview)).toContain('.env');
      expect(existsSync(h.file('.env'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5: git read-tree --update rewrites worktree files the argv never names', () => {
  it('refuses every update form and keeps the index-only forms', () => {
    for (const command of ['git read-tree -u --reset HEAD', 'git read-tree -u HEAD', 'git read-tree -um HEAD', 'git read-tree --update HEAD', 'git read-tree --upd HEAD', 'git read-tree --update=HEAD']) {
      expect(untrustedOf(command), command).toContain(READ_TREE_REASON);
    }

    for (const command of ['git read-tree HEAD', 'git read-tree -m HEAD', 'git read-tree --prefix=sub/ HEAD', 'git read-tree -n --reset HEAD', 'git ls-files']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('refuses the update and leaves the write-denied worktree file as it was', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'write', action: 'deny', pattern: '**/protected.txt' }] } });
    try {
      await h.write('a.txt', 'original a\n');
      await h.write('protected.txt', 'original protected\n');
      initRepo(h.workspace);
      git(h.workspace, 'add', 'a.txt', 'protected.txt');
      git(h.workspace, 'commit', '-qm', 'init');
      await h.write('a.txt', 'local edit a\n');
      await h.write('protected.txt', 'local edit protected\n');

      const update = await h.call('bash', { command: 'git read-tree -u --reset HEAD' });
      const indexOnly = await h.call('bash', { command: 'git read-tree HEAD' });

      expect(update.isError).toBe(true);
      expect(textOf(update)).toContain(READ_TREE_REASON);
      expect(await readFile(h.file('a.txt'), 'utf8')).toBe('local edit a\n');
      expect(await readFile(h.file('protected.txt'), 'utf8')).toBe('local edit protected\n');
      expect(indexOnly.isError).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});
