import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the sixth adversarial pass, shell analysis and URL rules. Each test names the finding it locks down. */

const fetchStub: typeof globalThis.fetch = async (input) => new Response(`BODY for ${String(input)}`, { status: 200, headers: { 'content-type': 'text/plain' } });

describe('finding 1: a command substitution inside an expansion is refused', () => {
  it('refuses $(...) and backticks inside ${...} and $((...)), and keeps plain expansions', async () => {
    for (const command of ['echo ${unset_var:=$(id)}', 'echo ${unset_var:-`id`}', 'echo ${FOO:-"$(id)"}', 'echo ${foo:-${bar:-$(id)}}', 'echo $((1+$(id)))', 'echo ${FOO:-$((1+$(id)))}']) {
      const analysis = analyzeShellCommand(command);
      expect(analysis.untrusted, command).toContain('command substitution');
      expect(analysis.segments, command).toContain('id');
    }
    expect(analyzeShellCommand('echo ${FOO:-$(echo secret-value)}').untrusted).toContain('command substitution');
    expect(analyzeShellCommand('echo ${FOO:-$(echo secret-value)}').segments).toContain('echo secret-value');
    expect(analyzeShellCommand('echo ${FOO:-$(cat secret.txt)}').segments).toContain('cat secret.txt');
    expect(analyzeShellCommand("echo ${FOO:-'$(id)'}").untrusted).toBeUndefined();
    expect(analyzeShellCommand('echo ${FOO:-text}').untrusted).toBeUndefined();
    expect(analyzeShellCommand('echo ${FOO}').untrusted).toBeUndefined();
    expect(analyzeShellCommand('i=$((1+1)); echo "n=$i"').untrusted).toBeUndefined();

    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'id*' }] } });
    try {
      for (const command of ['echo ${unset_var:=$(id)}', 'echo ${unset_var:-`id`}']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('command substitution');
        expect(textOf(result), command).not.toContain('uid=');
      }
      const quoted = await h.call('bash', { command: "echo ${FOO:-'$(id)'}" });
      expect(quoted.isError).toBeUndefined();
      expect(textOf(quoted)).toContain('$(id)');
      expect(textOf(quoted)).not.toContain('uid=');
      const plain = await h.call('bash', { command: 'echo ${FOO:-text}' });
      expect(textOf(plain)).toContain('text');
      const arithmetic = await h.call('bash', { command: 'i=$((1+1)); echo "n=$i"' });
      expect(textOf(arithmetic)).toContain('n=2');
    } finally {
      await h.cleanup();
    }

    const readRule = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/secret.txt' }] } });
    try {
      await readRule.write('secret.txt', 'TOP-SECRET\n');
      const hidden = await readRule.call('bash', { command: 'echo ${FOO:-$(cat secret.txt)}' });
      expect(hidden.isError).toBe(true);
      expect(textOf(hidden)).toContain('command substitution');
      expect(textOf(hidden)).not.toContain('TOP-SECRET');
    } finally {
      await readRule.cleanup();
    }
  });
});

