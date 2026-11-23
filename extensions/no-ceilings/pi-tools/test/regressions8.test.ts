import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand, directoryChanges } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the eighth adversarial pass, command boundaries. Each test names the finding it locks down. */

describe('finding 1: git operands, directory options, and config writes', () => {
  it('refuses a denied git operand, an outside git directory, and a config write', async () => {
    expect(analyzeShellCommand('git diff --no-index -- /dev/null secret.txt').paths).toContainEqual({ path: 'secret.txt', write: false });
    expect(analyzeShellCommand('git diff --no-index -- /dev/null secret.txt').paths.every((entry) => entry.write === false)).toBe(true);
    expect(directoryChanges('git -C /outside status')).toEqual(['/outside']);
    expect(directoryChanges('git --work-tree /outside status')).toEqual(['/outside']);
    expect(directoryChanges('git --work-tree=/outside status')).toEqual(['/outside']);
    expect(directoryChanges('git --git-dir /outside/.git status')).toEqual(['/outside/.git']);
    expect(directoryChanges('git --git-dir=/outside/.git status')).toEqual(['/outside/.git']);
    expect(directoryChanges('git -C . status')).toEqual([]);
    for (const command of [
      'git config user.name Ada',
      'git config --file /outside/x user.name Ada',
      'git config --global user.name Ada',
      'git config --system user.name Ada',
      'git config core.fsmonitor touch',
      "git config alias.pwn '!rm x'",
      'git config --unset user.name',
      'git config --unset-all user.name',
      'git config --replace-all user.name Ada',
      'git config --rename-section a b',
      'git config --remove-section a',
      'git config --edit',
      'git config --add alias.pwn value',
    ]) {
      expect(analyzeShellCommand(command).untrusted, command).toContain('does not follow');
    }
    for (const command of [
      'git config --get user.name',
      'git config --get-all user.name',
      'git config --get-regexp user',
      'git config --list',
      'git config -l',
      'git config --show-origin user.name',
      'git config user.name',
      'git status',
      'git add file',
      'git commit -m init',
      'git log',
      'git diff',
      'git rev-parse --is-inside-work-tree',
      'git -C . status',
      'git -c user.name=Ada status',
      'git -c user.email=a@b.c commit -m init',
    ]) {
      expect(analyzeShellCommand(command).untrusted, command).toBeUndefined();
    }

    const denied = await createHarness({ hasUI: false, config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/secret.txt' }] } });
    try {
      await denied.write('secret.txt', 'TOP-SECRET-CONTENT\n');
      const bash = await denied.call('bash', { command: 'git diff --no-index -- /dev/null secret.txt || true' });
      expect(bash.isError).toBe(true);
      expect(textOf(bash)).toContain('rule: **/secret.txt');
      expect(textOf(bash)).not.toContain('TOP-SECRET-CONTENT');
      const git = await denied.call('git', { subcommand: 'diff', args: ['--no-index', '--', '/dev/null', 'secret.txt'] });
      expect(git.isError).toBe(true);
      expect(textOf(git)).toContain('rule: **/secret.txt');
      expect(textOf(git)).not.toContain('TOP-SECRET-CONTENT');
      expect(denied.confirmations).toHaveLength(0);
    } finally {
      await denied.cleanup();
    }

    const h = await createHarness({ hasUI: false });
    const worktree = path.join(h.root, 'worktree');
    const gitconfig = path.join(h.root, 'escaped.gitconfig');
    const gitC = path.join(h.root, 'git-c');
    const marker = path.join(h.root, 'fsmonitor-marker');
    const victim = path.join(h.root, 'victim.txt');
    try {
      await mkdir(worktree, { recursive: true });
      await mkdir(gitC, { recursive: true });
      await h.write('tracked.txt', 'TRACKED\n');
      const init = await h.call('bash', { command: 'git init -q && git add tracked.txt && git -c user.email=a@b.c -c user.name=Ada commit -qm init' });
      expect(init.isError).toBeUndefined();

      const checkout = await h.call('bash', { command: `git --work-tree ${worktree} checkout -f HEAD -- tracked.txt` });
      expect(checkout.isError).toBe(true);
      expect(textOf(checkout)).toContain('outside the workspace');
      expect(existsSync(path.join(worktree, 'tracked.txt'))).toBe(false);

      const configFile = await h.call('bash', { command: `git config --file ${gitconfig} user.name escaped` });
      expect(configFile.isError).toBe(true);
      expect(textOf(configFile)).toContain('does not follow');
      expect(existsSync(gitconfig)).toBe(false);

      const gitCResult = await h.call('bash', { command: `git -C ${gitC} init -q` });
      expect(gitCResult.isError).toBe(true);
      expect(textOf(gitCResult)).toContain('outside the workspace');
      expect(existsSync(path.join(gitC, '.git', 'HEAD'))).toBe(false);

      const fsmonitor = await h.call('bash', { command: `git config core.fsmonitor 'touch ${marker}' && git status --short` });
      expect(fsmonitor.isError).toBe(true);
      expect(textOf(fsmonitor)).toContain('does not follow');
      expect(existsSync(marker)).toBe(false);

      await writeFile(victim, 'keep\n');
      const alias = await h.call('bash', { command: `git config alias.pwn '!rm -f ${victim}' && git pwn` });
      expect(alias.isError).toBe(true);
      expect(textOf(alias)).toContain('does not follow');
      expect(existsSync(victim)).toBe(true);
      const planted = await h.call('bash', { command: `git config alias.wipe '!rm -f ${victim}'` });
      expect(planted.isError).toBe(true);
      const viaTool = await h.call('git', { subcommand: 'wipe' });
      expect(textOf(viaTool)).not.toContain('keep');
      expect(existsSync(victim)).toBe(true);
      expect(h.confirmations).toHaveLength(0);

      const status = await h.call('bash', { command: 'git status --porcelain && git diff && git rev-parse --is-inside-work-tree && git -C . status --porcelain && git -c user.name=Ada status --porcelain' });
      expect(status.isError).toBeUndefined();
      expect(textOf(status)).toContain('true');
      const log = await h.call('git', { subcommand: 'log', args: ['-1', '--oneline'] });
      expect(log.isError).toBeUndefined();
      expect(textOf(log)).toContain('init');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: a login shell sources a profile the analyzer cannot see', () => {
  it('refuses login shells and still runs an ordinary inline shell', async () => {
    for (const command of ['bash -l', 'bash -lc true', 'bash -cl true', 'bash -ilc true', 'sh -l', 'zsh -l', 'bash --login', 'bash --login -c true', 'zsh --login']) {
      expect(analyzeShellCommand(command).untrusted, command).toContain('login shell');
    }
    expect(analyzeShellCommand('bash -c true').untrusted).toBeUndefined();
    expect(analyzeShellCommand('bash -ec true').untrusted).toBeUndefined();
    expect(analyzeShellCommand("bash -c 'echo ok' -l").untrusted).toBeUndefined();

    const h = await createHarness({ hasUI: false, config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/secret.txt' }] } });
    try {
      await h.write('secret.txt', 'TOP-SECRET-PROFILE\n');
      await h.write('.bash_profile', 'cat secret.txt\n');
      const direct = await h.call('bash', { command: 'cat secret.txt' });
      expect(direct.isError).toBe(true);
      expect(textOf(direct)).toContain('rule: **/secret.txt');

      const login = await h.call('bash', { command: 'bash -lc true', env: { HOME: h.workspace } });
      expect(login.isError).toBe(true);
      expect(textOf(login)).toContain('login shell');
      expect(textOf(login)).not.toContain('TOP-SECRET-PROFILE');
      expect(h.confirmations).toHaveLength(0);

      const ordinary = await h.call('bash', { command: "bash -c 'echo plain-shell'" });
      expect(ordinary.isError).toBeUndefined();
      expect(textOf(ordinary)).toContain('plain-shell');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: tar, curl, sort, rsync, and find destinations are writes', () => {
  it('refuses outside destinations and keeps the read-only forms', async () => {
    const outside = '/tmp/pi-tools-write-dest';
    expect(analyzeShellCommand(`tar -xf payload.tar -C ${outside}`).paths).toContainEqual({ path: outside, write: true });
    expect(analyzeShellCommand(`tar -xf payload.tar -C${outside}`).paths).toContainEqual({ path: outside, write: true });
    expect(analyzeShellCommand(`tar --directory=${outside} -xf payload.tar`).paths).toContainEqual({ path: outside, write: true });
    expect(analyzeShellCommand(`tar -cf ${outside}/a.tar payload.txt`).paths).toContainEqual({ path: `${outside}/a.tar`, write: true });
    expect(analyzeShellCommand(`tar cf ${outside}/a.tar payload.txt`).paths).toContainEqual({ path: `${outside}/a.tar`, write: true });
    expect(analyzeShellCommand('tar -tf payload.tar').paths.some((entry) => entry.write)).toBe(false);
    expect(analyzeShellCommand(`curl -fsS -o ${outside}/out file:///tmp/x`).paths).toContainEqual({ path: `${outside}/out`, write: true });
    expect(analyzeShellCommand(`curl -fsS -o${outside}/out file:///tmp/x`).paths).toContainEqual({ path: `${outside}/out`, write: true });
    expect(analyzeShellCommand(`curl -fsS --output ${outside}/out file:///tmp/x`).paths).toContainEqual({ path: `${outside}/out`, write: true });
    expect(analyzeShellCommand(`curl -fsS --output-dir ${outside} -O file:///tmp/x`).paths).toContainEqual({ path: outside, write: true });
    expect(analyzeShellCommand('curl -fsS file:///tmp/x').paths.some((entry) => entry.write)).toBe(false);
    expect(analyzeShellCommand(`sort -o ${outside}/out payload.txt`).paths).toContainEqual({ path: `${outside}/out`, write: true });
    expect(analyzeShellCommand(`sort -o${outside}/out payload.txt`).paths).toContainEqual({ path: `${outside}/out`, write: true });
    expect(analyzeShellCommand(`sort --output=${outside}/out payload.txt`).paths).toContainEqual({ path: `${outside}/out`, write: true });
    expect(analyzeShellCommand('sort payload.txt').paths.some((entry) => entry.write)).toBe(false);
    expect(analyzeShellCommand(`rsync -a payload.txt ${outside}/`).paths).toContainEqual({ path: `${outside}/`, write: true });
    expect(analyzeShellCommand(`rsync --list-only payload.txt ${outside}/`).paths.some((entry) => entry.write)).toBe(false);
    expect(analyzeShellCommand(`find . -name payload.txt -fprint ${outside}/list`).paths).toContainEqual({ path: `${outside}/list`, write: true });
    expect(analyzeShellCommand(`find . -name payload.txt -fprint0 ${outside}/list`).paths).toContainEqual({ path: `${outside}/list`, write: true });
    expect(analyzeShellCommand(`find . -name payload.txt -fls ${outside}/list`).paths).toContainEqual({ path: `${outside}/list`, write: true });
    expect(analyzeShellCommand(`find . -name payload.txt -fprintf ${outside}/list '%p'`).paths).toContainEqual({ path: `${outside}/list`, write: true });
    expect(analyzeShellCommand('find . -name payload.txt -print').paths.some((entry) => entry.write)).toBe(false);

    const h = await createHarness({ hasUI: false });
    const root = path.join(h.root, 'outside');
    const tarDest = path.join(root, 'tar');
    const tarAttached = path.join(root, 'tar-attached');
    const curlDest = path.join(root, 'curl-out');
    const sortDest = path.join(root, 'sort-out');
    const rsyncDest = path.join(root, 'rsync');
    const fprint = path.join(root, 'fprint.txt');
    const archive = path.join(root, 'created.tar');
    try {
      await mkdir(tarDest, { recursive: true });
      await mkdir(tarAttached, { recursive: true });
      await mkdir(rsyncDest, { recursive: true });
      await h.write('payload.txt', 'PAYLOAD\n');
      const packed = await h.call('bash', { command: 'tar -cf payload.tar payload.txt' });
      expect(packed.isError).toBeUndefined();
      const cases = [
        [`tar -cf ${archive} payload.txt`, archive],
        [`curl -fsS -o ${curlDest} file://${h.file('payload.txt')}`, curlDest],
        [`sort -o ${sortDest} payload.txt`, sortDest],
        [`rsync -a payload.txt ${rsyncDest}/`, path.join(rsyncDest, 'payload.txt')],
        [`find . -name payload.txt -fprint ${fprint}`, fprint],
      ] as const;
      for (const [command, file] of cases) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('outside the workspace');
        expect(existsSync(file), command).toBe(false);
      }
      // Extraction is refused outright now, because the archive members name the paths it writes.
      for (const [command, file] of [
        [`tar -xf payload.tar -C ${tarDest}`, path.join(tarDest, 'payload.txt')],
        [`tar -xf payload.tar -C${tarAttached}`, path.join(tarAttached, 'payload.txt')],
      ] as const) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('the archive members name the paths');
        expect(existsSync(file), command).toBe(false);
      }
      const copied = await h.call('bash', { command: `cp payload.txt ${path.join(root, 'cp-out')}` });
      expect(copied.isError).toBe(true);
      expect(existsSync(path.join(root, 'cp-out'))).toBe(false);

      const listed = await h.call('bash', { command: 'tar -tf payload.tar && sort payload.txt && find . -name payload.txt -print' });
      expect(listed.isError).toBeUndefined();
      expect(textOf(listed)).toContain('payload.txt');
      const fetched = await h.call('bash', { command: `curl -fsS file://${h.file('payload.txt')}` });
      expect(fetched.isError).toBeUndefined();
      expect(textOf(fetched)).toContain('PAYLOAD');
      const preview = await h.call('bash', { command: `rsync --list-only payload.txt ${rsyncDest}/` });
      expect(preview.isError).toBeUndefined();
      expect(existsSync(path.join(rsyncDest, 'payload.txt'))).toBe(false);
      expect(h.confirmations).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: bash honors ignore rules on literal paths', () => {
  it('refuses ignored reads and writes, and refuses writes to protected ignore files', async () => {
    const h = await createHarness({ hasUI: false });
    try {
      await h.write('.piignore', 'hidden.txt\n');
      await h.write('.gitignore', 'gitignored.txt\n');
      await h.write('hidden.txt', 'PIIGNORE-SECRET\n');
      await h.write('gitignored.txt', 'GITIGNORE-SECRET\n');

      const cat = await h.call('bash', { command: 'cat hidden.txt gitignored.txt' });
      expect(cat.isError).toBe(true);
      expect(textOf(cat)).toContain('Path hidden.txt is filtered out by .piignore');
      expect(textOf(cat)).not.toContain('PIIGNORE-SECRET');
      expect(textOf(cat)).not.toContain('GITIGNORE-SECRET');

      const overwrite = await h.call('bash', { command: 'printf OVERWRITTEN > hidden.txt' });
      expect(overwrite.isError).toBe(true);
      expect(textOf(overwrite)).toContain('Path hidden.txt is filtered out by .piignore');
      expect(await readFile(h.file('hidden.txt'), 'utf8')).toBe('PIIGNORE-SECRET\n');

      const removed = await h.call('bash', { command: 'rm .piignore .gitignore' });
      expect(removed.isError).toBe(true);
      expect(textOf(removed)).toContain('Blocked: .piignore is protected and cannot be changed by the agent');
      expect(existsSync(h.file('.piignore'))).toBe(true);
      expect(existsSync(h.file('.gitignore'))).toBe(true);

      const redirected = await h.call('bash', { command: 'printf CLOBBER > .piignore' });
      expect(redirected.isError).toBe(true);
      expect(textOf(redirected)).toContain('Blocked: .piignore is protected and cannot be changed by the agent');
      expect(await readFile(h.file('.piignore'), 'utf8')).toBe('hidden.txt\n');

      const readIgnore = await h.call('bash', { command: 'cat .piignore' });
      expect(readIgnore.isError).toBeUndefined();
      expect(textOf(readIgnore)).toContain('hidden.txt');

      const deleted = await h.call('delete', { path: '.piignore' });
      expect(deleted.isError).toBe(true);
      expect(textOf(deleted)).toContain('protected and cannot be changed');
      expect(h.confirmations).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5: patch and edit do not rewrite non-UTF-8 bytes', () => {
  it('moves a binary file without changing its bytes', async () => {
    const h = await createHarness();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0xff, 0xfe, 0x80, 0x81]);
    try {
      await mkdir(h.file('assets'), { recursive: true });
      await writeFile(h.file('assets/logo.bin'), png);
      const patch = ['*** Begin Patch', '*** Update File: assets/logo.bin', '*** Move to: assets/logo2.bin', '*** End Patch'].join('\n');
      const result = await h.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(h.file('assets/logo2.bin'))).toEqual(png);
      await expect(readFile(h.file('assets/logo.bin'))).rejects.toThrow();
    } finally {
      await h.cleanup();
    }
  });

  it.skipIf(process.getuid?.() === 0)('restores the original bytes when a later file in the patch cannot be written', async () => {
    const h = await createHarness();
    const bin = Buffer.from([0x00, 0xff, 0xfe, 0x41, 0x42, 0x0a]);
    try {
      await mkdir(h.file('bin'), { recursive: true });
      await writeFile(h.file('bin/data.bin'), bin);
      await mkdir(h.file('locked'), { recursive: true });
      await chmod(h.file('locked'), 0o500);
      try {
        const patch = ['*** Begin Patch', '*** Delete File: bin/data.bin', '*** Add File: locked/c.txt', '+x', '*** End Patch'].join('\n');
        const result = await h.call('apply_patch', { patch });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('Nothing was written');
        expect(await readFile(h.file('bin/data.bin'))).toEqual(bin);
        expect(existsSync(h.file('locked/c.txt'))).toBe(false);
      } finally {
        await chmod(h.file('locked'), 0o700);
      }
    } finally {
      await h.cleanup();
    }
  });

  it('refuses a non-UTF-8 edit and leaves the bytes unchanged', async () => {
    const h = await createHarness();
    const src = Buffer.concat([Buffer.from('caf'), Buffer.from([0xe9]), Buffer.from(' au lait\nhello world\n')]);
    try {
      await mkdir(h.file('notes'), { recursive: true });
      await writeFile(h.file('notes/latin1.txt'), src);
      const result = await h.call('edit', { path: 'notes/latin1.txt', edits: [{ oldText: 'hello world', newText: 'hello there' }] });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Nothing was written');
      expect(textOf(result)).not.toContain('Successfully replaced');
      expect(await readFile(h.file('notes/latin1.txt'))).toEqual(src);

      const patch = ['*** Begin Patch', '*** Update File: notes/latin1.txt', '@@', '-hello world', '+hello there', '*** End Patch'].join('\n');
      const patched = await h.call('apply_patch', { patch });
      expect(patched.isError).toBe(true);
      expect(textOf(patched)).toContain('Nothing was written');
      expect(await readFile(h.file('notes/latin1.txt'))).toEqual(src);
    } finally {
      await h.cleanup();
    }
  });

  it('edits valid UTF-8 and keeps untouched bytes', async () => {
    const h = await createHarness();
    const src = Buffer.from('caf\u00e9\nhello world\n', 'utf8');
    try {
      await mkdir(h.file('notes'), { recursive: true });
      await writeFile(h.file('notes/utf8.txt'), src);
      const result = await h.call('edit', { path: 'notes/utf8.txt', edits: [{ oldText: 'hello world', newText: 'hello there' }] });
      expect(result.isError).toBeUndefined();
      expect(await readFile(h.file('notes/utf8.txt'))).toEqual(Buffer.from('caf\u00e9\nhello there\n', 'utf8'));
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: a URL deny matches a trailing-dot host and an encoded path', () => {
  it('blocks both requests with no fetch and still fetches a URL outside the rules', async () => {
    const calls: string[] = [];
    const fetchStub: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      return new Response('TOPSECRET-PAYLOAD', { status: 200, headers: { 'content-type': 'text/plain' } });
    };
    const h = await createHarness({
      projectTrusted: true,
      hasUI: false,
      fetch: fetchStub,
      config: {
        mode: 'unrestricted',
        rules: [
          { kind: 'read', action: 'deny', pattern: 'https://deny.example.com' },
          { kind: 'read', action: 'deny', pattern: 'https://restricted.example.com/private' },
          { kind: 'read', action: 'deny', pattern: 'https://evil.example/*' },
        ],
      },
    });
    const run = async (url: string) => {
      calls.length = 0;
      const result = await h.call('web_fetch', { url });
      return { result, calls: [...calls] };
    };
    try {
      const trailingDot = await run('https://deny.example.com./page');
      expect(trailingDot.result.isError).toBe(true);
      expect(trailingDot.calls).toEqual([]);
      expect(textOf(trailingDot.result)).toContain('rule: https://deny.example.com');
      expect(textOf(trailingDot.result)).not.toContain('TOPSECRET-PAYLOAD');

      const encoded = await run('https://restricted.example.com/%70rivate/data');
      expect(encoded.result.isError).toBe(true);
      expect(encoded.calls).toEqual([]);
      expect(textOf(encoded.result)).toContain('rule: https://restricted.example.com/private');
      expect(textOf(encoded.result)).not.toContain('TOPSECRET-PAYLOAD');

      const upper = await run('https://DENY.EXAMPLE.COM/page');
      expect(upper.result.isError).toBe(true);
      expect(upper.calls).toEqual([]);

      const pathCase = await run('https://restricted.example.com/PRIVATE/data');
      expect(pathCase.result.isError).toBe(true);
      expect(pathCase.calls).toEqual([]);

      const dotSegment = await run('https://restricted.example.com/x/../private/data');
      expect(dotSegment.result.isError).toBe(true);
      expect(dotSegment.calls).toEqual([]);

      const wildcard = await run('https://evil.example/a/b');
      expect(wildcard.result.isError).toBe(true);
      expect(wildcard.calls).toEqual([]);

      const allowed = await run('https://other.example/page');
      expect(allowed.result.isError).toBeUndefined();
      expect(allowed.calls).toEqual(['https://other.example/page']);
      expect(textOf(allowed.result)).toContain('TOPSECRET-PAYLOAD');
      expect(h.confirmations).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });
});
