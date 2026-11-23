import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the seventeenth adversarial pass, wave A. Each test names the finding it locks down. */

const pathsOf = (command: string): readonly { readonly path: string; readonly write: boolean }[] => analyzeShellCommand(command, '/home/tester').paths;
const writesOf = (command: string): string[] =>
  pathsOf(command)
    .filter((entry) => entry.write)
    .map((entry) => entry.path);
const readPathsOf = (command: string): string[] =>
  pathsOf(command)
    .filter((entry) => !entry.write)
    .map((entry) => entry.path);
const untrustedOf = (command: string): string | undefined => analyzeShellCommand(command, '/home/tester').untrusted;

const INDIRECT_REASON = 'runs a command the analyzer does not follow';
const ARCHIVE_REASON = 'the archive members name the paths this command writes, and the analyzer does not read them';
const OUTSIDE_REASON = 'outside the workspace';
const DENIED_REASON = '(rule: **/.env)';

/** True when the host has the named command, so a platform-only test can skip instead of fail. */
function hasCommand(name: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('finding 1: fd exec flags run a command the analyzer does not follow', () => {
  it('refuses every fd exec spelling and keeps the listing forms', () => {
    for (const command of ['fd -H -x cat \\; env$', 'fd -H -I -X cat \\; .', 'fd -Hx cat env', 'fd --exec cat env', 'fd --exec=cat env', 'fd --exec-batch cat .', 'fd --exec-batch=cat .', 'fdfind -x rm .']) {
      expect(untrustedOf(command), command).toContain(INDIRECT_REASON);
    }
    // An extension filter that happens to hold an `x` is not an exec flag, and a plain listing stays a read.
    expect(untrustedOf('fd -ex env')).toBeUndefined();
    expect(untrustedOf('fd -e x env')).toBeUndefined();
    expect(untrustedOf('fd -H notes.txt')).toBeUndefined();
    expect(untrustedOf('fd -t f -d 3 .')).toBeUndefined();
    expect(readPathsOf('fd -H notes.txt')).toContain('notes.txt');
  });

  it.skipIf(!hasCommand('fd'))('refuses to print or delete through fd -x and fd -X', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    const policy = h.file('.pi/pi-tools.json');
    try {
      await h.write('.env', 'SECRET_TOKEN=round17\n');
      await h.write('notes.txt', 'ordinary\n');
      await h.write('.piignore', 'ignored.txt\n');
      await h.write('ignored.txt', 'IGNORED_SECRET=round17\n');

      const each = await h.call('bash', { command: 'fd -H -x cat \\; env$' });
      const batch = await h.call('bash', { command: 'fd -H -I -X cat \\; .' });
      const deletes = await h.call('bash', { command: 'fd -H -I -x rm \\; pi-tools.json$' });
      const listed = await h.call('bash', { command: 'fd -H notes' });

      expect(each.isError).toBe(true);
      expect(textOf(each)).toContain(INDIRECT_REASON);
      expect(textOf(each)).not.toContain('SECRET_TOKEN');
      expect(batch.isError).toBe(true);
      expect(textOf(batch)).toContain(INDIRECT_REASON);
      expect(textOf(batch)).not.toContain('IGNORED_SECRET');
      expect(deletes.isError).toBe(true);
      expect(existsSync(policy)).toBe(true);
      expect(listed.isError).toBeUndefined();
      expect(textOf(listed)).toContain('notes.txt');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: 7-Zip extraction writes the member names the analyzer does not read', () => {
  it('refuses the x and e verbs and keeps a, u, l, and t as archive and read modes', () => {
    for (const command of ['7zz x -y evil.zip', '7zz e evil.zip', '7z x evil.zip', '7za e evil.zip', '7zz X evil.zip']) {
      expect(untrustedOf(command), command).toContain(ARCHIVE_REASON);
    }
    expect(writesOf('7zz a out.7z seed.txt')).toEqual(['out.7z']);
    expect(writesOf('7zz u out.7z seed.txt')).toEqual(['out.7z']);
    expect(writesOf('7zz l out.7z')).toEqual([]);
    expect(writesOf('7zz t out.7z')).toEqual([]);
    expect(untrustedOf('7zz l out.7z')).toBeUndefined();
  });

  it.skipIf(!hasCommand('7zz'))('refuses an extraction that would overwrite the policy and install a git hook', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [] } });
    const stage = path.join(h.root, 'stage');
    const marker = path.join(h.root, 'hook-ran');
    try {
      await mkdir(path.join(stage, '.pi'), { recursive: true });
      await mkdir(path.join(stage, '.git', 'hooks'), { recursive: true });
      await writeFile(path.join(stage, '.pi', 'pi-tools.json'), JSON.stringify({ mode: 'unrestricted' }));
      await writeFile(path.join(stage, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
      const archive = path.join(h.workspace, 'evil.zip');
      execFileSync('7zz', ['a', '-bso0', '-bsp0', archive, '.pi', '.git'], { cwd: stage, stdio: 'ignore' });
      await h.write('seed.txt', 'seed\n');

      const policy = h.file('.pi/pi-tools.json');
      const before = await readFile(policy, 'utf8');
      const extract = await h.call('bash', { command: '7zz x -y evil.zip' });
      const extractNoPaths = await h.call('bash', { command: '7zz e evil.zip' });

      expect(extract.isError).toBe(true);
      expect(textOf(extract)).toContain(ARCHIVE_REASON);
      expect(extractNoPaths.isError).toBe(true);
      expect(textOf(extractNoPaths)).toContain(ARCHIVE_REASON);
      expect(await readFile(policy, 'utf8')).toBe(before);
      expect(existsSync(h.file('.git/hooks/pre-commit'))).toBe(false);
      expect(existsSync(marker)).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: ar, 7zz, ffmpeg, and mktemp write an operand no writer flag names', () => {
  it('records the archive, output, and template operands as writes and keeps the readers as reads', () => {
    expect(writesOf('ar r /tmp/lib.a seed.txt')).toEqual(['/tmp/lib.a']);
    expect(writesOf('ar rc /tmp/lib.a seed.txt')).toEqual(['/tmp/lib.a']);
    expect(writesOf('ar -r /tmp/lib.a seed.txt')).toEqual(['/tmp/lib.a']);
    expect(writesOf('ar q /tmp/lib.a seed.txt')).toEqual(['/tmp/lib.a']);
    expect(writesOf('ar d /tmp/lib.a seed.txt')).toEqual(['/tmp/lib.a']);
    expect(writesOf('ar s /tmp/lib.a')).toEqual(['/tmp/lib.a']);
    expect(writesOf('ar t /tmp/lib.a')).toEqual([]);
    expect(writesOf('ar p /tmp/lib.a')).toEqual([]);
    expect(readPathsOf('ar t /tmp/lib.a')).toContain('/tmp/lib.a');
    expect(untrustedOf('ar x /tmp/lib.a')).toContain(ARCHIVE_REASON);
    // A member name before the archive shifts it by one word.
    expect(writesOf('ar ra pos /tmp/lib.a seed.txt')).toEqual(['/tmp/lib.a']);

    expect(writesOf('ffmpeg -y -f lavfi -i color=black:s=16x16:d=1 /tmp/o.mp4')).toEqual(['/tmp/o.mp4']);
    expect(readPathsOf('ffmpeg -i in.mp4 -f null out.mp4')).toContain('in.mp4');
    expect(writesOf('ffmpeg -i in.mp4 -f null -')).toEqual([]);

    expect(writesOf('mktemp /tmp/tmp.XXXXXX')).toEqual(['/tmp/tmp.XXXXXX']);
    expect(writesOf('mktemp -p /tmp tmp.XXXXXX')).toEqual(['/tmp', 'tmp.XXXXXX']);
    expect(writesOf('mktemp --tmpdir=/tmp t.XXXX')).toEqual(['/tmp', 't.XXXX']);
    expect(writesOf('mktemp')).toEqual([]);
  });

  it.skipIf(!hasCommand('ar') || !hasCommand('7zz') || !hasCommand('ffmpeg'))('refuses the outside write each unlisted writer makes without approval', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [] } });
    const outside = path.join(h.root, 'outside');
    try {
      await mkdir(outside, { recursive: true });
      await h.write('seed.txt', 'seed-content\n');
      for (const [label, command] of [
        ['ar r', `ar r ${outside}/lib.a seed.txt`],
        ['7zz a', `7zz a ${outside}/out.7z seed.txt`],
        ['ffmpeg', `ffmpeg -y -f lavfi -i color=black:s=16x16:d=1 ${outside}/o.mp4`],
        ['mktemp', `mktemp ${outside}/tmp.XXXXXX`],
      ] as const) {
        const result = await h.call('bash', { command });
        expect(result.isError, label).toBe(true);
        expect(textOf(result), label).toContain(OUTSIDE_REASON);
      }
      expect(readdirSync(outside)).toEqual([]);
      expect(h.confirmations).toEqual([]);
      // A write inside the workspace still runs, so the fix does not refuse the tools outright.
      await h.call('bash', { command: 'ar rc inside.a seed.txt' });
      expect(existsSync(h.file('inside.a'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: git file options in attached and equals form name a file no rule sees', () => {
  it('records the commit, tag, config, and format-patch file options as reads', () => {
    for (const command of ['git commit -F.env -- ok.txt', 'git commit -F .env -- ok.txt', 'git commit --file=.env -- ok.txt', 'git commit --file .env -- ok.txt', 'git commit --fil=.env -- ok.txt', 'git commit -qF.env -- ok.txt']) {
      expect(readPathsOf(command), command).toContain('.env');
      expect(untrustedOf(command), command).toBeUndefined();
    }
    for (const command of ['git config -f.env --get user.name', 'git config -f .env --get user.name', 'git config --file=.env --get user.name', 'git config --file .env --get user.name']) {
      expect(readPathsOf(command), command).toContain('.env');
    }
    for (const command of ['git format-patch --signature-file=.env -1 --stdout', 'git format-patch --signature-file .env -1 --stdout']) {
      expect(readPathsOf(command), command).toContain('.env');
    }
    expect(readPathsOf('git tag -F.env v1')).toContain('.env');
    expect(readPathsOf('git tag --file=.env v1')).toContain('.env');
    // A short letter that names no file stays ordinary: `-f` forces a tag and `-m` carries the message.
    expect(readPathsOf('git tag -f v1')).toEqual(['v1']);
    expect(readPathsOf('git commit -q -f -- ok.txt')).toEqual(['ok.txt']);
    expect(readPathsOf('git commit -mF.env -- ok.txt')).toEqual(['ok.txt']);
  });

  it('refuses the denied file in every form and leaves the forced command alone', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    try {
      await h.write('.env', 'SECRET_BYTES_17\n');
      await h.write('ok.txt', 'ok\n');
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd: h.workspace, stdio: 'ignore' });
      };
      git('init', '-q', '.');
      git('config', 'user.email', 'a@b.c');
      git('config', 'user.name', 'a');
      git('add', 'ok.txt');
      const initial = await h.call('bash', { command: 'git -c user.email=a@b.c -c user.name=c commit -q -m init' });
      expect(initial.isError).toBeUndefined();

      for (const command of ['git commit -F.env -- ok.txt', 'git commit --file=.env -- ok.txt', 'git config --file=.env --get user.name', 'git config -f.env --get user.name', 'git format-patch --signature-file=.env -1 --stdout']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain(DENIED_REASON);
        expect(textOf(result), command).not.toContain('SECRET_BYTES_17');
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('lead review: mktemp without a template writes under the system temp directory', () => {
  it('refuses the bare and -t forms while keeping a local template', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      for (const command of ['mktemp', 'mktemp -d', 'mktemp -t prefix']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('directory the analyzer does not see');
      }
      const local = await h.call('bash', { command: 'mktemp tmp.XXXXXX' });
      expect(local.isError).toBeUndefined();
      expect(existsSync(h.file(textOf(local).trim()))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});