describe('finding 2: export and declare cannot set startup variables', () => {
  it('refuses BASH_ENV, ENV, CDPATH, and IFS through export, declare, typeset, and readonly', async () => {
    const commands = ['export BASH_ENV=x', 'export ENV=x', 'export CDPATH=/tmp', 'export IFS=:', 'declare BASH_ENV=x', 'declare -x ENV=x', 'typeset CDPATH=/tmp', 'readonly IFS=:'];
    for (const command of commands) {
      expect(analyzeShellCommand(command).untrusted, command).toContain('changes how the shell finds commands');
    }
    expect(analyzeShellCommand('export FOO=1').untrusted).toBeUndefined();
    expect(analyzeShellCommand('declare -x FOO=1').untrusted).toBeUndefined();

    const h = await createHarness();
    try {
      const startup = h.file('startup.sh');
      await writeFile(startup, 'id\n');
      const sourced = await h.call('bash', { command: `printf '%s\\n' id > startup.sh; export BASH_ENV="$PWD/startup.sh"; bash -c true` });
      expect(sourced.isError).toBe(true);
      expect(textOf(sourced)).toContain('BASH_ENV');
      expect(textOf(sourced)).not.toContain('uid=');

      const outside = path.join(h.root, 'outside');
      await mkdir(path.join(outside, 'sub'), { recursive: true });
      await mkdir(path.join(h.workspace, 'sub'), { recursive: true });
      const cdpath = await h.call('bash', { command: `export CDPATH=${outside}; cd sub && pwd -P` });
      expect(cdpath.isError).toBe(true);
      expect(textOf(cdpath)).toContain('CDPATH');
      expect(textOf(cdpath)).not.toContain(`${outside}/sub`);

      const plain = await h.call('bash', { command: 'export FOO=1; echo "$FOO"' });
      expect(plain.isError).toBeUndefined();
      expect(textOf(plain)).toContain('1');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: a link whose target is outside is a write outside', () => {
  it('refuses a link created and used in the same command', async () => {
    const h = await createHarness({ config: { mode: 'auto' } });
    const outside = path.join(h.root, 'linked-file');
    const outsideDir = path.join(h.root, 'linked-dir');
    try {
      const created = `ln -s ${outside} marker && printf PWNED > marker`;
      expect(analyzeShellCommand(created).paths.some((entry) => entry.path === outside && entry.write)).toBe(true);
      const createdResult = await h.call('bash', { command: created });
      expect(createdResult.isError).toBe(true);
      expect(textOf(createdResult)).toContain('outside the workspace');
      expect(textOf(createdResult)).not.toContain('PWNED');
      await expect(readFile(outside, 'utf8')).rejects.toThrow();

      await mkdir(outsideDir, { recursive: true });
      const cd = `ln -s ${outsideDir} link && cd link && pwd -P && printf PWNED > escaped.txt`;
      const cdResult = await h.call('bash', { command: cd });
      expect(cdResult.isError).toBe(true);
      expect(textOf(cdResult)).not.toContain(outsideDir);
      await expect(readFile(path.join(outsideDir, 'escaped.txt'), 'utf8')).rejects.toThrow();

      const inside = await h.call('bash', { command: 'ln -s ./a ./b && test -L ./b' });
      expect(inside.isError).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });

  it('still refuses a write through a pre-existing link', async () => {
    const h = await createHarness({ config: { mode: 'auto' } });
    const outside = path.join(h.root, 'prelinked');
    try {
      await symlink(outside, h.file('marker'));
      const result = await h.call('bash', { command: 'printf PWNED > marker' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('outside the workspace');
      await expect(readFile(outside, 'utf8')).rejects.toThrow();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: cp, mv, and ln target-directory flags are writes', () => {
  it('gates -t and --target-directory and keeps an inside copy', async () => {
    const dir = path.join('/tmp', `pi-tools-target-${process.pid}`);
    await mkdir(dir, { recursive: true });
    const h = await createHarness({ config: { mode: 'auto' } });
    try {
      await h.write('payload.txt', 'PWNED\n');
      const commands = [`cp --target-directory=${dir} payload.txt`, `cp -t ${dir} payload.txt`, `cp -t${dir} payload.txt`, `cp --target-directory ${dir} payload.txt`, `mv --target-directory=${dir} payload.txt`, `ln -t ${dir} payload.txt`];
      for (const command of commands) {
        const paths = analyzeShellCommand(command).paths;
        expect(
          paths.some((entry) => entry.write && entry.path.startsWith(dir)),
          command,
        ).toBe(true);
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('outside the workspace');
      }
      expect(await readFile(h.file('payload.txt'), 'utf8')).toBe('PWNED\n');
      expect(existsSync(path.join(dir, 'payload.txt'))).toBe(false);

      await mkdir(h.file('dest'), { recursive: true });
      const copied = await h.call('bash', { command: 'cp --target-directory=dest payload.txt' });
      expect(copied.isError).toBeUndefined();
      expect(await readFile(h.file('dest/payload.txt'), 'utf8')).toBe('PWNED\n');
    } finally {
      await h.cleanup();
      await rm(dir, { recursive: true, force: true });
    }

    const denied = await createHarness({
      config: { mode: 'unrestricted', rules: [{ kind: 'write', action: 'deny', pattern: `${dir}/**` }] },
    });
    try {
      await mkdir(dir, { recursive: true });
      await denied.write('payload.txt', 'PWNED\n');
      const hidden = await denied.call('bash', { command: `cp --target-directory=${dir} payload.txt` });
      expect(hidden.isError).toBe(true);
      expect(textOf(hidden)).toContain(`rule: ${dir}/**`);
      await expect(readFile(path.join(dir, 'payload.txt'), 'utf8')).rejects.toThrow();

      await denied.write('secret.txt', 'TOP-SECRET\n');
      const strict = await createHarness({
        config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/secret.txt' }] },
      });
      try {
        await strict.write('secret.txt', 'TOP-SECRET\n');
        await mkdir(strict.file('dest'), { recursive: true });
        const read = await strict.call('bash', { command: 'cp -t dest secret.txt' });
        expect(read.isError).toBe(true);
        expect(textOf(read)).toContain('rule: **/secret.txt');
        await expect(readFile(strict.file('dest/secret.txt'), 'utf8')).rejects.toThrow();
      } finally {
        await strict.cleanup();
      }
    } finally {
      await denied.cleanup();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('finding 5: an alias cannot rebind a command', () => {
  it('refuses alias with an argument and keeps alias and unalias otherwise', async () => {
    expect(analyzeShellCommand('alias true=id').untrusted).toContain('cannot see through');
    expect(analyzeShellCommand('alias').untrusted).toBeUndefined();
    expect(analyzeShellCommand('unalias true').untrusted).toBeUndefined();

    const h = await createHarness({ config: { mode: 'auto', rules: [{ kind: 'exec', action: 'deny', pattern: 'id*' }] } });
    try {
      const rebound = await h.call('bash', { command: 'shopt -s expand_aliases\nalias true=id\ntrue' });
      expect(rebound.isError).toBe(true);
      expect(textOf(rebound)).toContain('cannot see through');
      expect(textOf(rebound)).not.toContain('uid=');

      const listing = await h.call('bash', { command: 'alias' });
      expect(listing.isError).toBeUndefined();
      const cleared = await h.call('bash', { command: 'unalias -a' });
      expect(textOf(cleared)).not.toContain('cannot see through');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: a git config value that starts with ! is a shell command', () => {
  it('refuses inline git -c shell aliases and keeps ordinary git -c', async () => {
    for (const command of ["git -c 'alias.pwn=!id' pwn", 'git -c alias.pwn=!id pwn', 'git -calias.pwn=!id pwn', 'git -c alias.pwn !id pwn']) {
      expect(analyzeShellCommand(command).untrusted, command).toContain('does not follow');
    }
    expect(analyzeShellCommand('git -c user.name=Ada status').untrusted).toBeUndefined();

    const h = await createHarness({ config: { mode: 'auto', rules: [{ kind: 'exec', action: 'deny', pattern: 'id*' }] } });
    try {
      const pwn = await h.call('bash', { command: "git -c 'alias.pwn=!id' pwn" });
      expect(pwn.isError).toBe(true);
      expect(textOf(pwn)).toContain('does not follow');
      expect(textOf(pwn)).not.toContain('uid=');

      await h.call('bash', { command: 'git init' });
      const ordinary = await h.call('bash', { command: 'git -c user.name=Ada status' });
      expect(textOf(ordinary)).not.toContain('does not follow');
      expect(textOf(ordinary)).not.toContain('Blocked by permissions');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: find -delete and truncate are writes', () => {
  it('asks before deleting or truncating outside the workspace and still reads with find', async () => {
    const h = await createHarness({ hasUI: false });
    try {
      const outside = path.join(h.root, 'outside');
      await mkdir(outside, { recursive: true });
      const victim = path.join(outside, 'victim.txt');
      const plain = path.join(outside, 'plain.txt');
      await writeFile(victim, 'outside data\n');
      await writeFile(plain, 'outside data\n');

      const findDelete = `find ${outside} -name victim.txt -delete`;
      expect(analyzeShellCommand(findDelete).paths.some((entry) => entry.path === outside && entry.write)).toBe(true);
      const deleted = await h.call('bash', { command: findDelete });
      expect(deleted.isError).toBe(true);
      expect(textOf(deleted)).toContain('outside the workspace');
      expect(await readFile(victim, 'utf8')).toBe('outside data\n');

      const listed = await h.call('bash', { command: `find ${outside} -name victim.txt` });
      expect(listed.isError).toBeUndefined();
      expect(textOf(listed)).toContain('victim.txt');

      const truncated = await h.call('bash', { command: `truncate -s 0 ${plain}` });
      expect(truncated.isError).toBe(true);
      expect(textOf(truncated)).toContain('outside the workspace');
      expect((await readFile(plain)).byteLength).toBeGreaterThan(0);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 8: indirect wrappers the analyzer does not follow are refused', () => {
  it('refuses caffeinate and the other command wrappers', async () => {
    for (const name of ['caffeinate', 'doas', 'runuser', 'su', 'strace', 'ltrace', 'chrt', 'taskset', 'numactl', 'eatmydata', 'fakeroot', 'firejail', 'bwrap']) {
      expect(analyzeShellCommand(`${name} echo x`).untrusted, name).toContain('does not follow');
    }

    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] }, hasUI: false });
    try {
      const wrapped = await h.call('bash', { command: 'caffeinate -i echo secret-value' });
      expect(wrapped.isError).toBe(true);
      expect(textOf(wrapped)).toContain('does not follow');
      expect(textOf(wrapped)).not.toContain('secret-value');

      const outside = path.join(h.root, 'outside.txt');
      const write = await h.call('bash', { command: `caffeinate -i touch ${outside}` });
      expect(write.isError).toBe(true);
      expect(existsSync(outside)).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 9: a URL rule covers the same path with any port, query, or fragment', () => {
  it('denies beneath a host or path prefix and does not cross a segment boundary', async () => {
    const cases: [string, string, boolean][] = [
      ['https://example.com/api', 'https://example.com/api?x=1', true],
      ['https://example.com/api', 'https://example.com/api#frag', true],
      ['https://example.com/api', 'https://example.com/api/secret', true],
      ['https://example.com/api', 'https://example.com:8443/api?x=1', true],
      ['https://example.com/api', 'https://example.com/api2', false],
      ['https://example.com', 'https://example.com:8443/x', true],
      ['https://example.com:443/api', 'https://example.com/api', true],
      ['https://example.com:8443/api', 'https://example.com:8443/api/x', true],
      ['https://example.com:8443/api', 'https://example.com/api', false],
      ['https://example.com/api', 'http://example.com/api', false],
    ];
    for (const [pattern, url, denied] of cases) {
      const h = await createHarness({
        config: { mode: 'unrestricted', rules: [{ kind: 'read', action: 'deny', pattern }] },
        fetch: fetchStub,
      });
      try {
        const result = await h.call('web_fetch', { url });
        expect(result.isError, `${pattern} -> ${url}`).toBe(denied ? true : undefined);
        if (denied) {
          expect(textOf(result), `${pattern} -> ${url}`).not.toContain('BODY for');
        } else {
          expect(textOf(result), `${pattern} -> ${url}`).toContain('BODY for');
        }
      } finally {
        await h.cleanup();
      }
    }

    const wildcard = await createHarness({
      config: { mode: 'unrestricted', rules: [{ kind: 'read', action: 'deny', pattern: 'https://evil.example/*' }] },
      fetch: fetchStub,
    });
    try {
      const result = await wildcard.call('web_fetch', { url: 'https://evil.example/a/b' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).not.toContain('BODY for');
    } finally {
      await wildcard.cleanup();
    }
  });
});

describe('finding 10: a full read fences any size for the whole session', () => {
  it('refuses a later write after the old lifetime and after a read or write above 8 MiB', async () => {
    const realNow = Date.now;
    let skew = 0;
    Date.now = () => realNow() + skew;
    const timed = await createHarness();
    try {
      await timed.write('f.txt', 'original\n');
      expect((await timed.call('read', { path: 'f.txt' })).isError).toBeUndefined();
      await timed.write('f.txt', 'externally changed\n');
      skew = 61_000;
      const stale = await timed.call('write', { path: 'f.txt', content: 'agent overwrite\n' });
      expect(stale.isError).toBe(true);
      expect(textOf(stale)).toContain('changed on disk');
      expect(await readFile(timed.file('f.txt'), 'utf-8')).toBe('externally changed\n');
    } finally {
      Date.now = realNow;
      await timed.cleanup();
    }

    const large = await createHarness();
    try {
      const big = `${'x'.repeat(99)}\n`.repeat(90_000);
      await writeFile(large.file('big.log'), big, 'utf-8');
      expect((await large.call('read', { path: 'big.log' })).isError).toBeUndefined();
      await writeFile(large.file('big.log'), 'externally changed\n', 'utf-8');
      const afterRead = await large.call('write', { path: 'big.log', content: 'agent overwrite\n' });
      expect(afterRead.isError).toBe(true);
      expect(await readFile(large.file('big.log'), 'utf-8')).toBe('externally changed\n');

      const payload = `${'y'.repeat(99)}\n`.repeat(90_000);
      expect((await large.call('write', { path: 'written.log', content: payload })).isError).toBeUndefined();
      await writeFile(large.file('written.log'), 'externally changed\n', 'utf-8');
      const afterWrite = await large.call('write', { path: 'written.log', content: 'agent overwrite\n' });
      expect(afterWrite.isError).toBe(true);
      expect(await readFile(large.file('written.log'), 'utf-8')).toBe('externally changed\n');
    } finally {
      await large.cleanup();
    }
  });
});

describe('finding 11: deleting a symlink does not mark its target absent', () => {
  it('lets a later write to the surviving target succeed', async () => {
    const h = await createHarness();
    try {
      await h.write('real.txt', 'target content\n');
      await symlink('real.txt', h.file('link.txt'));
      const removed = await h.call('delete', { path: 'link.txt' });
      expect(removed.isError).toBeUndefined();
      expect(await readFile(h.file('real.txt'), 'utf-8')).toBe('target content\n');
      await expect(readFile(h.file('link.txt'))).rejects.toThrow();

      const write = await h.call('write', { path: 'real.txt', content: 'new content\n' });
      expect(write.isError).toBeUndefined();
      expect(await readFile(h.file('real.txt'), 'utf-8')).toBe('new content\n');

      await h.write('gone.txt', 'x\n');
      expect((await h.call('delete', { path: 'gone.txt' })).isError).toBeUndefined();
      await h.write('gone.txt', 'recreated\n');
      const stale = await h.call('write', { path: 'gone.txt', content: 'nope\n' });
      expect(stale.isError).toBe(true);
      expect(textOf(stale)).toContain('changed on disk');
      expect(await readFile(h.file('gone.txt'), 'utf-8')).toBe('recreated\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 12: grep limit and total count matches, not context lines', () => {
  it('returns the matched line and its context when the limit is 1', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'one\ntwo\nneedle\nfour\nfive\n');
      const wide = await h.call('grep', { pattern: 'needle', context: 1 });
      const wideDetails = wide.details as { total?: number; matches?: { isContext: boolean; text: string }[] };
      expect(wideDetails.total).toBe(1);
      expect(textOf(wide)).toContain('a.txt:3: needle');
      expect(textOf(wide)).toContain('a.txt-2- two');
      expect(textOf(wide)).toContain('a.txt-4- four');

      const one = await h.call('grep', { pattern: 'needle', context: 1, limit: 1 });
      const oneDetails = one.details as { total?: number; limitReached?: boolean; matches?: { isContext: boolean }[] };
      expect(oneDetails.total).toBe(1);
      expect(oneDetails.limitReached).toBeUndefined();
      expect(textOf(one)).toContain('a.txt:3: needle');
      expect(textOf(one)).toContain('a.txt-2- two');
      expect(oneDetails.matches?.filter((match) => !match.isContext)).toHaveLength(1);
      expect(textOf(one)).not.toContain('results limit reached');

      const two = await h.call('grep', { pattern: 'needle', context: 2, limit: 2 });
      const twoDetails = two.details as { total?: number; matches?: { isContext: boolean; line: number }[] };
      expect(twoDetails.total).toBe(1);
      expect(textOf(two)).toContain('a.txt:3: needle');
      expect(textOf(two)).toContain('a.txt-1- one');
      expect(textOf(two)).toContain('a.txt-5- five');
      const lines = new Set(twoDetails.matches?.map((match) => match.line));
      expect(lines.size).toBe(twoDetails.matches?.length);

      await h.write('b.txt', 'needle\nalpha\nbeta\ngamma\nneedle\nomega\n');
      const limited = await h.call('grep', { pattern: 'needle', path: 'b.txt', context: 1, limit: 1 });
      const limitedDetails = limited.details as { total?: number; limitReached?: boolean; matches?: { isContext: boolean; text: string }[] };
      expect(limitedDetails.total).toBe(2);
      expect(limitedDetails.limitReached).toBe(true);
      expect(textOf(limited)).toContain('1 results limit reached');
      expect(limitedDetails.matches?.filter((match) => !match.isContext)).toHaveLength(1);
      expect(textOf(limited)).toContain('needle');
      expect(textOf(limited)).not.toContain('omega');

      const next = await h.call('grep', { pattern: 'needle', path: 'b.txt', context: 1, offset: 1 });
      expect(textOf(next)).toContain('b.txt:5: needle');
      expect(textOf(next)).not.toContain('b.txt:1:');
      expect((next.details as { total?: number }).total).toBe(2);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 13: a patch keeps untouched line endings and a requested trailing newline', () => {
  it('preserves mixed endings, adds a newline git would add, and still honors the marker', async () => {
    const mixed = await createHarness();
    try {
      await mixed.write('f.txt', 'a\r\nb\r\nc\n');
      const diff = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c', ''].join('\n');
      const result = await mixed.call('apply_patch', { patch: diff });
      expect(result.isError).toBeUndefined();
      expect(await readFile(mixed.file('f.txt'), 'utf-8')).toBe('a\r\nB\r\nc\n');
    } finally {
      await mixed.cleanup();
    }

    const added = await createHarness();
    try {
      await added.write('f.txt', 'a\nb');
      const diff = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,2 +1,3 @@', ' a', '-b', '\\ No newline at end of file', '+b', '+c', ''].join('\n');
      const result = await added.call('apply_patch', { patch: diff });
      expect(result.isError).toBeUndefined();
      expect(await readFile(added.file('f.txt'), 'utf-8')).toBe('a\nb\nc\n');
    } finally {
      await added.cleanup();
    }

    const marked = await createHarness();
    try {
      await marked.write('f.txt', 'foo\n');
      const patch = ['*** Begin Patch', '*** Update File: f.txt', '@@', '-foo', '+bar', '\\ No newline at end of file', '*** End Patch'].join('\n');
      const result = await marked.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(marked.file('f.txt'), 'utf-8')).toBe('bar');
    } finally {
      await marked.cleanup();
    }
  });
});

describe('finding 14: ls follows a directory symlink and skips one that leaves the workspace', () => {
  it('lists a linked directory with a slash, walks it, and hides an ignored or outside target', async () => {
    const linked = await createHarness();
    try {
      await linked.write('real/inner.txt', 'x\n');
      await symlink('real', linked.file('linkdir'));
      const top = await linked.call('ls', {});
      expect(textOf(top)).toContain('linkdir/');
      expect(textOf(top)).not.toMatch(/linkdir(?!\/)/);
      const deep = await linked.call('ls', { depth: 2 });
      expect(textOf(deep)).toContain('linkdir/');
      expect(textOf(deep)).toContain('linkdir/inner.txt');
      const entries = (deep.details as { entries?: { path: string; type: string }[] }).entries ?? [];
      expect(entries.find((entry) => entry.path.endsWith('/linkdir'))?.type).toBe('directory');

      const outside = path.join(linked.root, 'outside');
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE\n');
      await symlink(outside, linked.file('escape'));
      const contained = textOf(await linked.call('ls', { depth: 2 }));
      expect(contained).not.toContain('escape');
      expect(contained).not.toContain('secret.txt');
      expect(contained).not.toContain('OUTSIDE');
    } finally {
      await linked.cleanup();
    }

    const ignored = await createHarness();
    try {
      await ignored.write('out/inner.txt', 'needle\n');
      await ignored.write('.piignore', 'out/\n');
      await symlink('out', ignored.file('alias'));
      const listing = textOf(await ignored.call('ls', {}));
      expect(listing).not.toContain('alias');
      expect(listing).not.toContain('out');
      const direct = await ignored.call('ls', { path: 'alias' });
      expect(direct.isError).toBe(true);
      expect(textOf(direct)).toContain('.piignore');
    } finally {
      await ignored.cleanup();
    }
  });
});

describe('finding 15: read text includes the digest', () => {
  it('prints the sha256 on the line after the file footer', async () => {
    const h = await createHarness();
    try {
      const content = 'line one\nline two\n';
      await h.write('a.txt', content);
      const digest = createHash('sha256').update(content).digest('hex');
      const result = await h.call('read', { path: 'a.txt' });
      const text = textOf(result);
      expect(text).toContain('[file: 2 lines, 18 bytes]');
      expect(text).toContain(`\n[sha256: ${digest}]`);
      expect((result.details as { metadata?: { sha256?: string } }).metadata?.sha256).toBe(digest);

      const ranged = textOf(await h.call('read', { path: 'a.txt', offset: 2, limit: 1 }));
      expect(ranged).toContain('[file: 2 lines, 18 bytes · lines 2-2]');
      expect(ranged).toContain(`[sha256: ${digest}]`);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 16: offset and limit must be integers', () => {
  it('rejects a fractional offset or limit before reading and still accepts 0 and a negative offset', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'line one\nline two\n');
      const fractional = await h.call('read', { path: 'missing.txt', offset: 1.5 });
      expect(fractional.isError).toBe(true);
      expect((fractional.details as { failure?: { kind?: string } }).failure?.kind).toBe('invalid_arguments');
      expect(textOf(fractional)).not.toContain('1.5');

      const fractionalLimit = await h.call('read', { path: 'a.txt', limit: 1.5 });
      expect(fractionalLimit.isError).toBe(true);
      expect((fractionalLimit.details as { failure?: { kind?: string } }).failure?.kind).toBe('invalid_arguments');

      const zero = textOf(await h.call('read', { path: 'a.txt', limit: 0 }));
      expect(zero).toContain('[file:');
      expect(zero).not.toContain('1.5');
      const tail = textOf(await h.call('read', { path: 'a.txt', offset: -1 }));
      expect(tail).toContain('lines 2-2');
      expect(tail).toContain('line two');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 17: save_resource rejects malformed base64', () => {
  it('writes nothing for invalid base64 and still accepts padded input', async () => {
    const h = await createHarness();
    try {
      for (const content of ['not base64!!!', 'A', '%%%']) {
        const name = `bad-${content.replace(/\W/g, '_')}.bin`;
        const result = await h.call('save_resource', { path: name, content, encoding: 'base64' });
        expect(result.isError, content).toBe(true);
        expect((result.details as { failure?: { kind?: string } }).failure?.kind, content).toBe('invalid_arguments');
        expect(textOf(result), content).toContain('not valid base64');
        await expect(readFile(h.file(name)), content).rejects.toThrow();
      }
      const ok = await h.call('save_resource', { path: 'ok.bin', content: 'AAAA', encoding: 'base64' });
      expect(ok.isError).toBeUndefined();
      expect([...(await readFile(h.file('ok.bin')))]).toEqual([0, 0, 0]);
      const spaced = await h.call('save_resource', { path: 'spaced.bin', content: 'QQ==\n', encoding: 'base64' });
      expect(spaced.isError).toBeUndefined();
      expect(await readFile(h.file('spaced.bin'), 'utf-8')).toBe('A');
    } finally {
      await h.cleanup();
    }
  });
});
