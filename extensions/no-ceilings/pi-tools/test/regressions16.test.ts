import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the sixteenth adversarial pass, wave A. Each test names the finding it locks down. */

const pathsOf = (command: string): readonly { readonly path: string; readonly write: boolean }[] => analyzeShellCommand(command, '/home/tester').paths;
const writesOf = (command: string): string[] =>
  pathsOf(command)
    .filter((entry) => entry.write)
    .map((entry) => entry.path);
const untrustedOf = (command: string): string | undefined => analyzeShellCommand(command, '/home/tester').untrusted;

const OUTSIDE_REASON = 'outside the workspace';
const POLICY_REASON = 'is the project policy file';
const DENIED_REASON = '(rule: **/.env)';
const UUDECODE_REASON = 'uudecode writes the path named inside its payload';
const SQLITE_DOT_REASON = 'a sqlite3 dot-command runs or reads paths';
const SQLITE_OPTION_REASON = 'sqlite3 runs a command the analyzer does not follow';
const HISTORY_REASON = 'history writes the history file the analyzer does not see';
const SPLIT_FILTER_REASON = 'split --filter runs a command the analyzer does not follow';
const GIT_TOOL_REASON = 'git difftool and git mergetool run a tool the analyzer does not follow';

/** True when the host has the named command, so a platform-only test can skip instead of fail. */
function hasCommand(name: string): boolean {
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
  git('config', 'difftool.evil.cmd', 'sh -c "echo PWNED"');
}

