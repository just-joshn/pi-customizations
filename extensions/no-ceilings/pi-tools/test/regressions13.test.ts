import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the thirteenth adversarial pass, wave A1. Each test names the finding it locks down. */

const untrustedOf = (command: string): string | undefined => analyzeShellCommand(command, '/home/tester').untrusted;
const pathsOf = (command: string): readonly { readonly path: string; readonly write: boolean }[] => analyzeShellCommand(command, '/home/tester').paths;
const writesOf = (command: string): string[] =>
  pathsOf(command)
    .filter((entry) => entry.write)
    .map((entry) => entry.path);

const CHECKOUT_INDEX = 'writes the files its index names';
const MOVE_TARGET = 'does not spell out';

describe('finding 1: git checkout-index writes the files its index names', () => {
  it('refuses every form of checkout-index, including the prefix that names an unseen destination', () => {
    for (const command of [
      'git checkout-index -f --prefix=.git/hooks/ pre-commit',
      'git checkout-index -f --prefix=.git/ config',
      'git checkout-index --prefix=/tmp/out/ a.txt',
      'git checkout-index -a',
      'git checkout-index --all --force',
      'git checkout-index -f -u a.txt',
      'git checkout-index --stdin',
      'git -C sub checkout-index -a',
    ]) {
      expect(untrustedOf(command), command).toContain(CHECKOUT_INDEX);
    }
    // The old analyzer saw only the operand it lists, never the prefix it writes through.
    expect(writesOf('git checkout-index -f --prefix=.git/hooks/ pre-commit')).toEqual([]);
  });

  it('plants no hook, replaces no config, and writes no outside file', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    const outside = path.join(h.root, 'outside');
    const marker = path.join(outside, 'ran');
    try {
      await mkdir(outside, { recursive: true });
      await h.write('a.txt', 'PAYLOAD\n');
      await h.write('pre-commit', '#!/bin/sh\ntouch ../ran\n');
      await h.write('config', '[core]\n\thooksPath = myhooks\n');
      expect((await h.call('bash', { command: 'git init -q && git add a.txt pre-commit config && git update-index --chmod=+x pre-commit' })).isError).toBeUndefined();
      const originalConfig = await readFile(h.file('.git/config'), 'utf8');

      const hook = await h.call('bash', { command: 'git checkout-index -f --prefix=.git/hooks/ pre-commit' });
      expect(hook.isError).toBe(true);
      expect(textOf(hook)).toContain(CHECKOUT_INDEX);
      expect(existsSync(h.file('.git/hooks/pre-commit'))).toBe(false);

      const config = await h.call('bash', { command: 'git checkout-index -f --prefix=.git/ config' });
      expect(config.isError).toBe(true);
      expect(textOf(config)).toContain(CHECKOUT_INDEX);
      expect(await readFile(h.file('.git/config'), 'utf8')).toBe(originalConfig);

      const escaped = await h.call('bash', { command: `git checkout-index -f --prefix=${outside}/out/ a.txt` });
      expect(escaped.isError).toBe(true);
      expect(textOf(escaped)).toContain(CHECKOUT_INDEX);
      expect(existsSync(path.join(outside, 'out', 'a.txt'))).toBe(false);

      // A later commit has no hook to run, so the marker the hook would write never appears.
      expect((await h.call('bash', { command: 'git -c user.email=a@b.c -c user.name=t commit --allow-empty -qm trig' })).isError).toBeUndefined();
      expect(existsSync(marker)).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: git mv records only its sources as reads', () => {
  it('records the last operand as a write and keeps every source a read', () => {
    expect(pathsOf('git mv -f a.txt .pi/pi-tools.json')).toEqual([
      { path: 'a.txt', write: false },
      { path: '.pi/pi-tools.json', write: true },
    ]);
    expect(pathsOf('git mv -v a.txt b.txt')).toEqual([
      { path: 'a.txt', write: false },
      { path: 'b.txt', write: true },
    ]);
    // With several sources the destination is the last operand, and the sources stay reads.
    expect(pathsOf('git mv a.txt b.txt dir/')).toEqual([
      { path: 'a.txt', write: false },
      { path: 'b.txt', write: false },
      { path: 'dir/', write: true },
    ]);
    // A lone operand has no destination, so it stays a read.
    expect(pathsOf('git mv a.txt')).toEqual([{ path: 'a.txt', write: false }]);
    // `-t` takes the destination's name out of the argv, so the moved path is unrecorded.
    for (const command of ['git mv -t dir a.txt', 'git mv -tdir a.txt', 'git mv -ft dir a.txt', 'git mv --target-directory dir a.txt', 'git mv --target-directory=dir a.txt']) {
      expect(untrustedOf(command), command).toContain(MOVE_TARGET);
    }
    // An expansion can spell the flag, so the destination is unknown in those forms too.
    for (const command of ['git mv "-t$D" a.txt', 'git mv -t"$D" a.txt']) {
      expect(untrustedOf(command), command).toContain(MOVE_TARGET);
    }
    // A path that merely starts with a dash after `--` is not the target-directory flag.
    expect(untrustedOf('git mv -- -tfile b.txt')).toBeUndefined();
  });

  it('refuses the policy file, a hook, and an outside destination while moving a plain file', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    const outside = path.join(h.root, 'outside');
    try {
      await mkdir(outside, { recursive: true });
      await h.write('a.txt', 'PAYLOAD\n');
      await h.write('pre-commit', '#!/bin/sh\ntouch ../ran\n');
      await h.write('.pi/pi-tools.json', JSON.stringify({ mode: 'auto' }));
      expect((await h.call('bash', { command: 'git init -q && git add a.txt pre-commit' })).isError).toBeUndefined();
      const originalPolicy = await readFile(h.file('.pi/pi-tools.json'), 'utf8');

      const policy = await h.call('bash', { command: 'git mv -f a.txt .pi/pi-tools.json' });
      expect(policy.isError).toBe(true);
      expect(textOf(policy)).toContain('.pi/pi-tools.json');
      expect(await readFile(h.file('.pi/pi-tools.json'), 'utf8')).toBe(originalPolicy);
      expect(await readFile(h.file('a.txt'), 'utf8')).toBe('PAYLOAD\n');

      const hook = await h.call('bash', { command: 'git mv -f pre-commit .git/hooks/post-commit' });
      expect(hook.isError).toBe(true);
      expect(textOf(hook)).toContain('.git/hooks/post-commit');
      expect(existsSync(h.file('.git/hooks/post-commit'))).toBe(false);
      expect(existsSync(h.file('pre-commit'))).toBe(true);

      const escaped = await h.call('bash', { command: `git mv -f a.txt ${outside}/moved.txt` });
      expect(escaped.isError).toBe(true);
      expect(textOf(escaped)).toContain('outside the workspace');
      expect(existsSync(path.join(outside, 'moved.txt'))).toBe(false);

      const placed = await h.call('bash', { command: 'git mv -t sub a.txt' });
      expect(placed.isError).toBe(true);
      expect(textOf(placed)).toContain(MOVE_TARGET);

      // A move inside the workspace still runs, through the shell and the git tool.
      expect((await h.call('bash', { command: 'git mv a.txt moved.txt' })).isError).toBeUndefined();
      expect(await readFile(h.file('moved.txt'), 'utf8')).toBe('PAYLOAD\n');
      expect(existsSync(h.file('a.txt'))).toBe(false);
      expect((await h.call('git', { subcommand: 'mv', args: ['moved.txt', 'again.txt'] })).isError).toBeUndefined();
      expect(existsSync(h.file('again.txt'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: git init --separate-git-dir creates a directory outside the workspace', () => {
  it('records the separated git directory as a write in both spellings', () => {
    expect(writesOf('git init -q --separate-git-dir=/tmp/sep')).toEqual(['/tmp/sep']);
    expect(writesOf('git init -q --separate-git-dir /tmp/sep')).toEqual(['/tmp/sep']);
    expect(writesOf('git init -q --separate-git-dir=/tmp/sep repo')).toEqual(['/tmp/sep', 'repo']);
    expect(writesOf('git init -q')).toEqual([]);
  });

  it('refuses an outside git directory and keeps an inside one working', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    const outside = path.join(h.root, 'sep');
    try {
      const escaped = await h.call('bash', { command: `git init -q --separate-git-dir=${outside}` });
      expect(escaped.isError).toBe(true);
      expect(textOf(escaped)).toContain('outside the workspace');
      expect(existsSync(path.join(outside, 'HEAD'))).toBe(false);
      expect(existsSync(h.file('.git'))).toBe(false);

      const spaced = await h.call('bash', { command: `git init -q --separate-git-dir ${outside}` });
      expect(spaced.isError).toBe(true);
      expect(textOf(spaced)).toContain('outside the workspace');
      expect(existsSync(path.join(outside, 'HEAD'))).toBe(false);

      // A git directory inside the workspace is still allowed.
      expect((await h.call('bash', { command: 'git init -q --separate-git-dir=.git-store' })).isError).toBeUndefined();
      expect(await readFile(h.file('.git'), 'utf8')).toContain('.git-store');
      expect(existsSync(h.file('.git-store/HEAD'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: uniq and xxd write their second operand', () => {
  it('treats the second positional as a write and the first as a read', () => {
    expect(pathsOf('uniq in.txt .piignore')).toEqual([
      { path: 'in.txt', write: false },
      { path: '.piignore', write: true },
    ]);
    expect(pathsOf('xxd in.txt out.txt')).toEqual([
      { path: 'in.txt', write: false },
      { path: 'out.txt', write: true },
    ]);
    expect(pathsOf('xxd -r in.txt out.txt')).toEqual([
      { path: 'in.txt', write: false },
      { path: 'out.txt', write: true },
    ]);
    // A lone positional stays a read, so a read deny still sees the input.
    expect(pathsOf('uniq in.txt')).toEqual([{ path: 'in.txt', write: false }]);
    expect(pathsOf('xxd in.txt')).toEqual([{ path: 'in.txt', write: false }]);
    // An option value is not an operand, so the output stays the second positional.
    for (const command of [
      'uniq -c in.txt out.txt',
      'uniq -f 2 in.txt out.txt',
      'uniq -f2 in.txt out.txt',
      'xxd -l 4 in.txt out.txt',
      'xxd -l4 in.txt out.txt',
      'xxd -len 4 in.txt out.txt',
      'xxd --len 4 in.txt out.txt',
      'xxd -s +10 in.txt out.txt',
    ]) {
      expect(writesOf(command), command).toEqual(['out.txt']);
      expect(pathsOf(command)[0], command).toEqual({ path: 'in.txt', write: false });
    }
    // An output built by an expansion is unrecorded, so it is refused rather than guessed.
    expect(untrustedOf('uniq in.txt "$OUT"')).toContain('built by an expansion');
    // An expansion in the first operand can be an option word, which would shift the output operand.
    expect(untrustedOf('uniq "$FILE" out.txt')).toContain('hides which operand');
    expect(untrustedOf('xxd "$FILE" out.txt')).toContain('hides which operand');
    // A lone expanded operand is only a read, which this layer already does not see through.
    expect(untrustedOf('xxd "$FILE"')).toBeUndefined();
  });

  it('refuses protected, outside, and write-denied outputs while keeping plain use working', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: {
        mode: 'auto',
        rules: [
          { kind: 'read', action: 'deny', pattern: '**/secret.txt' },
          { kind: 'write', action: 'deny', pattern: '**/blocked.txt' },
        ],
      },
    });
    const outside = path.join(h.root, 'outside.txt');
    try {
      await h.write('in.txt', 'a\na\nb\n');
      await h.write('secret.txt', 'TOPSECRET\n');
      await h.write('.piignore', 'secretplan*\n');
      await h.write('.git/config', '[core]\n\tbare = false\n');
      await h.write('blocked.txt', 'keep me\n');
      const originalPolicy = await readFile(h.file('.pi/pi-tools.json'), 'utf8');
      const originalIgnore = await readFile(h.file('.piignore'), 'utf8');
      const originalConfig = await readFile(h.file('.git/config'), 'utf8');

      for (const [command, expected] of [
        ['uniq in.txt .piignore', 'Blocked: .piignore is protected'],
        ['uniq in.txt .git/config', 'Blocked: .git/config is git config'],
        ['uniq in.txt .pi/pi-tools.json', 'Blocked: .pi/pi-tools.json is the project policy file'],
        ['xxd in.txt .piignore', 'Blocked: .piignore is protected'],
        ['xxd -r in.txt .git/config', 'Blocked: .git/config is git config'],
        ['xxd -l 4 in.txt .pi/pi-tools.json', 'Blocked: .pi/pi-tools.json is the project policy file'],
        ['uniq in.txt blocked.txt', 'Blocked by permissions configuration'],
        ['xxd in.txt blocked.txt', 'Blocked by permissions configuration'],
        // A write-denied output is refused before the command reads the file it names.
        ['uniq in.txt ' + outside, 'outside the workspace'],
        ['xxd in.txt ' + outside, 'outside the workspace'],
      ] as const) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain(expected);
      }
      expect(await readFile(h.file('.pi/pi-tools.json'), 'utf8')).toBe(originalPolicy);
      expect(await readFile(h.file('.piignore'), 'utf8')).toBe(originalIgnore);
      expect(await readFile(h.file('.git/config'), 'utf8')).toBe(originalConfig);
      expect(await readFile(h.file('blocked.txt'), 'utf8')).toBe('keep me\n');
      expect(existsSync(outside)).toBe(false);

      // A read-denied input stays refused in the one-operand form and beside a write operand.
      for (const command of ['uniq secret.txt', 'xxd secret.txt', 'uniq secret.txt sorted.txt', 'xxd -l 4 secret.txt hex.txt', 'xxd --len 4 secret.txt hex.txt']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('**/secret.txt');
      }
      expect(existsSync(h.file('sorted.txt'))).toBe(false);
      expect(existsSync(h.file('hex.txt'))).toBe(false);

      // Plain use still works: one operand prints to stdout, two operands write the second one.
      const count = await h.call('bash', { command: 'uniq in.txt' });
      expect(textOf(count)).toBe('a\nb\n');
      expect((await h.call('bash', { command: 'uniq in.txt sorted.txt' })).isError).toBeUndefined();
      expect(await readFile(h.file('sorted.txt'), 'utf8')).toBe('a\nb\n');
      expect((await h.call('bash', { command: 'xxd in.txt hex.txt' })).isError).toBeUndefined();
      expect(await readFile(h.file('hex.txt'), 'utf8')).toContain('00000000:');
      expect((await h.call('bash', { command: 'uniq -c in.txt counted.txt' })).isError).toBeUndefined();
      expect(await readFile(h.file('counted.txt'), 'utf8')).toContain('2 a');
    } finally {
      await h.cleanup();
    }
  });
});
