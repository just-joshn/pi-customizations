import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeCommand, analyzeShellCommand, directoryChanges } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the fifth adversarial pass, shell analysis. Each test names the finding it locks down. */

const user = userInfo();

describe('finding 1: compound syntax cannot hide the command', () => {
  it('matches the body of reserved-word forms against the exec rule', async () => {
    const commands = [
      'if true; then echo secret-value; fi',
      'if false; then true; else echo secret-value; fi',
      'if false; then true; elif true; then echo secret-value; fi',
      '{ echo secret-value; }',
      '! echo secret-value',
      'for i in 1; do echo secret-value; done',
      'while true; do echo secret-value; break; done',
      'until false; do echo secret-value; done',
      'case x in x) echo secret-value ;; esac',
    ];
    for (const command of commands) {
      expect(analyzeCommand(command), command).toContain('echo secret-value');
    }
    expect(analyzeCommand('select i in 1; do echo secret-value; break; done')).toContain('echo secret-value');

    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] } });
    try {
      for (const command of commands) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('rule: echo secret*');
        expect(textOf(result), command).not.toContain('secret-value');
      }
      const allowed = await h.call('bash', { command: 'if true; then echo public; fi' });
      expect(textOf(allowed)).toContain('public');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses unquoted brace expansion and still runs quoted braces', async () => {
    expect(analyzeShellCommand('e{cho,cho} hello').untrusted).toContain('brace expansion');
    expect(analyzeShellCommand("echo '{a,b}'").untrusted).toBeUndefined();
    expect(analyzeShellCommand('echo "{a,b}"').untrusted).toBeUndefined();

    const h = await createHarness();
    try {
      const expanded = await h.call('bash', { command: 'e{cho,cho} hello' });
      expect(expanded.isError).toBe(true);
      expect(textOf(expanded)).toContain('brace expansion');
      expect(textOf(expanded)).not.toContain('hello');

      const quoted = await h.call('bash', { command: "echo '{a,b}'" });
      expect(quoted.isError).toBeUndefined();
      expect(textOf(quoted)).toContain('{a,b}');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: a command substitution in an argument is refused', () => {
  it('refuses unquoted substitutions and backticks, and keeps $NAME and arithmetic', async () => {
    expect(analyzeShellCommand('echo s$(printf e)cret-value').untrusted).toContain('command substitution');
    expect(analyzeShellCommand('echo $(printf secret)-value').untrusted).toContain('command substitution');
    expect(analyzeShellCommand('echo `printf secret-value`').untrusted).toContain('command substitution');
    expect(analyzeShellCommand('FOO=$(printf secret-value) echo "$FOO"').untrusted).toContain('command substitution');
    expect(analyzeShellCommand("echo '$(printf secret)-value'").untrusted).toBeUndefined();
    expect(analyzeShellCommand('echo $HOME').untrusted).toBeUndefined();
    expect(analyzeShellCommand('i=$((1+1)); echo "n=$i"').untrusted).toBeUndefined();
    expect(analyzeShellCommand('$(echo echo) file').untrusted).toBe('the command word comes from an expansion');

    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] } });
    try {
      for (const command of ['echo s$(printf e)cret-value', 'echo $(printf secret)-value', 'echo `printf secret-value`', 'FOO=$(printf secret-value) echo "$FOO"']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).not.toContain('secret-value');
      }
      const literal = await h.call('bash', { command: "echo '$(printf secret)-value'" });
      expect(textOf(literal)).toContain('$(printf secret)-value');
      const named = await h.call('bash', { command: 'NAME=ok; echo "v=$NAME"' });
      expect(textOf(named)).toContain('v=ok');
      const arithmetic = await h.call('bash', { command: 'i=$((1+1)); echo "n=$i"' });
      expect(textOf(arithmetic)).toContain('n=2');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: a here-string substitution still runs', () => {
  it('refuses a substitution in a here-string and keeps plain here-strings', async () => {
    expect(analyzeShellCommand('cat <<< "$(printf secret)"').untrusted).toContain('command substitution');
    expect(analyzeShellCommand('cat <<< $(printf secret)').untrusted).toContain('command substitution');

    const h = await createHarness();
    try {
      const refused = await h.call('bash', { command: 'cat <<< "$(printf secret)"' });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain('command substitution');
      const plain = await h.call('bash', { command: 'cat <<< plain' });
      expect(plain.isError).toBeUndefined();
      expect(textOf(plain)).toContain('plain');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: a backslash-newline is the same word', () => {
  it('blocks the command the shell runs', async () => {
    const command = 'ec\\\nho secret-value';
    expect(analyzeCommand(command)).toContain('echo secret-value');
    expect(analyzeCommand('"ec\\\nho" secret-value')).toContain('echo secret-value');
    expect(analyzeCommand("'ec\\\nho'")).not.toContain('echo secret-value');

    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] } });
    try {
      const result = await h.call('bash', { command });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('rule: echo secret*');
      expect(textOf(result)).not.toContain('secret-value');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: -- is not the inline command', () => {
  it('analyzes the body after the option terminator', async () => {
    const commands = ["bash -c -- 'echo secret-value'", "sh -c -- 'echo secret-value'", "eval -- 'echo secret-value'", "env bash -c -- 'echo secret-value'"];
    for (const command of commands) {
      expect(analyzeCommand(command), command).toContain('echo secret-value');
    }
    expect(analyzeCommand("zsh -c -- 'echo secret-value'")).toContain('echo secret-value');
    expect(analyzeCommand("dash -c -- 'echo secret-value'")).toContain('echo secret-value');

    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] } });
    try {
      for (const command of commands) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('rule: echo secret*');
        expect(textOf(result), command).not.toContain('secret-value');
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5: cd ~user cannot leave the workspace unseen', () => {
  it('refuses another user and resolves the current user', async () => {
    expect(analyzeShellCommand('cd ~nobody && pwd', '/home/user').untrusted).toContain('~nobody');
    expect(analyzeShellCommand('cd ~nobody && pwd', '/home/user').directories).not.toContain('~nobody');
    expect(analyzeShellCommand('cd ~+ && pwd', '/home/user').untrusted).toContain('~+');
    expect(directoryChanges(`cd ~${user.username}`, '/home/user')).toEqual([user.homedir]);
    expect(directoryChanges(`cd ~${user.username}/sub`, '/home/user')).toEqual([`${user.homedir}/sub`]);
    expect(directoryChanges('cd ~', '/home/user')).toEqual(['/home/user']);
    expect(directoryChanges('cd ~/sub', '/home/user')).toEqual(['/home/user/sub']);

    const h = await createHarness({ hasUI: false });
    try {
      const other = await h.call('bash', { command: 'cd ~nobody && pwd' });
      expect(other.isError).toBe(true);
      expect(textOf(other)).toContain('cannot resolve');
      expect(textOf(other)).not.toContain('/var/empty');

      const current = await h.call('bash', { command: `cd ~${user.username} && pwd` });
      expect(current.isError).toBe(true);
      expect(textOf(current)).toContain('outside the workspace');
      expect(textOf(current)).not.toContain(`${user.homedir}\n`);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: env assignments cannot smuggle startup variables', () => {
  it('refuses BASH_ENV, ENV, CDPATH, and IFS after env', async () => {
    expect(analyzeShellCommand('env BASH_ENV=x bash -c true').untrusted).toContain('BASH_ENV');
    expect(analyzeShellCommand('env ENV=x sh -c true').untrusted).toContain('ENV');
    expect(analyzeShellCommand('env CDPATH=/tmp bash -c true').untrusted).toContain('CDPATH');
    expect(analyzeShellCommand('env IFS=: true').untrusted).toContain('IFS');
    expect(analyzeShellCommand('env FOO=1 echo x').untrusted).toBeUndefined();

    const h = await createHarness();
    try {
      const startup = h.file('startup.sh');
      await writeFile(startup, `printf SOURCED > ${JSON.stringify(h.file('marker.txt'))}\n`);
      const sourced = await h.call('bash', { command: `env BASH_ENV=${startup} bash -c true` });
      expect(sourced.isError).toBe(true);
      expect(textOf(sourced)).toContain('BASH_ENV');
      await expect(readFile(h.file('marker.txt'), 'utf8')).rejects.toThrow();

      const envStartup = h.file('env-startup.sh');
      await writeFile(envStartup, `printf SOURCED > ${JSON.stringify(h.file('env-marker.txt'))}\n`);
      const envResult = await h.call('bash', { command: `env ENV=${envStartup} bash -c true` });
      expect(envResult.isError).toBe(true);
      expect(textOf(envResult)).toContain('ENV');
      await expect(readFile(h.file('env-marker.txt'), 'utf8')).rejects.toThrow();

      const outside = path.join(h.root, 'outside');
      await mkdir(path.join(outside, 'sub'), { recursive: true });
      const cdpath = await h.call('bash', { command: `env CDPATH=${outside} bash -c 'cd sub && pwd'` });
      expect(cdpath.isError).toBe(true);
      expect(textOf(cdpath)).toContain('CDPATH');
      expect(textOf(cdpath)).not.toContain(`${outside}/sub`);

      const ifs = await h.call('bash', { command: 'env IFS=: bash -c "touch ran.txt"' });
      expect(ifs.isError).toBe(true);
      expect(textOf(ifs)).toContain('IFS');
      await expect(readFile(h.file('ran.txt'), 'utf8')).rejects.toThrow();

      const plain = await h.call('bash', { command: 'env FOO=1 echo ok' });
      expect(textOf(plain)).toContain('ok');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: literal shell paths obey read and write rules', () => {
  it('refuses outside writes and asks the way write does', async () => {
    const h = await createHarness({ hasUI: false });
    const leaked = path.join('/tmp', `pi-tools-escape-${process.pid}.txt`);
    try {
      const outside = path.join(h.root, 'abs-outside.txt');
      const commands = [
        `echo OUTSIDE > ${JSON.stringify(outside)}`,
        'echo OUTSIDE > ../outside2.txt',
        'echo OUTSIDE >> ../outside-append.txt',
        'touch ../outside3.txt',
        'cp /etc/hosts ../copied.txt',
        'mkdir ../escaped-dir',
        'mv ./inside.txt ../escaped-mv',
        'rm ../escaped-rm',
        'dd if=/etc/hosts of=../escaped-dd',
        'ln -s /etc/hosts ../escaped-ln',
        'tee ../escaped-tee </dev/null',
        'chmod 644 ../escaped-chmod',
        'chown 0:0 ../escaped-chown',
        `cd /tmp && touch ${path.basename(leaked)}`,
      ];
      await h.write('inside.txt', 'inside\n');
      for (const command of commands) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('outside the workspace');
      }
      for (const relative of ['../outside2.txt', '../outside-append.txt', '../outside3.txt', '../copied.txt', '../escaped-dir', '../escaped-mv', '../escaped-dd', '../escaped-ln', '../escaped-tee']) {
        await expect(readFile(path.join(h.workspace, relative)), relative).rejects.toThrow();
      }
      await expect(readFile(outside)).rejects.toThrow();
      await expect(readFile(leaked)).rejects.toThrow();

      const inside = await h.call('bash', { command: 'echo hi > inside-ok.txt && cat inside-ok.txt' });
      expect(textOf(inside)).toContain('hi');

      await writeFile(path.join(h.root, 'readable.txt'), 'OUTSIDE\n');
      const cat = await h.call('bash', { command: 'cat ../readable.txt' });
      expect(textOf(cat)).toContain('OUTSIDE');
    } finally {
      await rm(leaked, { force: true });
      await h.cleanup();
    }
  });

  it('asks before an outside write when a UI is present', async () => {
    const denied = await createHarness({ hasUI: true, confirm: false });
    try {
      const result = await denied.call('bash', { command: 'touch ../needs-approval.txt' });
      expect(result.isError).toBe(true);
      expect(denied.confirmations).toHaveLength(1);
      await expect(readFile(path.join(denied.root, 'needs-approval.txt'))).rejects.toThrow();
    } finally {
      await denied.cleanup();
    }

    const approved = await createHarness({ hasUI: true, confirm: true });
    try {
      const result = await approved.call('bash', { command: 'touch ../needs-approval.txt' });
      expect(result.isError).toBeUndefined();
      expect(approved.confirmations).toHaveLength(1);
      expect(await readFile(path.join(approved.root, 'needs-approval.txt'), 'utf8')).toBe('');
    } finally {
      await approved.cleanup();
    }
  });

  it('applies read and write deny rules to literal operands and redirections', async () => {
    const h = await createHarness({
      config: {
        rules: [
          { kind: 'read', action: 'deny', pattern: '**/secret.txt' },
          { kind: 'write', action: 'deny', pattern: '**/denied.txt' },
        ],
      },
    });
    try {
      await h.write('secret.txt', 'TOP-SECRET\n');
      await h.write('public.txt', 'public\n');
      const secret = await h.call('bash', { command: 'cat secret.txt' });
      expect(secret.isError).toBe(true);
      expect(textOf(secret)).toContain('rule: **/secret.txt');
      expect(textOf(secret)).not.toContain('TOP-SECRET');

      const touched = await h.call('bash', { command: 'touch denied.txt' });
      expect(touched.isError).toBe(true);
      expect(textOf(touched)).toContain('rule: **/denied.txt');
      await expect(readFile(h.file('denied.txt'), 'utf8')).rejects.toThrow();

      const redirected = await h.call('bash', { command: 'echo x > denied.txt' });
      expect(redirected.isError).toBe(true);
      expect(textOf(redirected)).toContain('rule: **/denied.txt');

      const other = await h.call('bash', { command: 'echo x > denied2.txt' });
      expect(other.isError).toBeUndefined();
      expect(await readFile(h.file('denied2.txt'), 'utf8')).toBe('x\n');

      const readable = await h.call('bash', { command: 'cat public.txt' });
      expect(textOf(readable)).toContain('public');

      const git = await h.call('bash', { command: 'git add denied.txt' });
      expect(git.isError).toBe(true);
      expect(textOf(git)).toContain('rule: **/denied.txt');
    } finally {
      await h.cleanup();
    }
  });

  it('reads cp and dd sources and gates only what they write', async () => {
    const h = await createHarness({ hasUI: false });
    try {
      await h.write('source.txt', 'SOURCE\n');
      const outside = path.join(h.root, 'outside.txt');
      await writeFile(outside, 'OUTSIDE\n');

      const copyIn = await h.call('bash', { command: `cp ${outside} ./copied.txt` });
      expect(copyIn.isError).toBeUndefined();
      expect(await readFile(h.file('copied.txt'), 'utf8')).toBe('OUTSIDE\n');

      const copyOut = await h.call('bash', { command: 'cp ./source.txt ../copied-out.txt' });
      expect(copyOut.isError).toBe(true);
      expect(textOf(copyOut)).toContain('outside the workspace');

      const ddIn = await h.call('bash', { command: `dd if=${outside} of=./dd-copy.txt` });
      expect(ddIn.isError).toBeUndefined();
      expect(await readFile(h.file('dd-copy.txt'), 'utf8')).toBe('OUTSIDE\n');

      const ddOut = await h.call('bash', { command: 'dd if=./source.txt of=../dd-out.txt' });
      expect(ddOut.isError).toBe(true);
      expect(textOf(ddOut)).toContain('outside the workspace');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 8: a dangling symlink cannot escape containment, deny rules, or ignore rules', () => {
  it('refuses writers that would create the missing target', async () => {
    const fetchBody: typeof globalThis.fetch = async () => new Response('FETCHED', { headers: { 'content-type': 'text/plain' } });
    const h = await createHarness({ hasUI: false, fetch: fetchBody });
    try {
      const outsideDir = path.join(h.root, 'outside');
      await mkdir(outsideDir, { recursive: true });
      const cases = [
        ['write', () => h.call('write', { path: 'link', content: 'W\n' }), 'w.txt'],
        ['save_resource', () => h.call('save_resource', { path: 'link', content: 'R\n' }), 'r.txt'],
        ['apply_patch', () => h.call('apply_patch', { patch: '*** Begin Patch\n*** Add File: link\n+A\n*** End Patch' }), 'p.txt'],
      ] as const;
      for (const [name, run, file] of cases) {
        const outsideFile = path.join(outsideDir, file);
        await symlink(outsideFile, h.file('link'), 'file');
        const result = await run();
        expect(result.isError, name).toBe(true);
        expect(textOf(result), name).toContain('outside the workspace');
        await expect(readFile(outsideFile, 'utf-8'), name).rejects.toThrow();
        await rm(h.file('link'), { force: true });
      }

      const allowed = await createHarness({
        hasUI: false,
        fetch: fetchBody,
        config: { rules: [{ kind: 'read', action: 'allow', pattern: 'https://example.com/' }] },
      });
      try {
        await symlink(path.join(allowed.root, 'fetched.txt'), allowed.file('link'), 'file');
        const saved = await allowed.call('web_fetch', { url: 'https://example.com/', saveTo: 'link' });
        expect(saved.isError).toBe(true);
        expect(textOf(saved)).toContain('outside the workspace');
        await expect(readFile(path.join(allowed.root, 'fetched.txt'), 'utf-8')).rejects.toThrow();
      } finally {
        await allowed.cleanup();
      }
    } finally {
      await h.cleanup();
    }
  });

  it('refuses a dangling link to a denied or ignored target', async () => {
    const denied = await createHarness({ config: { rules: [{ kind: 'write', action: 'deny', pattern: '**/secret.txt' }] } });
    try {
      const outside = path.join(denied.root, 'outside', 'secret.txt');
      await mkdir(path.dirname(outside), { recursive: true });
      await symlink(outside, denied.file('link.txt'), 'file');
      const result = await denied.call('write', { path: 'link.txt', content: 'DENIED-CONTENT\n' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('rule: **/secret.txt');
      await expect(readFile(outside, 'utf-8')).rejects.toThrow();
    } finally {
      await denied.cleanup();
    }

    const ignored = await createHarness();
    try {
      await ignored.write('.piignore', 'secret.txt\n');
      await symlink(ignored.file('secret.txt'), ignored.file('link.txt'), 'file');
      const result = await ignored.call('write', { path: 'link.txt', content: 'IGNORED-CONTENT\n' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('filtered out by .piignore');
      await expect(readFile(ignored.file('secret.txt'), 'utf-8')).rejects.toThrow();
    } finally {
      await ignored.cleanup();
    }
  });
});

describe('finding 9: the read fence follows the file, not the spelling', () => {
  it('refuses a write through another name after the file changed', async () => {
    const h = await createHarness();
    try {
      await h.write('real.txt', 'original\n');
      await symlink(h.file('real.txt'), h.file('alias.txt'), 'file');
      await h.call('read', { path: 'alias.txt' });
      await writeFile(h.file('real.txt'), 'changed on disk\n', 'utf-8');
      const write = await h.call('write', { path: 'real.txt', content: 'clobbered\n' });
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('changed on disk');
      expect(await readFile(h.file('real.txt'), 'utf-8')).toBe('changed on disk\n');

      await h.write('a.txt', 'one\n');
      await symlink(h.file('a.txt'), h.file('link.txt'), 'file');
      await h.call('read', { path: 'a.txt' });
      await writeFile(h.file('a.txt'), 'external\n', 'utf-8');
      const viaLink = await h.call('write', { path: 'link.txt', content: 'through-link\n' });
      expect(viaLink.isError).toBe(true);
      expect(textOf(viaLink)).toContain('changed on disk');
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('external\n');

      await h.write('case.txt', 'one\n');
      const folds = await readFile(h.file('CASE.txt'), 'utf-8').then(
        () => true,
        () => false,
      );
      if (folds) {
        await h.call('read', { path: 'case.txt' });
        await writeFile(h.file('case.txt'), 'external\n', 'utf-8');
        const edit = await h.call('edit', { path: 'CASE.txt', edits: [{ oldText: 'external', newText: 'edited-case' }] });
        expect(edit.isError).toBe(true);
        expect(textOf(edit)).toContain('changed on disk');
        expect(await readFile(h.file('case.txt'), 'utf-8')).toBe('external\n');
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 10: edit honors an absent record from delete', () => {
  it('refuses to edit a file recreated after delete', async () => {
    const h = await createHarness();
    try {
      await h.write('gone.txt', 'original\n');
      const removed = await h.call('delete', { path: 'gone.txt' });
      expect(removed.isError).toBeUndefined();
      await h.write('gone.txt', 'recreated\n');
      const edit = await h.call('edit', { path: 'gone.txt', edits: [{ oldText: 'recreated', newText: 'edited-after-delete' }] });
      expect(edit.isError).toBe(true);
      expect(textOf(edit)).toContain('changed on disk');
      expect(await readFile(h.file('gone.txt'), 'utf-8')).toBe('recreated\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 11: a ranged read keeps an earlier full-file fence', () => {
  it('still refuses a write after a window, a zero limit, or a tail', async () => {
    const h = await createHarness();
    try {
      const ranges = [
        ['window', { offset: 1, limit: 1 }],
        ['zero', { limit: 0 }],
        ['tail', { offset: -1 }],
      ] as const;
      for (const [name, range] of ranges) {
        const relative = `${name}.txt`;
        await h.write(relative, 'line1\nline2\nline3\n');
        await h.call('read', { path: relative });
        await h.call('read', { path: relative, ...range });
        await writeFile(h.file(relative), 'tampered\n', 'utf-8');
        const write = await h.call('write', { path: relative, content: 'agent\n' });
        expect(write.isError, name).toBe(true);
        expect(textOf(write), name).toContain('changed on disk');
        expect(await readFile(h.file(relative), 'utf-8'), name).toBe('tampered\n');
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 12: a directory ignore pattern does not match a file', () => {
  it('lets every tool see a file whose name matches a dir/ pattern, and still hides the directory', async () => {
    const h = await createHarness();
    try {
      await h.write('.piignore', 'data/\nkept/\n');
      await h.write('data', 'a regular file named data\n');
      await h.write('kept/secret.txt', 'hidden\n');

      const read = await h.call('read', { path: 'data' });
      expect(read.isError).toBeUndefined();
      expect(textOf(read)).toContain('a regular file named data');

      const listing = await h.call('ls', {});
      expect(textOf(listing)).toContain('data');
      expect(textOf(listing)).not.toContain('kept');

      const grep = await h.call('grep', { pattern: 'regular', path: 'data' });
      expect(grep.isError).toBeUndefined();
      expect(textOf(grep)).toContain('data');

      const found = await h.call('find', { pattern: 'data', path: 'data' });
      expect(found.isError).toBeUndefined();
      expect(textOf(found)).toContain('data');

      const write = await h.call('write', { path: 'data', content: 'updated\n' });
      expect(write.isError).toBeUndefined();
      expect(await readFile(h.file('data'), 'utf-8')).toBe('updated\n');

      const hidden = await h.call('read', { path: 'kept/secret.txt' });
      expect(hidden.isError).toBe(true);
      expect(textOf(hidden)).toContain('filtered out by .piignore');

      const removed = await h.call('delete', { path: 'data' });
      expect(removed.isError).toBeUndefined();
      await expect(readFile(h.file('data'), 'utf-8')).rejects.toThrow();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 13: the first line of a BOM file matches the text read returned', () => {
  it('replaces the first line and keeps the file BOM', async () => {
    const h = await createHarness();
    try {
      await h.write('bom.txt', '\uFEFFfirst line\nsecond line\n');
      const read = await h.call('read', { path: 'bom.txt' });
      const firstLine = textOf(read).split('\n')[0] ?? '';
      expect(firstLine.startsWith('\uFEFF')).toBe(true);
      const edit = await h.call('edit', { path: 'bom.txt', edits: [{ oldText: firstLine, newText: 'replaced' }] });
      expect(edit.isError).toBeUndefined();
      expect(await readFile(h.file('bom.txt'), 'utf-8')).toBe('\uFEFFreplaced\nsecond line\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 14: an empty patch is not a successful no-op', () => {
  it('refuses a patch with no file sections', async () => {
    const h = await createHarness();
    try {
      const result = await h.call('apply_patch', { patch: '*** Begin Patch\n*** End Patch' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('no changes');
      expect(textOf(result)).toContain('Nothing was written');
      expect(textOf(result)).not.toContain('Applied patch');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 15: a failed add removes directories it created', () => {
  it('leaves no directory behind when the file name cannot be created', async () => {
    const h = await createHarness();
    try {
      const name = 'x'.repeat(300);
      const patch = ['*** Begin Patch', `*** Add File: newdir/${name}`, '+content', '*** End Patch'].join('\n');
      const result = await h.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Nothing was written');
      await expect(readdir(h.file('newdir'))).rejects.toThrow();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 16: a base64 write counts the decoded lines', () => {
  it('reports the same line count as the file metadata', async () => {
    const h = await createHarness();
    try {
      const content = Buffer.from('one\ntwo\n', 'utf-8').toString('base64');
      const result = await h.call('write', { path: 'text.b64', content, encoding: 'base64' });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('[wrote 2 lines, 8 bytes]');
      const details = result.details as { linesWritten?: number; metadata?: { lines?: number } };
      expect(details.linesWritten).toBe(2);
      expect(details.metadata?.lines).toBe(2);
      expect(await readFile(h.file('text.b64'), 'utf-8')).toBe('one\ntwo\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 17: a tail read of an empty file invents no line', () => {
  it('returns an empty body and the real footer', async () => {
    const h = await createHarness();
    try {
      await h.write('empty.txt', '');
      for (const args of [
        { path: 'empty.txt', offset: -1 },
        { path: 'empty.txt', offset: -1, limit: 2 },
      ]) {
        const result = await h.call('read', args);
        expect(result.isError, JSON.stringify(args)).toBeUndefined();
        expect(textOf(result), JSON.stringify(args)).not.toContain('more lines');
        expect(textOf(result), JSON.stringify(args)).toContain('[file: 0 lines, 0 bytes');
      }
    } finally {
      await h.cleanup();
    }
  });
});