describe('finding 1: writer flags outside the destination table name a file no rule sees', () => {
  it('records the base64, encode, plutil, textutil, compiler, shuf, openssl, and ruby destinations', () => {
    expect(writesOf('/usr/bin/base64 -o /tmp/out.b64 plain.txt')).toEqual(['/tmp/out.b64']);
    expect(writesOf('base64 -o/tmp/out.b64 plain.txt')).toEqual(['/tmp/out.b64']);
    expect(writesOf('base64 --output /tmp/out.b64 plain.txt')).toEqual(['/tmp/out.b64']);
    expect(writesOf('base64 --output=/tmp/out.b64 plain.txt')).toEqual(['/tmp/out.b64']);
    expect(pathsOf('base64 -i .env -o out.b64')).toContainEqual({ path: '.env', write: false });
    expect(pathsOf('base64 -i.env -oout.b64')).toContainEqual({ path: '.env', write: false });
    expect(pathsOf('base64 --input=.env -o out.b64')).toContainEqual({ path: '.env', write: false });
    // A decode or a stdout encode still only reads.
    expect(writesOf('base64 -d plain.b64')).toEqual([]);
    expect(pathsOf('base64 -d plain.b64')).toContainEqual({ path: 'plain.b64', write: false });

    expect(writesOf('b64encode -o /tmp/out.b64 plain.txt name')).toEqual(['/tmp/out.b64']);
    expect(writesOf('uuencode -o/tmp/out.uu plain.txt name')).toEqual(['/tmp/out.uu']);
    expect(pathsOf('uuencode -o out.uu plain.txt name')).toContainEqual({ path: 'plain.txt', write: false });

    expect(writesOf('plutil -convert xml1 -o /tmp/out.plist note.plist')).toEqual(['/tmp/out.plist']);
    expect(pathsOf('plutil -p note.plist')).toContainEqual({ path: 'note.plist', write: false });

    expect(writesOf('textutil -convert txt -output /tmp/out.txt note.html')).toEqual(['/tmp/out.txt']);
    expect(pathsOf('textutil -convert txt -output out.txt note.html')).toContainEqual({ path: 'note.html', write: false });

    for (const name of ['clang', 'cc', 'gcc', 'g++', 'clang++']) {
      expect(writesOf(`${name} -o /tmp/tiny tiny.c`), name).toEqual(['/tmp/tiny']);
      expect(writesOf(`${name} -o/tmp/tiny tiny.c`), name).toEqual(['/tmp/tiny']);
      expect(pathsOf(`${name} -c tiny.c`), name).toContainEqual({ path: 'tiny.c', write: false });
    }

    expect(writesOf('shuf -o /tmp/out.txt ok.txt')).toEqual(['/tmp/out.txt']);
    expect(writesOf('shuf -o/tmp/out.txt ok.txt')).toEqual(['/tmp/out.txt']);
    expect(writesOf('shuf --output /tmp/out.txt ok.txt')).toEqual(['/tmp/out.txt']);
    expect(writesOf('shuf --output=/tmp/out.txt ok.txt')).toEqual(['/tmp/out.txt']);
    expect(writesOf('shuf ok.txt')).toEqual([]);
    expect(pathsOf('shuf ok.txt')).toEqual([{ path: 'ok.txt', write: false }]);

    expect(writesOf('openssl req -new -keyout /tmp/key.pem')).toEqual(['/tmp/key.pem']);
    expect(writesOf('openssl req -new -keyout/tmp/key.pem')).toEqual(['/tmp/key.pem']);

    // `ruby -i` edits every positional operand, exactly as `perl -i` does.
    expect(writesOf('ruby -i -pe "s/a/b/" a.txt b.txt')).toEqual(['a.txt', 'b.txt']);
    expect(writesOf('ruby -i.bak -e "s/a/b/" a.txt')).toEqual(['a.txt']);
    // Without `-i` the operands are reads, and without `-e` the first one is the script.
    expect(writesOf('ruby script.rb a.txt')).toEqual([]);
    expect(pathsOf('ruby script.rb a.txt')).toContainEqual({ path: 'a.txt', write: false });
    expect(writesOf('ruby -i script.rb a.txt')).toEqual(['a.txt']);
  });

  // BSD `base64` is the spelling that has `-i` and `-o`, so the round trip needs that binary.
  it.skipIf(!existsSync('/usr/bin/base64'))('refuses an outside, a policy, and a denied destination, and keeps the read and stdout forms', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    const outside = path.join(h.root, 'out.b64');
    const policy = h.file('.pi/pi-tools.json');
    try {
      await h.write('plain.txt', 'hello-workspace\n');
      await h.write('.env', 'SECRET_TOKEN=denied\n');
      const before = await readFile(policy, 'utf8');

      const escaped = await h.call('bash', { command: `/usr/bin/base64 -o ${outside} plain.txt` });
      const policyWrite = await h.call('bash', { command: '/usr/bin/base64 -i plain.txt -o .pi/pi-tools.json' });
      const denied = await h.call('bash', { command: `/usr/bin/base64 -i.env -o ${outside}.denied` });
      const encoded = await h.call('bash', { command: '/usr/bin/base64 -i plain.txt -o plain.b64' });
      const decoded = await h.call('bash', { command: '/usr/bin/base64 -d -i plain.b64' });

      expect(escaped.isError).toBe(true);
      expect(textOf(escaped)).toContain(OUTSIDE_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(policyWrite.isError).toBe(true);
      expect(textOf(policyWrite)).toContain(POLICY_REASON);
      expect(await readFile(policy, 'utf8')).toBe(before);
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain(DENIED_REASON);
      expect(existsSync(`${outside}.denied`)).toBe(false);
      expect(encoded.isError).toBeUndefined();
      expect(existsSync(h.file('plain.b64'))).toBe(true);
      expect(decoded.isError).toBeUndefined();
      expect(textOf(decoded)).toContain('hello-workspace');
    } finally {
      await h.cleanup();
    }
  });

  it.skipIf(!hasCommand('shuf'))('refuses shuf -o on the policy file and outside the workspace', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [] } });
    const outside = path.join(h.root, 'shuffled.txt');
    const policy = h.file('.pi/pi-tools.json');
    try {
      await h.write('ok.txt', 'visible\n');
      const before = await readFile(policy, 'utf8');

      const escaped = await h.call('bash', { command: `shuf -o ${outside} ok.txt` });
      const policyWrite = await h.call('bash', { command: 'shuf -o .pi/pi-tools.json ok.txt' });
      const shuffled = await h.call('bash', { command: 'shuf -o shuffled.txt ok.txt' });

      expect(escaped.isError).toBe(true);
      expect(textOf(escaped)).toContain(OUTSIDE_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(policyWrite.isError).toBe(true);
      expect(textOf(policyWrite)).toContain(POLICY_REASON);
      expect(await readFile(policy, 'utf8')).toBe(before);
      expect(shuffled.isError).toBeUndefined();
      expect(await readFile(h.file('shuffled.txt'), 'utf8')).toBe('visible\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: uudecode writes the path its payload names', () => {
  it('refuses uudecode in every form, because the destination is inside a file the analyzer never reads', () => {
    for (const command of ['uudecode ignore.uu', 'uudecode -o out.txt ignore.uu', '/usr/bin/uudecode ignore.uu', 'uudecode < ignore.uu', 'uudecode -o- ignore.uu']) {
      expect(untrustedOf(command), command).toContain(UUDECODE_REASON);
    }
  });

  it.skipIf(!hasCommand('uuencode') || !hasCommand('uudecode'))('leaves the ignore file alone when the payload names it', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [] } });
    try {
      await h.write('plain.txt', 'hello-workspace\n');
      await h.write('.gitignore', 'original-ignore\n');
      await h.write('.piignore', 'original-piignore\n');
      await h.write('ignore.uu', execFileSync('uuencode', ['plain.txt', '.gitignore'], { cwd: h.workspace, encoding: 'utf8' }));
      await h.write('piignore.uu', execFileSync('uuencode', ['plain.txt', '.piignore'], { cwd: h.workspace, encoding: 'utf8' }));
      await h.write('out.uu', execFileSync('uuencode', ['plain.txt', 'decoded.txt'], { cwd: h.workspace, encoding: 'utf8' }));

      const ignore = await h.call('bash', { command: 'uudecode ignore.uu' });
      const piignore = await h.call('bash', { command: 'uudecode piignore.uu' });
      const named = await h.call('bash', { command: 'uudecode -o decoded.txt out.uu' });

      expect(ignore.isError).toBe(true);
      expect(textOf(ignore)).toContain(UUDECODE_REASON);
      expect(await readFile(h.file('.gitignore'), 'utf8')).toBe('original-ignore\n');
      expect(piignore.isError).toBe(true);
      expect(textOf(piignore)).toContain(UUDECODE_REASON);
      expect(await readFile(h.file('.piignore'), 'utf8')).toBe('original-piignore\n');
      expect(named.isError).toBe(true);
      expect(existsSync(h.file('decoded.txt'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: sqlite3 dot-commands and their option channels run unseen paths', () => {
  it('refuses a dot-command operand and the -cmd, -init, and -A channels, and keeps the SQL forms', () => {
    for (const command of [
      'sqlite3 :memory: ".shell cat .env"',
      'sqlite3 :memory: ".output /tmp/out.txt" "select 1;"',
      'sqlite3 app.db ".read /tmp/secret.sql"',
      'sqlite3 app.db ".import /tmp/secret.txt t"',
      'sqlite3 -readonly app.db ".dump"',
    ]) {
      expect(untrustedOf(command), command).toContain(SQLITE_DOT_REASON);
    }
    for (const command of ['sqlite3 -cmd ".print hi" app.db "select 1;"', 'sqlite3 -init setup.sql app.db "select 1;"', 'sqlite3 -A app.db']) {
      expect(untrustedOf(command), command).toContain(SQLITE_OPTION_REASON);
    }

    for (const command of ['sqlite3 app.db "create table t(x);"', 'sqlite3 :memory: "create table t(x);"', 'sqlite3 -readonly app.db "select 1;"', 'sqlite3 -help']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
    expect(writesOf('sqlite3 app.db "select 1;"')).toEqual(['app.db']);
    expect(pathsOf('sqlite3 -readonly app.db "select 1;"')).toEqual([{ path: 'app.db', write: false }]);
  });

  it.skipIf(!hasCommand('sqlite3'))('runs no shell and writes no output file from a dot-command', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    const outside = path.join(h.root, 'sq.txt');
    try {
      await h.write('.env', 'SECRET_TOKEN=denied\n');
      const shell = await h.call('bash', { command: `sqlite3 :memory: ".shell cat .env > ${outside}"` });
      const output = await h.call('bash', { command: `sqlite3 :memory: ".output ${outside}" "select 'secret-row';"` });
      const plain = await h.call('bash', { command: "sqlite3 app.db 'create table t(x);'" });

      expect(shell.isError).toBe(true);
      expect(textOf(shell)).toContain(SQLITE_DOT_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(output.isError).toBe(true);
      expect(textOf(output)).toContain(SQLITE_DOT_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(plain.isError).toBeUndefined();
      expect(existsSync(h.file('app.db'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: history -w truncates a file the analyzer never names', () => {
  it('records -w and -a as writes, -r and -n as reads, and refuses a write with no file', () => {
    expect(writesOf('history -w /tmp/history.txt')).toEqual(['/tmp/history.txt']);
    expect(writesOf('history -a /tmp/history.txt')).toEqual(['/tmp/history.txt']);
    expect(writesOf('history -aw /tmp/history.txt')).toEqual(['/tmp/history.txt']);
    expect(writesOf('history -wa /tmp/history.txt')).toEqual(['/tmp/history.txt']);
    expect(pathsOf('history -r /tmp/history.txt')).toEqual([{ path: '/tmp/history.txt', write: false }]);
    expect(pathsOf('history -n /tmp/history.txt')).toEqual([{ path: '/tmp/history.txt', write: false }]);

    // The default destination is HISTFILE, which the analyzer never sees.
    for (const command of ['history -w', 'history -a', 'history -wa', 'history -c -w']) {
      expect(untrustedOf(command), command).toContain(HISTORY_REASON);
    }
    for (const command of ['history', 'history -c', 'history -d 10', 'history -p "echo hi"', 'history -r /tmp/history.txt']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
    // A HISTFILE assignment is the same unseen destination in another spelling.
    expect(untrustedOf('HISTFILE=/tmp/history.txt history -w')).toContain('HISTFILE sets a file the analyzer does not read');
    expect(untrustedOf('export HISTFILE=/tmp/history.txt; history -a')).toContain('HISTFILE sets a file the analyzer does not read');
  });

  it('leaves an outside history file untouched', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [] } });
    const outside = path.join(h.root, 'history.txt');
    try {
      await h.write('plain.txt', 'hello\n');
      await h.call('bash', { command: `printf 'KEEP-ME\\n' > ${path.join(h.workspace, 'seed.txt')}` });
      const seed = await readFile(h.file('seed.txt'), 'utf8');
      expect(seed).toBe('KEEP-ME\n');

      const written = await h.call('bash', { command: `history -w ${outside}` });
      const appended = await h.call('bash', { command: `history -a ${outside}` });
      const cleared = await h.call('bash', { command: 'history -c' });

      expect(written.isError).toBe(true);
      expect(textOf(written)).toContain(OUTSIDE_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(appended.isError).toBe(true);
      expect(textOf(appended)).toContain(OUTSIDE_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(cleared.isError).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5: split --filter runs a command the analyzer never reads', () => {
  it('refuses --filter in both spellings and keeps ordinary split working', () => {
    for (const command of [`split -l1 --filter='sh -c "echo PWNED > /tmp/x"' data.txt`, `split -l1 --filter 'sh -c "echo PWNED"' data.txt`, `split --filter='cat > .git/hooks/pre-commit' data.txt`, `split -b1 --filter=cat data.txt`]) {
      expect(untrustedOf(command), command).toContain(SPLIT_FILTER_REASON);
      expect(writesOf(command), command).toEqual([]);
    }
    expect(untrustedOf('split -l1 data.txt')).toBeUndefined();
    expect(untrustedOf('split -l 1 data.txt chunk-')).toBeUndefined();
    expect(writesOf('split -l 1 data.txt /tmp/chunk-')).toEqual(['/tmp/chunk-']);
  });

  it('writes no outside file and no hook when the filter names one', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    const outside = path.join(h.root, 'outside.txt');
    const leak = path.join(h.root, 'leak.txt');
    try {
      await h.write('data.txt', 'a\nb\nc\n');
      await h.write('.env', 'SECRET_TOKEN=denied\n');
      await h.write('.git/hooks/pre-commit', '#!/bin/sh\necho original\n');

      const written = await h.call('bash', { command: `split -l1 --filter='sh -c "echo PWNED > ${outside}"' data.txt` });
      const hook = await h.call('bash', { command: `split -l1 --filter='cat > .git/hooks/pre-commit' data.txt` });
      const read = await h.call('bash', { command: `split -l1 --filter='sh -c "cat .env > ${leak}"' data.txt` });

      expect(written.isError).toBe(true);
      expect(textOf(written)).toContain(SPLIT_FILTER_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(hook.isError).toBe(true);
      expect(textOf(hook)).toContain(SPLIT_FILTER_REASON);
      expect(await readFile(h.file('.git/hooks/pre-commit'), 'utf8')).toBe('#!/bin/sh\necho original\n');
      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain(SPLIT_FILTER_REASON);
      expect(existsSync(leak)).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: git difftool and git mergetool run an external tool', () => {
  it('refuses both subcommands in every form and keeps ordinary git working', () => {
    for (const command of [
      'git difftool --extcmd=evil HEAD',
      'git difftool -y --extcmd="sh -c evil" HEAD~1 HEAD',
      'git difftool HEAD~1 HEAD',
      "git -c difftool.evil.cmd='sh -c evil' difftool -y -t evil HEAD~1 HEAD",
      'git mergetool',
      'git mergetool --tool=evil',
    ]) {
      expect(untrustedOf(command), command).toContain(GIT_TOOL_REASON);
    }
    for (const command of ['git status', 'git diff HEAD~1 HEAD', 'git log --oneline', 'git config --get difftool.evil.cmd']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('runs no external tool through the bash or the git tool', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [] } });
    const outside = path.join(h.root, 'difftool.txt');
    try {
      await h.write('f.txt', 'one\n');
      await initRepo(h.workspace);
      execFileSync('git', ['add', 'f.txt'], { cwd: h.workspace, encoding: 'utf8' });
      execFileSync('git', ['commit', '-qm', 'one'], { cwd: h.workspace, encoding: 'utf8' });
      await h.write('f.txt', 'two\n');
      execFileSync('git', ['commit', '-qam', 'two'], { cwd: h.workspace, encoding: 'utf8' });

      const extcmd = `sh -c 'echo PWNED > ${outside}'`;
      const bash = await h.call('bash', { command: `git difftool -y --extcmd=${extcmd} HEAD~1 HEAD` });
      const tool = await h.call('git', { subcommand: 'difftool', args: ['-y', `--extcmd=${extcmd}`, 'HEAD~1', 'HEAD'] });
      const config = await h.call('bash', { command: `git -c difftool.evil.cmd='sh -c "echo PWNED > ${outside}"' difftool -y -t evil HEAD~1 HEAD` });
      const status = await h.call('git', { subcommand: 'status', args: [] });

      expect(bash.isError).toBe(true);
      expect(textOf(bash)).toContain(GIT_TOOL_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(tool.isError).toBe(true);
      expect(textOf(tool)).toContain(GIT_TOOL_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(config.isError).toBe(true);
      expect(textOf(config)).toContain(GIT_TOOL_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(status.isError).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: equals-form path values skip the operand extraction', () => {
  it('records grep --file= and -fFILE as reads, and sort -o= and --output= as writes', () => {
    for (const command of ['grep --file=.env needle.txt', 'grep -f.env needle.txt', 'grep -f .env needle.txt']) {
      expect(pathsOf(command), command).toContainEqual({ path: '.env', write: false });
      expect(untrustedOf(command), command).toBeUndefined();
    }
    expect(pathsOf('egrep --file=.env needle.txt')).toContainEqual({ path: '.env', write: false });
    for (const command of ['sort -o=/tmp/out.txt', 'sort --output=/tmp/out.txt', 'sort -o /tmp/out.txt', 'sort --output /tmp/out.txt']) {
      expect(writesOf(command), command).toEqual(['/tmp/out.txt']);
    }
    expect(writesOf('sort')).toEqual([]);
  });

  it('refuses the denied grep file and the outside sort output', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    const outside = path.join(h.root, 'escaped.txt');
    try {
      await h.write('.env', 'DENIED_ENV_BYTES=round16\n');
      await h.write('needle.txt', 'DENIED_ENV_BYTES=round16\n');

      const space = await h.call('bash', { command: 'grep -f .env needle.txt' });
      const equals = await h.call('bash', { command: 'grep --file=.env needle.txt' });
      const attached = await h.call('bash', { command: 'grep -f.env needle.txt' });
      const sorted = await h.call('bash', { command: `printf 'outside-bytes' | sort -o=${outside}` });
      const sortedLong = await h.call('bash', { command: `printf 'outside-bytes' | sort --output ${outside}` });
      const inside = await h.call('bash', { command: `printf 'b\\na\\n' | sort -o sorted.txt` });

      for (const result of [space, equals, attached]) {
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(DENIED_REASON);
      }
      expect(sorted.isError).toBe(true);
      expect(textOf(sorted)).toContain(OUTSIDE_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(sortedLong.isError).toBe(true);
      expect(textOf(sortedLong)).toContain(OUTSIDE_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(inside.isError).toBeUndefined();
      expect(await readFile(h.file('sorted.txt'), 'utf8')).toBe('a\nb\n');
    } finally {
      await h.cleanup();
    }
  });
});
