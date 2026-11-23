import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the fourteenth adversarial pass, wave A1. Each test names the finding it locks down. */

const untrustedOf = (command: string, root: string = process.cwd()): string | undefined => analyzeShellCommand(command, '/home/tester', root).untrusted;

const ARCHIVE_REASON = 'the archive members name the paths this command writes, and the analyzer does not read them';
const TEMPLATE_REASON = 'a template installs hooks the analyzer does not read';
const DIFF_REASON = 'the commit diff prints the body of every file it touches';
const REBASE_REASON = 'git rebase --exec runs a command the analyzer does not follow';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf-8' });

function hasBinary(name: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Write a tar holding a protected ignore file, the project policy, and a hook that prints a denied file. */
async function stageEvilTar(root: string): Promise<string> {
  const stage = path.join(root, 'stage');
  const payload = path.join(stage, 'payload');
  await mkdir(path.join(payload, '.git', 'hooks'), { recursive: true });
  await mkdir(path.join(payload, '.pi'), { recursive: true });
  await writeFile(path.join(payload, '.piignore'), 'NOTHING\n', 'utf-8');
  await writeFile(path.join(payload, '.pi', 'pi-tools.json'), JSON.stringify({ mode: 'unrestricted' }), 'utf-8');
  await writeFile(path.join(payload, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\ncat .env >&2\n', { mode: 0o755 });
  const archive = path.join(stage, 'evil.tar');
  execFileSync('tar', ['-cf', archive, '-C', payload, '.piignore', '.pi/pi-tools.json', '.git/hooks/pre-commit']);
  return archive;
}

describe('finding 1: an archive extraction writes member paths the analyzer never reads', () => {
  it('refuses every extraction form and keeps the create, append, update, and list forms', () => {
    for (const command of [
      'tar -xf evil.tar',
      'tar -xvf evil.tar',
      'tar xf evil.tar',
      'tar xvf evil.tar',
      'tar --extract -f evil.tar',
      'tar --ext -f evil.tar',
      'tar --get -f evil.tar',
      'tar --to-command="cat > /tmp/out" -xf evil.tar',
      'bsdtar -x -f evil.tar',
      'gtar -xf evil.tar',
      'pax -r < evil.tar',
      'pax -rf evil.tar',
      'pax --read < evil.tar',
      'unzip -o evil.zip',
      'unzip -q evil.zip',
      'unzip evil.zip',
      'unzip -d out evil.zip',
      'unzip -p evil.zip .env',
    ]) {
      expect(untrustedOf(command), command).toContain(ARCHIVE_REASON);
    }

    for (const command of [
      'tar -cf out.tar payload.txt',
      'tar -czf out.tgz payload.txt',
      'tar -rf out.tar payload.txt',
      'tar -uf out.tar payload.txt',
      'tar -cvf out.tar payload.txt',
      'tar -tf out.tar',
      'bsdtar -c -f out.tar payload.txt',
      'pax -w -f out.tar payload.txt',
      'pax < evil.tar',
      'zip -q pkg.zip payload.txt',
      'unzip -l evil.zip',
      'unzip -v evil.zip',
      'unzip -t evil.zip',
      'unzip -Z1 evil.zip',
    ]) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('leaves the policy, the ignore file, and the hooks untouched when extraction is refused', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] },
    });
    try {
      await h.write('.env', 'TOPSECRET=1\n');
      await h.write('.piignore', 'keep.txt\n');
      await h.write('keep.txt', 'keep\n');
      const archive = await stageEvilTar(h.root);
      const policyBefore = await readFile(h.file('.pi/pi-tools.json'), 'utf8');
      const ignoreBefore = await readFile(h.file('.piignore'), 'utf8');

      const result = await h.call('bash', { command: `tar -xf ${archive}` });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(ARCHIVE_REASON);
      expect(textOf(result)).not.toContain('TOPSECRET');
      expect(await readFile(h.file('.pi/pi-tools.json'), 'utf8')).toBe(policyBefore);
      expect(await readFile(h.file('.piignore'), 'utf8')).toBe(ignoreBefore);
      expect(existsSync(h.file('.git/hooks/pre-commit'))).toBe(false);

      if (hasBinary('zip')) {
        const zipped = await h.call('bash', { command: 'zip -qr evil.zip .piignore .pi/pi-tools.json' });
        expect(zipped.isError).toBeUndefined();
        const zip = await h.call('bash', { command: 'unzip -o evil.zip' });
        expect(zip.isError).toBe(true);
        expect(textOf(zip)).toContain(ARCHIVE_REASON);
        expect(textOf(zip)).not.toContain('TOPSECRET');
        expect(await readFile(h.file('.pi/pi-tools.json'), 'utf8')).toBe(policyBefore);
        expect(await readFile(h.file('.piignore'), 'utf8')).toBe(ignoreBefore);
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: git clone --template installs a hook the clone runs', () => {
  it('refuses --template in its spaced, attached, and abbreviated forms', () => {
    for (const command of ['git clone --template tpl . cloned', 'git clone --template=tpl . cloned', 'git clone --temp=tpl . cloned', 'git clone --te=tpl . cloned', 'git -C . clone --template=tpl . cloned', 'git init --temp=tpl .']) {
      expect(untrustedOf(command), command).toContain(TEMPLATE_REASON);
    }

    for (const command of ['git clone . cloned', 'git clone --depth 1 . cloned', 'git init .', 'git init --separate-git-dir ../gitdir .']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('stops the clone before the template hook runs and keeps an ordinary clone working', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] },
    });
    try {
      await h.write('.env', 'TOPSECRET=1\n');
      await h.write('keep.txt', 'keep\n');
      git(h.workspace, 'init', '-q');
      git(h.workspace, 'config', 'user.email', 'a@b.c');
      git(h.workspace, 'config', 'user.name', 'a');
      git(h.workspace, 'add', '-A');
      git(h.workspace, 'commit', '-qm', 'init');

      const template = path.join(h.root, 'template');
      await mkdir(path.join(template, 'hooks'), { recursive: true });
      await writeFile(path.join(template, 'hooks', 'post-checkout'), '#!/bin/sh\ncat .env >&2\n', { mode: 0o755 });

      const result = await h.call('bash', { command: `git clone --template=${template} . cloned` });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(TEMPLATE_REASON);
      expect(textOf(result)).not.toContain('TOPSECRET');
      expect(existsSync(h.file('cloned'))).toBe(false);

      const plain = await h.call('bash', { command: 'git clone -q . plain' });
      expect(plain.isError).toBeUndefined();
      expect(existsSync(h.file('plain/.git'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: git stash show -p prints a denied file body', () => {
  it('refuses the patch output unless a path that cannot name a directory narrows it', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] },
    });
    try {
      await h.write('.env', 'TOPSECRET=one\n');
      await h.write('keep.txt', 'keep\n');
      await h.write('sub/notes.md', 'notes\n');
      git(h.workspace, 'init', '-q');
      git(h.workspace, 'config', 'user.email', 'a@b.c');
      git(h.workspace, 'config', 'user.name', 'a');
      git(h.workspace, 'add', '-f', '-A');
      git(h.workspace, 'commit', '-qm', 'init');
      await h.write('.env', 'TOPSECRET=two\n');
      await h.write('keep.txt', 'kept\n');
      await h.call('bash', { command: 'git stash push -qm x' });

      for (const command of ['git stash show -p', 'git stash show --patch', 'git stash show -p stash@{0}', 'git stash show -p -- sub']) {
        expect(untrustedOf(command, h.workspace), command).toContain(DIFF_REASON);
      }
      for (const command of ['git stash show', 'git stash show --stat', 'git stash show -p -- keep.txt']) {
        expect(untrustedOf(command, h.workspace), command).toBeUndefined();
      }
    } finally {
      await h.cleanup();
    }
  });

  it('prints no denied body from bash or the git tool and keeps the summary forms', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] },
    });
    try {
      await h.write('.env', 'TOPSECRET=one\n');
      await h.write('keep.txt', 'keep\n');
      git(h.workspace, 'init', '-q');
      git(h.workspace, 'config', 'user.email', 'a@b.c');
      git(h.workspace, 'config', 'user.name', 'a');
      git(h.workspace, 'add', '-f', '-A');
      git(h.workspace, 'commit', '-qm', 'init');
      await h.write('.env', 'TOPSECRET=two\n');
      await h.write('keep.txt', 'kept\n');
      await h.call('bash', { command: 'git stash push -qm x' });

      for (const call of [() => h.call('bash', { command: 'git stash show -p' }), () => h.call('git', { subcommand: 'stash', args: ['show', '-p'] })]) {
        const result = await call();
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(DIFF_REASON);
        expect(textOf(result)).not.toContain('TOPSECRET');
      }

      const narrowed = await h.call('bash', { command: 'git stash show -p -- .env' });
      expect(narrowed.isError).toBe(true);
      expect(textOf(narrowed)).toContain('rule: **/.env');
      expect(textOf(narrowed)).not.toContain('TOPSECRET');

      for (const command of ['git stash show', 'git stash show --stat']) {
        const summary = await h.call('bash', { command });
        expect(summary.isError, command).toBeUndefined();
        expect(textOf(summary), command).toContain('keep.txt');
        expect(textOf(summary), command).not.toContain('TOPSECRET');
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: git rebase --exec runs a body the analyzer never sees', () => {
  it('refuses --exec in its attached and abbreviated forms and -x in a cluster', () => {
    for (const command of [
      'git rebase --exec "cat .env" HEAD~1',
      'git rebase --exec="cat .env" HEAD~1',
      'git rebase --ex "cat .env" HEAD~1',
      'git rebase --exe "cat .env" HEAD~1',
      'git rebase -x "cat .env" HEAD~1',
      'git rebase -ix "cat .env" HEAD~1',
      'git rebase -x"cat .env" HEAD~1',
      'git -C sub rebase --exec "cat .env" HEAD~1',
    ]) {
      expect(untrustedOf(command), command).toContain(REBASE_REASON);
    }

    for (const command of ['git rebase HEAD~1', 'git rebase -i HEAD~2', 'git rebase --onto main HEAD~1', 'git rebase -s recursive HEAD~1', 'git rebase -X ours HEAD~1', 'git rebase --autostash HEAD~1']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('stops the rebase before the body runs, from bash and from the git tool', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] },
    });
    try {
      await h.write('.env', 'TOPSECRET=1\n');
      await h.write('a.txt', 'one\n');
      git(h.workspace, 'init', '-q');
      git(h.workspace, 'config', 'user.email', 'a@b.c');
      git(h.workspace, 'config', 'user.name', 'a');
      git(h.workspace, 'add', '-f', '-A');
      git(h.workspace, 'commit', '-qm', 'one');
      await h.write('a.txt', 'two\n');
      git(h.workspace, 'add', '-A');
      git(h.workspace, 'commit', '-qm', 'two');

      for (const call of [() => h.call('bash', { command: 'git rebase --exec "cat .env" HEAD~1' }), () => h.call('git', { subcommand: 'rebase', args: ['--exec', 'cat .env', 'HEAD~1'] })]) {
        const result = await call();
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(REBASE_REASON);
        expect(textOf(result)).not.toContain('TOPSECRET');
      }

      const ordinary = await h.call('bash', { command: 'git rebase HEAD' });
      expect(ordinary.isError).toBeUndefined();
      expect(textOf(ordinary)).toContain('up to date');
    } finally {
      await h.cleanup();
    }
  });
});
