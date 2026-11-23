import { existsSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand, directoryChanges } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the ninth adversarial pass. Each test names the finding it locks down. */

describe('finding 1: a >| redirect is one operator, and a digit starts a file name', () => {
  it('refuses >| the same way it refuses >, including deny, ignore, and protected files', async () => {
    const outside = '/tmp/pi-tools-redirect-bar';
    expect(analyzeShellCommand(`echo hi >| ${outside}/file`).paths).toContainEqual({ path: `${outside}/file`, write: true });
    expect(analyzeShellCommand(`echo hi >| ${outside}/file`).segments).toEqual(['echo hi']);
    expect(analyzeShellCommand('echo hi > out.txt | cat').segments).toEqual(['echo hi', 'cat']);
    expect(analyzeShellCommand('echo hi > out.txt | cat').paths).toContainEqual({ path: 'out.txt', write: true });
    expect(analyzeShellCommand('echo hi >| out.txt | cat').segments).toEqual(['echo hi', 'cat']);
    expect(analyzeShellCommand('echo hi >| out.txt | cat').paths).toContainEqual({ path: 'out.txt', write: true });
    expect(analyzeShellCommand('echo hi >2secret.txt').paths).toContainEqual({ path: '2secret.txt', write: true });
    expect(analyzeShellCommand('echo hi >2secret.txt').paths.some((entry) => entry.path === 'secret.txt')).toBe(false);
    expect(analyzeShellCommand('echo hi >|2secret.txt').paths).toContainEqual({ path: '2secret.txt', write: true });
    expect(analyzeShellCommand('echo hi >&2').paths.some((entry) => entry.path === '2')).toBe(false);
    expect(analyzeShellCommand('echo hi <&2').paths.some((entry) => entry.path === '2')).toBe(false);
    expect(analyzeShellCommand('echo hi &>2').paths.some((entry) => entry.path === '2')).toBe(false);
    expect(analyzeShellCommand(`echo hi &>${outside}/file`).paths).toContainEqual({ path: `${outside}/file`, write: true });

    const h = await createHarness({
      hasUI: false,
      config: {
        rules: [
          { kind: 'write', action: 'deny', pattern: '**/secret.txt' },
          { kind: 'write', action: 'deny', pattern: '**/2secret.txt' },
        ],
      },
    });
    const escaped = path.join(h.root, 'escaped.txt');
    try {
      await h.write('.gitignore', 'ignored.txt\n');
      await h.write('.piignore', 'hidden.txt\n');
      await h.write('secret.txt', 'original\n');
      await symlink(escaped, h.file('escape-link'));

      const denied = await h.call('bash', { command: 'echo hi >| secret.txt' });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain('rule: **/secret.txt');
      expect(await readFile(h.file('secret.txt'), 'utf8')).toBe('original\n');

      const digit = await h.call('bash', { command: 'echo hi >2secret.txt' });
      expect(digit.isError).toBe(true);
      expect(textOf(digit)).toContain('rule: **/2secret.txt');
      expect(existsSync(h.file('2secret.txt'))).toBe(false);

      const outsideWrite = await h.call('bash', { command: `echo hi >| ${escaped}` });
      expect(outsideWrite.isError).toBe(true);
      expect(textOf(outsideWrite)).toContain('outside the workspace');
      expect(existsSync(escaped)).toBe(false);

      const linked = await h.call('bash', { command: 'echo hi >| escape-link' });
      expect(linked.isError).toBe(true);
      expect(textOf(linked)).toContain('outside the workspace');
      expect(existsSync(escaped)).toBe(false);

      const ignoreFile = await h.call('bash', { command: 'echo CLEARED >| .gitignore' });
      expect(ignoreFile.isError).toBe(true);
      expect(textOf(ignoreFile)).toContain('Blocked: .gitignore is protected and cannot be changed by the agent');
      expect(await readFile(h.file('.gitignore'), 'utf8')).toBe('ignored.txt\n');

      const ignored = await h.call('bash', { command: 'echo hi >| ignored.txt' });
      expect(ignored.isError).toBe(true);
      expect(textOf(ignored)).toContain('Path ignored.txt is filtered out by .gitignore');
      expect(existsSync(h.file('ignored.txt'))).toBe(false);

      const hidden = await h.call('bash', { command: 'echo hi >| hidden.txt' });
      expect(hidden.isError).toBe(true);
      expect(textOf(hidden)).toContain('Path hidden.txt is filtered out by .piignore');
      expect(h.confirmations).toHaveLength(0);

      const fd = await h.call('bash', { command: 'echo hi >&2' });
      expect(fd.isError).toBeUndefined();
      expect(textOf(fd)).toContain('hi');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: printf -v cannot assign a resolution variable', () => {
  it('refuses printf -v of a resolution variable and still allows other names', async () => {
    for (const name of ['PS4', 'BASH_ENV', 'ENV', 'CDPATH', 'IFS', 'GIT_EXTERNAL_DIFF', 'GIT_CONFIG_COUNT']) {
      expect(analyzeShellCommand(`printf -v ${name} value`).untrusted, name).toContain(name);
      expect(analyzeShellCommand(`printf -v${name} value`).untrusted, name).toContain(name);
    }
    expect(analyzeShellCommand('printf -v FOO bar').untrusted).toBeUndefined();
    expect(analyzeShellCommand('export BASH_ENV').untrusted).toBeUndefined();
    expect(analyzeShellCommand('BASH_ENV=evil').untrusted).toContain('BASH_ENV');

    const h = await createHarness({ hasUI: false, config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    const outside = path.join(h.root, 'ps4-touched');
    try {
      await h.write('.env', 'TOKEN=super-secret\n');
      const ps4 = await h.call('bash', { command: `printf -v PS4 '$(touch ${outside})'; set -x; :` });
      expect(ps4.isError).toBe(true);
      expect(textOf(ps4)).toContain('PS4');
      expect(existsSync(outside)).toBe(false);

      const printed = await h.call('bash', { command: `printf -v PS4 '$(cat .env >&2)'; set -x; :` });
      expect(printed.isError).toBe(true);
      expect(textOf(printed)).toContain('PS4');
      expect(textOf(printed)).not.toContain('TOKEN=super-secret');

      const bashenv = await h.call('bash', { command: `printf 'echo BASHENV > ${outside}\\n' > evil.sh; printf -v BASH_ENV "$PWD/evil.sh"; export BASH_ENV; bash -c true` });
      expect(bashenv.isError).toBe(true);
      expect(textOf(bashenv)).toContain('BASH_ENV');
      expect(existsSync(outside)).toBe(false);
      expect(existsSync(h.file('evil.sh'))).toBe(false);

      const allowed = await h.call('bash', { command: 'printf -v FOO bar; printf %s "$FOO"' });
      expect(allowed.isError).toBeUndefined();
      expect(textOf(allowed)).toContain('bar');

      const exported = await h.call('bash', { command: 'export BASH_ENV; printf ok' });
      expect(exported.isError).toBeUndefined();
      expect(textOf(exported)).toContain('ok');
      expect(h.confirmations).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: git destination operands are writes', () => {
  it('asks before git writes outside and keeps ordinary git commands', async () => {
    const outside = '/tmp/pi-tools-git-dest';
    expect(analyzeShellCommand(`git apply --directory=${outside} p.diff`).paths).toContainEqual({ path: outside, write: true });
    expect(analyzeShellCommand(`git apply --directory ${outside} p.diff`).paths).toContainEqual({ path: outside, write: true });
    expect(analyzeShellCommand(`git apply --unsafe-paths --directory=${outside} p.diff`).paths).toContainEqual({ path: 'p.diff', write: false });
    // `git apply` reads the paths it writes from the patch file, so it is refused outright.
    expect(analyzeShellCommand('git apply p.diff').untrusted).toContain('patch file');
    expect(analyzeShellCommand(`git init ${outside}/repo`).paths).toContainEqual({ path: `${outside}/repo`, write: true });
    expect(analyzeShellCommand(`git init -q --template=/tmp/tmpl ${outside}/repo`).paths).toContainEqual({ path: `${outside}/repo`, write: true });
    expect(analyzeShellCommand(`git init --shared ${outside}/repo`).paths).toContainEqual({ path: `${outside}/repo`, write: true });
    expect(analyzeShellCommand(`git archive -o ${outside}/a.tar HEAD`).paths).toContainEqual({ path: `${outside}/a.tar`, write: true });
    expect(analyzeShellCommand(`git archive -o${outside}/a.tar HEAD`).paths).toContainEqual({ path: `${outside}/a.tar`, write: true });
    expect(analyzeShellCommand(`git archive --output=${outside}/a.tar HEAD`).paths).toContainEqual({ path: `${outside}/a.tar`, write: true });
    expect(analyzeShellCommand(`git archive --output ${outside}/a.tar HEAD`).paths).toContainEqual({ path: `${outside}/a.tar`, write: true });
    expect(analyzeShellCommand(`git clone https://example.com ${outside}/clone`).paths).toContainEqual({ path: `${outside}/clone`, write: true });
    expect(analyzeShellCommand(`git clone -o origin https://example.com ${outside}/clone`).paths).toContainEqual({ path: `${outside}/clone`, write: true });
    expect(analyzeShellCommand(`git clone -o origin https://example.com ${outside}/clone`).paths.some((entry) => entry.path === 'origin')).toBe(false);
    expect(analyzeShellCommand('git clone https://example.com').paths.some((entry) => entry.write)).toBe(false);
    expect(analyzeShellCommand(`git worktree add ${outside}/wt`).paths).toContainEqual({ path: `${outside}/wt`, write: true });
    expect(analyzeShellCommand(`git worktree add -b feature ${outside}/wt`).paths).toContainEqual({ path: `${outside}/wt`, write: true });
    expect(analyzeShellCommand('git worktree list').paths.some((entry) => entry.write)).toBe(false);
    expect(analyzeShellCommand(`git format-patch -o ${outside}/patches HEAD`).paths).toContainEqual({ path: `${outside}/patches`, write: true });
    expect(analyzeShellCommand(`git format-patch --output-directory=${outside}/patches HEAD`).paths).toContainEqual({ path: `${outside}/patches`, write: true });
    expect(analyzeShellCommand(`git bundle create ${outside}/a.bundle HEAD`).paths).toContainEqual({ path: `${outside}/a.bundle`, write: true });
    expect(analyzeShellCommand(`git bundle verify ${outside}/a.bundle`).paths).toContainEqual({ path: `${outside}/a.bundle`, write: false });
    for (const command of ['git status', 'git add file', 'git commit -m init', 'git log', 'git diff']) {
      expect(analyzeShellCommand(command).untrusted, command).toBeUndefined();
      expect(
        analyzeShellCommand(command).paths.some((entry) => entry.write),
        command,
      ).toBe(false);
    }
    expect(directoryChanges(`git -C ${outside} status`)).toEqual([outside]);
    expect(directoryChanges(`git --git-dir ${outside}/.git status`)).toEqual([`${outside}/.git`]);
    expect(directoryChanges(`git --work-tree ${outside} status`)).toEqual([outside]);
    expect(analyzeShellCommand('git diff --no-index -- /dev/null secret.txt').paths).toContainEqual({ path: 'secret.txt', write: false });

    const h = await createHarness({ hasUI: false });
    const dest = path.join(h.root, 'applied.txt');
    const repo = path.join(h.root, 'newrepo');
    const archive = path.join(h.root, 'snapshot.tar');
    const fromTool = path.join(h.root, 'fromtool');
    try {
      await writeFile(dest, 'old\n');
      await h.write(
        'p.diff',
        `diff --git a/applied.txt b/applied.txt
--- a/applied.txt
+++ b/applied.txt
@@ -1 +1 @@
-old
+new
`,
      );
      const applied = await h.call('bash', { command: `git apply --unsafe-paths --directory=${h.root} p.diff` });
      expect(applied.isError).toBe(true);
      expect(textOf(applied)).toContain('patch file');
      expect(await readFile(dest, 'utf8')).toBe('old\n');

      const init = await h.call('bash', { command: `git init -q ${repo}` });
      expect(init.isError).toBe(true);
      expect(textOf(init)).toContain('outside the workspace');
      expect(existsSync(path.join(repo, '.git'))).toBe(false);

      const archived = await h.call('bash', { command: `git archive -o ${archive} HEAD` });
      expect(archived.isError).toBe(true);
      expect(textOf(archived)).toContain('outside the workspace');
      expect(existsSync(archive)).toBe(false);

      const tool = await h.call('git', { subcommand: 'init', args: [fromTool] });
      expect(tool.isError).toBe(true);
      expect(textOf(tool)).toContain('outside the workspace');
      expect(existsSync(path.join(fromTool, '.git'))).toBe(false);

      const inside = await h.call('bash', {
        command:
          'git init -q . && git add p.diff && git -c user.email=a@b.c -c user.name=Ada commit -qm init && git status --porcelain && git diff && git log --oneline && git clone . clone-out && git worktree add wt HEAD && git format-patch -o patches HEAD && git bundle create repo.bundle HEAD',
      });
      expect(inside.isError).toBeUndefined();
      expect(existsSync(h.file('clone-out'))).toBe(true);
      expect(existsSync(h.file('wt'))).toBe(true);
      expect(existsSync(h.file('repo.bundle'))).toBe(true);
      expect(h.confirmations).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5: ditto, zip, unlink, rmdir, and shred destinations are writes', () => {
  it('refuses outside deletes and archive destinations, and keeps a source-only ditto and zip -l', async () => {
    const outside = '/tmp/pi-tools-writers';
    expect(analyzeShellCommand(`ditto notes.txt ${outside}/copy`).paths).toContainEqual({ path: 'notes.txt', write: false });
    expect(analyzeShellCommand(`ditto notes.txt ${outside}/copy`).paths).toContainEqual({ path: `${outside}/copy`, write: true });
    expect(analyzeShellCommand('ditto notes.txt').paths).toEqual([{ path: 'notes.txt', write: false }]);
    expect(analyzeShellCommand(`zip -q ${outside}/notes.zip notes.txt`).paths).toContainEqual({ path: `${outside}/notes.zip`, write: true });
    expect(analyzeShellCommand(`zip -q ${outside}/notes.zip notes.txt`).paths).toContainEqual({ path: 'notes.txt', write: false });
    expect(analyzeShellCommand('zip -l archive.zip notes.txt').paths).toContainEqual({ path: 'archive.zip', write: false });
    expect(analyzeShellCommand(`unlink ${outside}/file`).paths).toContainEqual({ path: `${outside}/file`, write: true });
    expect(analyzeShellCommand(`rmdir ${outside}/dir`).paths).toContainEqual({ path: `${outside}/dir`, write: true });
    expect(analyzeShellCommand(`shred -u ${outside}/file`).paths).toContainEqual({ path: `${outside}/file`, write: true });

    const h = await createHarness({ hasUI: false });
    const file = path.join(h.root, 'doomed.txt');
    const second = path.join(h.root, 'doomed2.txt');
    const dir = path.join(h.root, 'doomed-dir');
    const copy = path.join(h.root, 'notes-copy');
    const zip = path.join(h.root, 'notes.zip');
    try {
      await h.write('notes.txt', 'hello-notes\n');
      await h.write('.piignore', 'secret.txt\n');
      await writeFile(file, 'keep\n');
      await writeFile(second, 'keep\n');
      await mkdir(dir);

      const ditto = await h.call('bash', { command: `ditto notes.txt ${copy}` });
      expect(ditto.isError).toBe(true);
      expect(textOf(ditto)).toContain('outside the workspace');
      expect(existsSync(copy)).toBe(false);

      const zipped = await h.call('bash', { command: `zip -q ${zip} notes.txt` });
      expect(zipped.isError).toBe(true);
      expect(textOf(zipped)).toContain('outside the workspace');
      expect(existsSync(zip)).toBe(false);

      const unlinked = await h.call('bash', { command: `unlink ${file}` });
      expect(unlinked.isError).toBe(true);
      expect(textOf(unlinked)).toContain('outside the workspace');
      expect(await readFile(file, 'utf8')).toBe('keep\n');

      const shredded = await h.call('bash', { command: `shred -u ${second}` });
      expect(shredded.isError).toBe(true);
      expect(textOf(shredded)).toContain('outside the workspace');
      expect(await readFile(second, 'utf8')).toBe('keep\n');

      const removed = await h.call('bash', { command: `rmdir ${dir}` });
      expect(removed.isError).toBe(true);
      expect(textOf(removed)).toContain('outside the workspace');
      expect(existsSync(dir)).toBe(true);

      const ignore = await h.call('bash', { command: 'unlink .piignore' });
      expect(ignore.isError).toBe(true);
      expect(textOf(ignore)).toContain('Blocked: .piignore is protected and cannot be changed by the agent');
      expect(existsSync(h.file('.piignore'))).toBe(true);

      const listed = await h.call('bash', { command: 'zip -l notes.zip notes.txt' });
      expect(listed.isError).toBeUndefined();
      expect(existsSync(h.file('notes.zip'))).toBe(true);

      const onlySource = await h.call('bash', { command: 'ditto notes.txt' });
      expect(textOf(onlySource)).not.toContain('outside the workspace');
      expect(textOf(onlySource)).not.toContain('Blocked');

      const copied = await h.call('bash', { command: 'ditto notes.txt notes-copy.txt' });
      expect(copied.isError).toBeUndefined();
      expect(await readFile(h.file('notes-copy.txt'), 'utf8')).toBe('hello-notes\n');
      expect(h.confirmations).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: git bisect run is an indirect command', () => {
  it('refuses git bisect run and still allows start, good, bad, and reset', async () => {
    expect(analyzeShellCommand('git bisect run rm -rf /outside/victim').untrusted).toContain('git bisect run');
    for (const command of ['git bisect start', 'git bisect good', 'git bisect bad', 'git bisect reset']) {
      expect(analyzeShellCommand(command).untrusted, command).toBeUndefined();
    }

    const h = await createHarness({ hasUI: false, config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'rm *' }] } });
    const victim = path.join(h.root, 'victim.txt');
    try {
      await writeFile(victim, 'important\n');
      const ran = await h.call('bash', { command: `git bisect run rm -rf ${victim}` });
      expect(ran.isError).toBe(true);
      expect(textOf(ran)).toContain('git bisect run');
      expect(textOf(ran)).toContain('does not follow');
      expect(await readFile(victim, 'utf8')).toBe('important\n');

      const reset = await h.call('bash', { command: 'git init -q . && git bisect reset' });
      expect(reset.isError).toBeUndefined();
      expect(textOf(reset)).not.toContain('does not follow');
      expect(h.confirmations).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: every redirect hop must be http or https', () => {
  it('rejects a file redirect before fetching it and still follows an https redirect', async () => {
    const seen: string[] = [];
    const h = await createHarness({
      config: { mode: 'unrestricted' },
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        seen.push(url);
        if (url === 'http://127.0.0.1/file') {
          return new Response(null, { status: 302, headers: { location: 'file:///etc/hosts' } });
        }
        if (url === 'http://127.0.0.1/next') {
          return new Response(null, { status: 302, headers: { location: 'https://example.com/landed' } });
        }
        if (url === 'https://example.com/landed') {
          return new Response('LANDED-BODY', { status: 200, headers: { 'content-type': 'text/plain' } });
        }
        return new Response('TOKEN=from-local-file', { status: 200, headers: { 'content-type': 'text/plain' } });
      }) as typeof fetch,
    });
    try {
      const blocked = await h.call('web_fetch', { url: 'http://127.0.0.1/file' });
      expect(blocked.isError).toBe(true);
      expect(textOf(blocked)).toContain('Unsupported URL scheme: file:');
      expect(textOf(blocked)).not.toContain('TOKEN=from-local-file');
      expect(seen.some((url) => url.startsWith('file:'))).toBe(false);

      const followed = await h.call('web_fetch', { url: 'http://127.0.0.1/next' });
      expect(followed.isError).toBeUndefined();
      expect(textOf(followed)).toContain('LANDED-BODY');
      expect(seen).toContain('https://example.com/landed');
    } finally {
      await h.cleanup();
    }
  });
});
