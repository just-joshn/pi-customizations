import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the tenth adversarial pass, waves A and B. */

const untrustedOf = (command: string): string | undefined => analyzeShellCommand(command, '/home/tester').untrusted;
const writesOf = (command: string): string[] =>
  analyzeShellCommand(command, '/home/tester')
    .paths.filter((entry) => entry.write)
    .map((entry) => entry.path);

describe('finding 1: an unquoted glob hides the paths the shell opens', () => {
  it('refuses a glob spelling of a denied read, an ignored file, and a denied delete', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: {
        rules: [
          { kind: 'read', action: 'deny', pattern: '**/secret.txt' },
          { kind: 'write', action: 'deny', pattern: '**/protected.txt' },
        ],
      },
    });
    try {
      await h.write('.piignore', 'hidden.txt\n');
      await h.write('secret.txt', 'TOPSECRET-VALUE\n');
      await h.write('hidden.txt', 'HIDDEN-VALUE\n');
      await h.write('protected.txt', 'PROTECTED-VALUE\n');

      const literal = await h.call('bash', { command: 'cat secret.txt' });
      expect(literal.isError).toBe(true);
      expect(textOf(literal)).toContain('rule: **/secret.txt');

      const denied = await h.call('bash', { command: 'cat secret*' });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain('a glob hides the paths the shell opens');
      expect(textOf(denied)).not.toContain('TOPSECRET-VALUE');

      const ignored = await h.call('bash', { command: 'cat hidden*' });
      expect(ignored.isError).toBe(true);
      expect(textOf(ignored)).toContain('a glob hides the paths the shell opens');
      expect(textOf(ignored)).not.toContain('HIDDEN-VALUE');

      const deleted = await h.call('bash', { command: 'rm protected*' });
      expect(deleted.isError).toBe(true);
      expect(textOf(deleted)).toContain('a glob hides the paths the shell opens');
      expect(await readFile(h.file('protected.txt'), 'utf8')).toBe('PROTECTED-VALUE\n');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses a glob in a redirect target, a tar operand, a git operand, and a command word', () => {
    expect(untrustedOf('echo hi > out*')).toContain('a glob hides the paths the shell opens');
    expect(untrustedOf('tar -cf out.tar *')).toContain('a glob hides the paths the shell opens');
    expect(untrustedOf('tar -cf out.tar src*')).toContain('a glob hides the paths the shell opens');
    expect(untrustedOf('git add *.ts')).toContain('a glob hides the paths the shell opens');
    expect(untrustedOf('./r? victim.txt')).toContain('a glob hides the paths the shell opens');
    expect(untrustedOf('ls *.ts')).toContain('a glob hides the paths the shell opens');
  });

  it('keeps a quoted glob literal and leaves ordinary commands alone', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/secret.txt' }] },
    });
    try {
      await h.write('secret*', 'LITERAL-GLOB\n');
      const single = await h.call('bash', { command: "cat 'secret*'" });
      expect(textOf(single)).toContain('LITERAL-GLOB');
      const double = await h.call('bash', { command: 'cat "secret*"' });
      expect(textOf(double)).toContain('LITERAL-GLOB');

      expect(untrustedOf('ls *.ts')).toContain('a glob hides the paths the shell opens');
      expect(untrustedOf('git add a.ts')).toBeUndefined();
      expect(untrustedOf('tar -cf out.tar src')).toBeUndefined();
      expect(untrustedOf('git commit -m "fix *glob* handling"')).toBeUndefined();
      expect(untrustedOf('[ "$x" = yes ]')).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: a shell reading its script from stdin is refused in every spelling', () => {
  it('refuses bash<script.sh and leaves the file the script would delete', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'rm *' }] },
    });
    try {
      await h.write('script.sh', 'rm victim.txt\n');
      await h.write('victim.txt', 'VICTIM\n');

      const spaced = await h.call('bash', { command: 'bash < script.sh' });
      expect(spaced.isError).toBe(true);
      expect(textOf(spaced)).toContain('reads a script from standard input');

      const glued = await h.call('bash', { command: 'bash<script.sh' });
      expect(glued.isError).toBe(true);
      expect(textOf(glued)).toContain('reads a script from standard input');

      const prefixed = await h.call('bash', { command: 'sh 0<script.sh' });
      expect(prefixed.isError).toBe(true);
      expect(textOf(prefixed)).toContain('reads a script from standard input');

      expect(existsSync(h.file('victim.txt'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  it('keeps a here-document for data and an inline -c body, and still refuses a piped or here-document script', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      const data = await h.call('bash', { command: 'cat <<EOF\nhello\nEOF' });
      expect(textOf(data)).toContain('hello');
      expect(untrustedOf('bash -c "echo hi"')).toBeUndefined();
      expect(untrustedOf('echo hi | bash')).toContain('reads a script from standard input');
      expect(untrustedOf('bash <<EOF\necho hi\nEOF')).toContain('reads a script from standard input');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: compressors and wget write where the layer can see them', () => {
  it('refuses gzip, gunzip, bzip2, and xz operands outside the workspace', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    const outside = path.join(h.root, 'outside');
    try {
      await mkdir(outside, { recursive: true });
      for (const name of ['victim.txt', 'victim.gz', 'victim.bz2', 'victim.xz']) {
        await writeFile(path.join(outside, name), 'OUTSIDE-VALUE\n', 'utf8');
      }

      const gzip = await h.call('bash', { command: 'gzip ../outside/victim.txt' });
      expect(gzip.isError).toBe(true);
      expect(textOf(gzip)).toContain('outside the workspace');
      expect(existsSync(path.join(outside, 'victim.txt'))).toBe(true);
      expect(existsSync(path.join(outside, 'victim.txt.gz'))).toBe(false);

      for (const command of ['gunzip ../outside/victim.gz', 'bzip2 ../outside/victim.txt', 'xz ../outside/victim.txt']) {
        const result = await h.call('bash', { command });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('outside the workspace');
      }
      expect(existsSync(path.join(outside, 'victim.txt'))).toBe(true);
      expect(existsSync(path.join(outside, 'victim.gz'))).toBe(true);

      // `-c` sends the compressed bytes to stdout, so the same outside operand is only a read.
      const stdoutForm = await h.call('bash', { command: 'gzip -c ../outside/victim.txt' });
      expect(textOf(stdoutForm)).not.toContain('outside the workspace');
    } finally {
      await h.cleanup();
    }
  });

  it('treats -c/--stdout as a read and compresses the operand in place without one', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await h.write('a.txt', 'inside\n');
      expect(writesOf('gzip a.txt')).toEqual(['a.txt']);
      expect(writesOf('gzip -c a.txt')).toEqual([]);
      expect(writesOf('gzip --stdout a.txt')).toEqual([]);
      expect(writesOf('xz -dc a.xz')).toEqual([]);
      expect(writesOf('gunzip a.txt.gz')).toEqual(['a.txt.gz']);

      const inplace = await h.call('bash', { command: 'gzip a.txt' });
      expect(inplace.isError).toBeUndefined();
      expect(existsSync(h.file('a.txt'))).toBe(false);
      expect(existsSync(h.file('a.txt.gz'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  it('refuses every wget output spelling outside the workspace and keeps a plain wget a read', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    const outside = path.join(h.root, 'outside');
    try {
      await mkdir(outside, { recursive: true });
      for (const command of [
        'wget -O ../outside/wget.txt http://127.0.0.1:1/x.txt',
        'wget -O../outside/glued.txt http://127.0.0.1:1/x.txt',
        'wget --output-document=../outside/long.txt http://127.0.0.1:1/x.txt',
        'wget -P ../outside http://127.0.0.1:1/x.txt',
        'wget --directory-prefix=../outside http://127.0.0.1:1/x.txt',
      ]) {
        const result = await h.call('bash', { command });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('outside the workspace');
      }
      expect(existsSync(path.join(outside, 'wget.txt'))).toBe(false);
      expect(existsSync(path.join(outside, 'glued.txt'))).toBe(false);

      expect(writesOf('wget http://127.0.0.1:1/x.txt')).toEqual([]);
      expect(writesOf('wget -O page.html http://127.0.0.1:1/x.txt')).toEqual(['page.html']);
      const plain = await h.call('bash', { command: 'wget -q -O /dev/null http://127.0.0.1:1/x.txt' });
      expect(textOf(plain)).not.toContain('outside the workspace');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 8: flock runs a command the analyzer does not follow', () => {
  it('refuses flock with a command and leaves the file it would delete', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'rm *' }] },
    });
    try {
      await h.write('victim.txt', 'VICTIM\n');
      for (const command of ['flock .lock rm victim.txt', 'flock -x .lock rm victim.txt', 'flock .lock touch new.txt']) {
        const result = await h.call('bash', { command });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('flock runs a command the analyzer does not follow');
      }
      expect(await readFile(h.file('victim.txt'), 'utf8')).toBe('VICTIM\n');
      expect(existsSync(h.file('new.txt'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: a symlink does not launder a protected ignore-file write', () => {
  it('refuses a tool write, a shell redirect, and a delete through a symlink to .piignore', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await h.write('.piignore', 'hidden.txt\n');
      await h.write('hidden.txt', 'HIDDEN-VALUE\n');
      await symlink('.piignore', h.file('alias-to-piignore'));

      const write = await h.call('write', { path: 'alias-to-piignore', content: 'gone\n' });
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('.piignore is protected and cannot be changed by the agent');
      expect(await readFile(h.file('.piignore'), 'utf8')).toBe('hidden.txt\n');

      const redirect = await h.call('bash', { command: 'echo x > alias-to-piignore' });
      expect(redirect.isError).toBe(true);
      expect(textOf(redirect)).toContain('Blocked: .piignore is protected and cannot be changed by the agent');
      expect(await readFile(h.file('.piignore'), 'utf8')).toBe('hidden.txt\n');

      const removed = await h.call('bash', { command: 'rm alias-to-piignore' });
      expect(removed.isError).toBe(true);
      expect(textOf(removed)).toContain('Blocked: .piignore is protected and cannot be changed by the agent');
      expect(await readFile(h.file('.piignore'), 'utf8')).toBe('hidden.txt\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: write and save_resource refuse a FIFO instead of blocking on it', () => {
  const run = promisify(execFile);
  const timeout = 5000;

  it('refuses a FIFO with a clear error and writes nothing', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await run('mkfifo', [h.file('pipe.fifo')]);
      await run('mkfifo', [h.file('resource.fifo')]);

      const write = await Promise.race([h.call('write', { path: 'pipe.fifo', content: 'hello' }), new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeout))]);
      expect(write).not.toBe('timeout');
      if (write === 'timeout') {
        return;
      }
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('it is a FIFO, not a regular file. Nothing was written.');

      const saved = await Promise.race([h.call('save_resource', { path: 'resource.fifo', content: 'hello', overwrite: true }), new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeout))]);
      expect(saved).not.toBe('timeout');
      if (saved === 'timeout') {
        return;
      }
      expect(saved.isError).toBe(true);
      expect(textOf(saved)).toContain('it is a FIFO, not a regular file. Nothing was written.');

      const handled = await Promise.race([h.call('read', { path: 'pipe.fifo' }), new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeout))]);
      expect(handled).not.toBe('timeout');
      if (handled !== 'timeout') {
        expect(handled.isError).toBe(true);
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5: the project policy file is not agent-writable', () => {
  it('refuses write, apply_patch, save_resource, a shell redirect, and a delete, and still allows a read', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto' } });
    const original = JSON.stringify({ mode: 'auto' }, null, 2);
    const policy = () => readFile(h.file('.pi/pi-tools.json'), 'utf8');
    try {
      const write = await h.call('write', { path: '.pi/pi-tools.json', content: '{"mode":"unrestricted"}' });
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('project policy file and cannot be changed by the agent');
      expect(await policy()).toBe(original);

      const redirect = await h.call('bash', { command: 'printf \'{"mode":"unrestricted"}\' > .pi/pi-tools.json' });
      expect(redirect.isError).toBe(true);
      expect(textOf(redirect)).toContain('Blocked: .pi/pi-tools.json is the project policy file and cannot be changed by the agent');
      expect(await policy()).toBe(original);

      const patch = ['*** Begin Patch', '*** Update File: .pi/pi-tools.json', '@@', '-{', '-  "mode": "auto"', '-}', '+{"mode":"unrestricted"}', '*** End Patch'].join('\n');
      const patched = await h.call('apply_patch', { patch });
      expect(patched.isError).toBe(true);
      expect(textOf(patched)).toContain('project policy file and cannot be changed by the agent');
      expect(await policy()).toBe(original);

      const saved = await h.call('save_resource', { path: '.pi/pi-tools.json', content: '{"mode":"unrestricted"}', overwrite: true });
      expect(saved.isError).toBe(true);
      expect(textOf(saved)).toContain('project policy file and cannot be changed by the agent');
      expect(await policy()).toBe(original);

      const removed = await h.call('delete', { path: '.pi/pi-tools.json' });
      expect(removed.isError).toBe(true);
      expect(textOf(removed)).toContain('protected');
      expect(existsSync(h.file('.pi/pi-tools.json'))).toBe(true);

      const read = await h.call('read', { path: '.pi/pi-tools.json' });
      expect(read.isError).toBeUndefined();
      expect(textOf(read)).toContain('"mode": "auto"');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: a patch move refuses to land on an existing file', () => {
  it('leaves both files unchanged and still moves to a free path', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await h.write('a.txt', 'AAA\n');
      await h.write('b.txt', 'BBB\n');
      const read = await h.call('read', { path: 'b.txt' });
      expect(textOf(read)).toContain('BBB');

      const blocked = await h.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: a.txt', '*** Move to: b.txt', '*** End Patch'].join('\n') });
      expect(blocked.isError).toBe(true);
      expect(textOf(blocked)).toContain('b.txt');
      expect(textOf(blocked)).toContain('Nothing was written');
      expect(await readFile(h.file('a.txt'), 'utf8')).toBe('AAA\n');
      expect(await readFile(h.file('b.txt'), 'utf8')).toBe('BBB\n');

      const moved = await h.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: a.txt', '*** Move to: c.txt', '*** End Patch'].join('\n') });
      expect(moved.isError).toBeUndefined();
      expect(await readFile(h.file('c.txt'), 'utf8')).toBe('AAA\n');
      await expect(readFile(h.file('a.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 9: a hardlink shares an inode the path rules cannot see', () => {
  const multiLink = 'hard links, so path rules cannot see its other names';

  it('refuses to read a denied file reached through a hardlink', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/secret.txt' }] } });
    try {
      await h.write('secret.txt', 'TOPSECRET-VALUE\n');
      await link(h.file('secret.txt'), h.file('alias.txt'));

      const literal = await h.call('read', { path: 'secret.txt' });
      expect(literal.isError).toBe(true);
      expect(textOf(literal)).toContain('rule: **/secret.txt');

      const alias = await h.call('read', { path: 'alias.txt' });
      expect(alias.isError).toBe(true);
      expect(textOf(alias)).toContain('Cannot read alias.txt');
      expect(textOf(alias)).toContain(multiLink);
      expect(textOf(alias)).not.toContain('TOPSECRET-VALUE');
      expect(await readFile(h.file('secret.txt'), 'utf8')).toBe('TOPSECRET-VALUE\n');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses to write, edit, and delete a denied file reached through a hardlink', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { rules: [{ kind: 'write', action: 'deny', pattern: '**/protected.txt' }] } });
    try {
      await h.write('protected.txt', 'PROTECTED-VALUE\n');
      await link(h.file('protected.txt'), h.file('alias.txt'));

      const literal = await h.call('write', { path: 'protected.txt', content: 'PWNED\n' });
      expect(literal.isError).toBe(true);
      expect(textOf(literal)).toContain('rule: **/protected.txt');

      const edited = await h.call('edit', { path: 'alias.txt', edits: [{ oldText: 'PROTECTED', newText: 'PWNED' }] });
      expect(edited.isError).toBe(true);
      expect(textOf(edited)).toContain('Cannot edit alias.txt');
      expect(textOf(edited)).toContain(multiLink);
      expect(await readFile(h.file('protected.txt'), 'utf8')).toBe('PROTECTED-VALUE\n');

      const written = await h.call('write', { path: 'alias.txt', content: 'PWNED\n' });
      expect(written.isError).toBe(true);
      expect(textOf(written)).toContain('Cannot write alias.txt');
      expect(textOf(written)).toContain(multiLink);
      expect(textOf(written)).toContain('Nothing was written');
      expect(await readFile(h.file('protected.txt'), 'utf8')).toBe('PROTECTED-VALUE\n');

      const deleted = await h.call('delete', { path: 'alias.txt' });
      expect(deleted.isError).toBe(true);
      expect(textOf(deleted)).toContain('Cannot delete alias.txt');
      expect(textOf(deleted)).toContain(multiLink);
      expect(await readFile(h.file('protected.txt'), 'utf8')).toBe('PROTECTED-VALUE\n');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses an ignored file reached through a hardlink and drops it from grep and find', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await h.write('.piignore', 'hidden.txt\n');
      await h.write('hidden.txt', 'HIDDEN-VALUE\n');
      await h.write('plain.txt', 'PLAIN-VALUE\n');
      await link(h.file('hidden.txt'), h.file('alias.txt'));

      const literal = await h.call('read', { path: 'hidden.txt' });
      expect(literal.isError).toBe(true);
      expect(textOf(literal)).toContain('filtered out by .piignore');

      const alias = await h.call('read', { path: 'alias.txt' });
      expect(alias.isError).toBe(true);
      expect(textOf(alias)).toContain('Cannot read alias.txt');
      expect(textOf(alias)).toContain(multiLink);
      expect(textOf(alias)).not.toContain('HIDDEN-VALUE');

      const grep = await h.call('grep', { pattern: 'HIDDEN-VALUE|PLAIN-VALUE' });
      expect(grep.isError).toBeUndefined();
      expect(textOf(grep)).toContain('plain.txt');
      expect(textOf(grep)).not.toContain('HIDDEN-VALUE');

      const find = await h.call('find', { pattern: '*.txt' });
      expect(find.isError).toBeUndefined();
      expect(textOf(find)).toContain('plain.txt');
      expect(textOf(find)).not.toContain('alias.txt');
      expect(textOf(find)).not.toContain('hidden.txt');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses a hardlink whose name the allowlist allows', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: {
        mode: 'allowlist',
        rules: [
          { kind: 'read', action: 'allow', pattern: '**/allowed.txt' },
          { kind: 'read', action: 'allow', pattern: '**/alias.txt' },
          { kind: 'write', action: 'allow', pattern: '**/allowed.txt' },
          { kind: 'write', action: 'allow', pattern: '**/alias.txt' },
        ],
      },
    });
    try {
      await h.write('allowed.txt', 'ALLOWED-VALUE\n');
      await h.write('other.txt', 'OTHER-VALUE\n');
      await link(h.file('other.txt'), h.file('alias.txt'));

      const allowed = await h.call('read', { path: 'allowed.txt' });
      expect(allowed.isError).toBeUndefined();
      expect(textOf(allowed)).toContain('ALLOWED-VALUE');

      const unlisted = await h.call('read', { path: 'other.txt' });
      expect(unlisted.isError).toBe(true);
      expect(textOf(unlisted)).toContain('no allow rule matches this call');

      const read = await h.call('read', { path: 'alias.txt' });
      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain('Cannot read alias.txt');
      expect(textOf(read)).toContain(multiLink);
      expect(textOf(read)).not.toContain('OTHER-VALUE');

      const write = await h.call('write', { path: 'alias.txt', content: 'PWNED\n' });
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('Cannot write alias.txt');
      expect(textOf(write)).toContain(multiLink);
      expect(await readFile(h.file('other.txt'), 'utf8')).toBe('OTHER-VALUE\n');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses a hardlink through apply_patch and save_resource', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await h.write('target.txt', 'alpha\nbeta\n');
      await link(h.file('target.txt'), h.file('alias.txt'));
      const patch = ['*** Begin Patch', '*** Update File: alias.txt', '@@', ' alpha', '-beta', '+BETA', '*** End Patch'].join('\n');

      const patched = await h.call('apply_patch', { patch });
      expect(patched.isError).toBe(true);
      expect(textOf(patched)).toContain('Cannot patch alias.txt');
      expect(textOf(patched)).toContain(multiLink);
      expect(await readFile(h.file('target.txt'), 'utf8')).toBe('alpha\nbeta\n');

      const saved = await h.call('save_resource', { path: 'alias.txt', content: 'PWNED\n', overwrite: true });
      expect(saved.isError).toBe(true);
      expect(textOf(saved)).toContain('Cannot write alias.txt');
      expect(textOf(saved)).toContain(multiLink);
      expect(await readFile(h.file('target.txt'), 'utf8')).toBe('alpha\nbeta\n');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses a hardlink through a bash literal operand and a fetched save', async () => {
    const h = await createHarness({ config: { mode: 'unrestricted' }, fetch: (async () => new Response('FETCHED', { headers: { 'content-type': 'text/plain' } })) as typeof fetch });
    try {
      await h.write('secret.txt', 'ORIGINAL\n');
      await link(h.file('secret.txt'), h.file('alias.txt'));
      for (const command of ['cat alias.txt', 'printf pwned > alias.txt', 'rm alias.txt']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('hard links');
      }
      expect(await readFile(h.file('secret.txt'), 'utf-8')).toBe('ORIGINAL\n');

      const saved = await h.call('web_fetch', { url: 'https://example.com/', saveTo: 'alias.txt' });
      expect(saved.isError).toBe(true);
      expect(textOf(saved)).toContain('hard links');
      expect(await readFile(h.file('secret.txt'), 'utf-8')).toBe('ORIGINAL\n');
    } finally {
      await h.cleanup();
    }
  });

  it('keeps a single-link file readable, writable, editable, deletable, and searchable', async () => {
    const h = await createHarness({ hasUI: false, confirm: false });
    try {
      await h.write('single.txt', 'SINGLE-VALUE\n');

      const read = await h.call('read', { path: 'single.txt' });
      expect(read.isError).toBeUndefined();
      expect(textOf(read)).toContain('SINGLE-VALUE');

      const written = await h.call('write', { path: 'single.txt', content: 'REWRITTEN\n' });
      expect(written.isError).toBeUndefined();
      expect(await readFile(h.file('single.txt'), 'utf8')).toBe('REWRITTEN\n');

      const edited = await h.call('edit', { path: 'single.txt', edits: [{ oldText: 'REWRITTEN', newText: 'EDITED' }] });
      expect(edited.isError).toBeUndefined();
      expect(await readFile(h.file('single.txt'), 'utf8')).toBe('EDITED\n');

      const grep = await h.call('grep', { pattern: 'EDITED' });
      expect(textOf(grep)).toContain('single.txt');
      const find = await h.call('find', { pattern: 'single.txt' });
      expect(textOf(find)).toContain('single.txt');

      const deleted = await h.call('delete', { path: 'single.txt' });
      expect(deleted.isError).toBeUndefined();
      expect(existsSync(h.file('single.txt'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});
