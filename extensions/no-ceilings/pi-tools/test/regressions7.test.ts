import { existsSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the seventh adversarial pass, shell analysis and write gating. Each test names the finding it locks down. */

describe('finding 1: trap with an action runs a command the analyzer does not follow', () => {
  it('refuses a trap action and keeps a reset, an empty action, and a bare trap', async () => {
    const h = await createHarness({ hasUI: false });
    try {
      const marker = path.join(h.root, 'trapped');
      const command = `trap 'touch ${marker}' EXIT; true`;
      expect(analyzeShellCommand(command).untrusted).toContain('trap');
      expect(analyzeShellCommand(`trap touch ${marker} EXIT`).untrusted).toContain('trap');
      expect(analyzeShellCommand(`trap -- 'touch ${marker}' EXIT`).untrusted).toContain('trap');
      expect(analyzeShellCommand('trap - EXIT').untrusted).toBeUndefined();
      expect(analyzeShellCommand("trap '' EXIT").untrusted).toBeUndefined();
      expect(analyzeShellCommand('trap').untrusted).toBeUndefined();
      expect(analyzeShellCommand('trap -p EXIT').untrusted).toBeUndefined();
      expect(analyzeShellCommand('trap -l').untrusted).toBeUndefined();

      const trapped = await h.call('bash', { command });
      expect(trapped.isError).toBe(true);
      expect(textOf(trapped)).toContain('trap');
      expect(existsSync(marker)).toBe(false);

      const reset = await h.call('bash', { command: 'trap - EXIT; true' });
      expect(reset.isError).toBeUndefined();
      const ignored = await h.call('bash', { command: "trap '' EXIT; true" });
      expect(ignored.isError).toBeUndefined();
      const listed = await h.call('bash', { command: 'trap -p' });
      expect(listed.isError).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: PS4 is expanded by xtrace', () => {
  it('refuses a PS4 assignment and scrubs PS4 from the command environment', async () => {
    for (const command of ['PS4=$(id)', 'export PS4=x', 'declare PS4=x', 'typeset PS4=x', 'readonly PS4=x', 'env PS4=x true']) {
      expect(analyzeShellCommand(command).untrusted, command).toContain('PS4');
    }
    expect(analyzeShellCommand('set -x; true').untrusted).toBeUndefined();
    expect(analyzeShellCommand('export FOO=1').untrusted).toBeUndefined();

    const h = await createHarness({ hasUI: false });
    try {
      const marker = path.join(h.root, 'ps4');
      const assigned = `PS4='$(touch ${marker}) '; set -x; true`;
      expect(analyzeShellCommand(assigned).untrusted).toContain('PS4');
      const refused = await h.call('bash', { command: assigned });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain('PS4');
      expect(existsSync(marker)).toBe(false);

      const inherited = await h.call('bash', { command: 'set -x; true', env: { PS4: `$(touch ${marker}) ` } });
      expect(inherited.isError).toBeUndefined();
      expect(existsSync(marker)).toBe(false);

      const plain = await h.call('bash', { command: 'set -x; echo plain-xtrace' });
      expect(plain.isError).toBeUndefined();
      expect(textOf(plain)).toContain('plain-xtrace');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: git -c keys that name a command', () => {
  it('refuses command config keys and keeps an ordinary git -c value', async () => {
    const keys = [
      'core.fsmonitor',
      'diff.external',
      'core.editor',
      'core.pager',
      'core.askpass',
      'core.sshCommand',
      'core.hooksPath',
      'credential.helper',
      'gpg.program',
      'sequence.editor',
      'alias.pwn',
      'diff.html.command',
      'filter.lfs.clean',
      'filter.lfs.smudge',
      'merge.ours.driver',
    ];
    for (const key of keys) {
      expect(analyzeShellCommand(`git -c ${key}=touch status`).untrusted, key).toContain('does not follow');
      expect(analyzeShellCommand(`git -c ${key.toUpperCase()}=touch status`).untrusted, key).toContain('does not follow');
    }
    expect(analyzeShellCommand('git -c user.name=Ada status').untrusted).toBeUndefined();
    expect(analyzeShellCommand("git -c 'alias.pwn=!id' pwn").untrusted).toContain('does not follow');

    const h = await createHarness({ hasUI: false });
    try {
      const marker = path.join(h.root, 'fsmonitor');
      const hooked = await h.call('bash', { command: `git init -q && git -c core.fsmonitor='touch ${marker}' status` });
      expect(hooked.isError).toBe(true);
      expect(textOf(hooked)).toContain('does not follow');
      expect(existsSync(marker)).toBe(false);

      const diff = await h.call('bash', { command: `git init -q && echo a > a.txt && git add a.txt && git -c diff.external='touch ${marker}' diff --cached` });
      expect(diff.isError).toBe(true);
      expect(existsSync(marker)).toBe(false);

      await h.call('bash', { command: 'git init -q' });
      const ordinary = await h.call('bash', { command: 'git -c user.name=Ada status' });
      expect(textOf(ordinary)).not.toContain('does not follow');
      expect(ordinary.isError).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: git config variables in the command environment', () => {
  it('refuses GIT_CONFIG_ and GIT_EXTERNAL_DIFF before the command runs', async () => {
    const h = await createHarness({ hasUI: false });
    const previous = process.env['GIT_CONFIG_COUNT'];
    process.env['GIT_CONFIG_COUNT'] = 'from-parent';
    try {
      const marker = path.join(h.root, 'git-config');
      const configured = await h.call('bash', {
        command: 'git pwn',
        env: {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'alias.pwn',
          GIT_CONFIG_VALUE_0: `!touch ${marker}`,
        },
      });
      expect(configured.isError).toBe(true);
      expect(textOf(configured)).toContain('GIT_CONFIG_COUNT');
      expect(existsSync(marker)).toBe(false);
      expect(process.env['GIT_CONFIG_COUNT']).toBe('from-parent');

      const external = await h.call('bash', { command: 'git diff', env: { GIT_EXTERNAL_DIFF: `touch ${marker}` } });
      expect(external.isError).toBe(true);
      expect(textOf(external)).toContain('GIT_EXTERNAL_DIFF');
      expect(existsSync(marker)).toBe(false);

      const inline = `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.pwn GIT_CONFIG_VALUE_0='!touch ${marker}' git pwn`;
      expect(analyzeShellCommand(inline).untrusted).toContain('GIT_CONFIG_COUNT');
      const assigned = await h.call('bash', { command: inline });
      expect(assigned.isError).toBe(true);
      expect(existsSync(marker)).toBe(false);

      const plain = await h.call('bash', { command: 'printf %s "$FOO"', env: { FOO: 'kept' } });
      expect(plain.isError).toBeUndefined();
      expect(textOf(plain)).toContain('kept');
    } finally {
      if (previous === undefined) {
        delete process.env['GIT_CONFIG_COUNT'];
      } else {
        process.env['GIT_CONFIG_COUNT'] = previous;
      }
      await h.cleanup();
    }
  });
});

describe('finding 5: install, sed -i, and perl -i write their targets', () => {
  it('gates outside destinations and keeps sed and perl read-only without an in-place flag', async () => {
    const h = await createHarness({ hasUI: false });
    try {
      await h.write('inside.txt', 'hello\n');
      const installed = path.join(h.root, 'installed.txt');
      const installCommand = `install inside.txt ${installed}`;
      expect(analyzeShellCommand(installCommand).paths).toContainEqual({ path: installed, write: true });
      expect(analyzeShellCommand(installCommand).paths).toContainEqual({ path: 'inside.txt', write: false });
      const install = await h.call('bash', { command: installCommand });
      expect(install.isError).toBe(true);
      expect(textOf(install)).toContain('outside the workspace');
      expect(existsSync(installed)).toBe(false);

      const copied = await h.call('bash', { command: 'install inside.txt copied.txt' });
      expect(copied.isError).toBeUndefined();
      expect(await readFile(h.file('copied.txt'), 'utf8')).toBe('hello\n');

      const made = path.join(h.root, 'newdir');
      const directory = `install -d ${made}`;
      expect(analyzeShellCommand(directory).paths).toContainEqual({ path: made, write: true });
      const created = await h.call('bash', { command: directory });
      expect(created.isError).toBe(true);
      expect(existsSync(made)).toBe(false);
      const nested = await h.call('bash', { command: 'install -d sub/nested' });
      expect(nested.isError).toBeUndefined();

      const edited = path.join(h.root, 'edited.txt');
      await writeFile(edited, 'hello\n');
      for (const command of [
        `sed -i '' 's/hello/pwned/' ${edited}`,
        `sed -i.bak 's/hello/pwned/' ${edited}`,
        `sed -ni '' 's/hello/pwned/' ${edited}`,
        `sed --in-place 's/hello/pwned/' ${edited}`,
        `perl -pi -e 's/hello/pwned/' ${edited}`,
        `perl -i.bak -pe 's/hello/pwned/' ${edited}`,
      ]) {
        expect(
          analyzeShellCommand(command).paths.some((entry) => entry.path === edited && entry.write),
          command,
        ).toBe(true);
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(await readFile(edited, 'utf8')).toBe('hello\n');
      }

      const readonlySed = await h.call('bash', { command: `sed -n 's/hello/pwned/p' ${edited}` });
      expect(readonlySed.isError).toBeUndefined();
      expect(textOf(readonlySed)).toContain('pwned');
      expect(await readFile(edited, 'utf8')).toBe('hello\n');
      expect(analyzeShellCommand(`sed -n 's/hello/pwned/' ${edited}`).paths.some((entry) => entry.path === edited && entry.write)).toBe(false);

      const readonlyPerl = await h.call('bash', { command: 'perl -e \'print "perl-ok\\n"\'' });
      expect(readonlyPerl.isError).toBeUndefined();
      expect(textOf(readonlyPerl)).toContain('perl-ok');
      expect(analyzeShellCommand(`perl -e 'print' ${edited}`).paths.some((entry) => entry.write)).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: a redirect target stops at the next redirect', () => {
  it('records both targets and refuses the outside one', async () => {
    const h = await createHarness({ hasUI: false });
    try {
      const outside = path.join(h.root, 'escaped.txt');
      const command = `echo hi>inside.txt>${outside}`;
      const paths = analyzeShellCommand(command).paths;
      expect(paths).toContainEqual({ path: 'inside.txt', write: true });
      expect(paths).toContainEqual({ path: outside, write: true });
      const result = await h.call('bash', { command });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('outside the workspace');
      expect(existsSync(outside)).toBe(false);
      expect(existsSync(h.file('inside.txt'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 8: digits before a redirect stay with the word they continue', () => {
  it('keeps the operand secret2.txt2 and still treats a leading fd as a redirect', async () => {
    const command = 'cat secret2.txt2>leak.txt';
    const paths = analyzeShellCommand(command).paths;
    expect(paths).toContainEqual({ path: 'secret2.txt2', write: false });
    expect(paths).toContainEqual({ path: 'leak.txt', write: true });
    expect(paths.some((entry) => entry.path === 'secret2.txt')).toBe(false);
    expect(analyzeShellCommand('echo 2>leak.txt').segments).toEqual(['echo']);
    expect(analyzeShellCommand('cat secret2.txt 2>leak.txt').paths).toContainEqual({ path: 'secret2.txt', write: false });

    const h = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/secret2.txt2' }] } });
    try {
      await h.write('secret2.txt2', 'TOP SECRET\n');
      const result = await h.call('bash', { command });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('rule: **/secret2.txt2');
      expect(textOf(result)).not.toContain('TOP SECRET');
      await expect(readFile(h.file('leak.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 13: a redirect to /dev/null is not an outside write', () => {
  it('runs cat a.txt 2>/dev/null without a prompt and still gates other targets and deny rules', async () => {
    const headless = await createHarness({ hasUI: false });
    try {
      await headless.write('a.txt', 'x\n');
      const result = await headless.call('bash', { command: 'cat a.txt 2>/dev/null' });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('x');
      expect(headless.confirmations).toHaveLength(0);

      const outside = path.join(headless.root, 'out.txt');
      const gated = await headless.call('bash', { command: `echo hi > ${outside}` });
      expect(gated.isError).toBe(true);
      expect(textOf(gated)).toContain('outside the workspace');
      expect(existsSync(outside)).toBe(false);
    } finally {
      await headless.cleanup();
    }

    const prompted = await createHarness({ hasUI: true, confirm: true });
    try {
      await prompted.write('a.txt', 'x\n');
      const result = await prompted.call('bash', { command: 'cat a.txt 2>/dev/null' });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('x');
      expect(prompted.confirmations).toHaveLength(0);
    } finally {
      await prompted.cleanup();
    }

    const denied = await createHarness({ config: { rules: [{ kind: 'write', action: 'deny', pattern: '/dev/null' }] } });
    try {
      await denied.write('a.txt', 'x\n');
      const result = await denied.call('bash', { command: 'cat a.txt 2>/dev/null' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('/dev/null');
      expect(textOf(result)).not.toContain('x');
    } finally {
      await denied.cleanup();
    }
  });
});

describe('finding 6: a full read stays fenced for the session', () => {
  it('refuses a write after a thousand later reads', async () => {
    const h = await createHarness();
    try {
      await h.write('fenced.txt', 'original\n');
      await h.call('read', { path: 'fenced.txt' });
      await writeFile(h.file('fenced.txt'), 'external\n');
      for (let index = 0; index < 1000; index++) {
        await h.write(`pad/p${index}.txt`, 'x\n');
        await h.call('read', { path: `pad/p${index}.txt` });
      }
      const write = await h.call('write', { path: 'fenced.txt', content: 'clobber\n' });
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('changed on disk');
      expect(textOf(write)).toContain('Nothing was written');
      expect(await readFile(h.file('fenced.txt'), 'utf-8')).toBe('external\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 9: a dash line inside a hunk is not a file header', () => {
  it('applies a counted dash line and refuses a short or unanchored hunk', async () => {
    const valid = await createHarness();
    try {
      await valid.write('f.txt', 'one\ntwo\n-- x\nkeep\n');
      const patch = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,4 +1,4 @@', ' one', ' two', '--- x', '+++ y', ' keep', ''].join('\n');
      const result = await valid.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(valid.file('f.txt'), 'utf-8')).toBe('one\ntwo\n++ y\nkeep\n');
    } finally {
      await valid.cleanup();
    }

    const covered = await createHarness();
    try {
      await covered.write('f.txt', 'one\ntwo\n-- x\n');
      const patch = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,3 +1,3 @@', '-one', '+ONE', ' two', '--- x', '+++ y', ''].join('\n');
      const result = await covered.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(covered.file('f.txt'), 'utf-8')).toBe('ONE\ntwo\n++ y\n');
    } finally {
      await covered.cleanup();
    }

    const corrupt = await createHarness();
    try {
      await corrupt.write('f.txt', 'one\ntwo\n-- x\nkeep\nmore\n');
      await corrupt.write('y', 'keep\nmore\n');
      const patch = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,3 +1,3 @@', '-one', '+ONE', ' two', '--- x', '+++ y', '@@ -4,2 +4,2 @@', ' keep', '-more', '+MORE', ''].join('\n');
      const result = await corrupt.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Nothing was written');
      expect(await readFile(corrupt.file('f.txt'), 'utf-8')).toBe('one\ntwo\n-- x\nkeep\nmore\n');
      expect(await readFile(corrupt.file('y'), 'utf-8')).toBe('keep\nmore\n');
    } finally {
      await corrupt.cleanup();
    }

    const short = await createHarness();
    try {
      await short.write('f.txt', 'one\n');
      const patch = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,3 +1,3 @@', '-one', '+ONE', ''].join('\n');
      const result = await short.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('counts');
      expect(textOf(result)).toContain('Nothing was written');
      expect(await readFile(short.file('f.txt'), 'utf-8')).toBe('one\n');
    } finally {
      await short.cleanup();
    }
  });
});

describe('finding 10: a failed edit keeps the read fence', () => {
  it('refuses a later write after a no-match edit', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'original\n');
      await h.call('read', { path: 'a.txt' });
      const bad = await h.call('edit', { path: 'a.txt', edits: [{ oldText: 'not in the file', newText: 'x' }] });
      expect(bad.isError).toBe(true);
      expect(textOf(bad)).toContain('Nothing was written');
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('original\n');
      await writeFile(h.file('a.txt'), 'external change\n');
      const write = await h.call('write', { path: 'a.txt', content: 'clobbered\n' });
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('changed on disk');
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('external change\n');
    } finally {
      await h.cleanup();
    }
  });

  it.skipIf(process.getuid?.() === 0)('restores the fence after a failed write', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'original\n');
      await h.call('read', { path: 'a.txt' });
      await chmod(h.file('a.txt'), 0o444);
      const failed = await h.call('write', { path: 'a.txt', content: 'agent\n' });
      expect(failed.isError).toBe(true);
      await chmod(h.file('a.txt'), 0o644);
      await writeFile(h.file('a.txt'), 'external change\n');
      const write = await h.call('write', { path: 'a.txt', content: 'clobbered\n' });
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('changed on disk');
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('external change\n');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses a later write after an overlapping edit', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'abcdef\n');
      await h.call('read', { path: 'a.txt' });
      const bad = await h.call('edit', {
        path: 'a.txt',
        edits: [
          { oldText: 'abcd', newText: 'X' },
          { oldText: 'cdef', newText: 'Y' },
        ],
      });
      expect(bad.isError).toBe(true);
      expect(textOf(bad)).toContain('overlap');
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('abcdef\n');
      await writeFile(h.file('a.txt'), 'external change\n');
      const write = await h.call('write', { path: 'a.txt', content: 'clobbered\n' });
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('changed on disk');
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('external change\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 11: duplicate add sections keep every line', () => {
  it('concatenates directive adds and unified adds of the same new file', async () => {
    const directives = await createHarness();
    try {
      const patch = ['*** Begin Patch', '*** Add File: new.txt', '+first', '*** Add File: new.txt', '+second', '*** End Patch', ''].join('\n');
      const result = await directives.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(directives.file('new.txt'), 'utf-8')).toBe('first\nsecond\n');
    } finally {
      await directives.cleanup();
    }

    const unified = await createHarness();
    try {
      const patch = ['--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1 @@', '+first', '--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1 @@', '+second', ''].join('\n');
      const result = await unified.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(unified.file('new.txt'), 'utf-8')).toBe('first\nsecond\n');
    } finally {
      await unified.cleanup();
    }
  });
});

describe('finding 12: a pure move renames the file', () => {
  it('renames from a hunkless move directive and from a git rename diff', async () => {
    const directives = await createHarness();
    try {
      await directives.write('src.txt', 'same\n');
      const patch = ['*** Begin Patch', '*** Update File: src.txt', '*** Move to: dst.txt', '*** End Patch'].join('\n');
      const result = await directives.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(directives.file('dst.txt'), 'utf-8')).toBe('same\n');
      await expect(readFile(directives.file('src.txt'), 'utf-8')).rejects.toThrow();
    } finally {
      await directives.cleanup();
    }

    const renamed = await createHarness();
    try {
      await renamed.write('src.txt', 'same\n');
      const patch = ['diff --git a/src.txt b/dst.txt', 'similarity index 100%', 'rename from src.txt', 'rename to dst.txt', ''].join('\n');
      const result = await renamed.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(renamed.file('dst.txt'), 'utf-8')).toBe('same\n');
      await expect(readFile(renamed.file('src.txt'), 'utf-8')).rejects.toThrow();
    } finally {
      await renamed.cleanup();
    }
  });

  it('keeps a rename with edits and still refuses a no-op that names no move', async () => {
    const edited = await createHarness();
    try {
      await edited.write('src.txt', 'same\n');
      const patch = ['diff --git a/src.txt b/dst.txt', 'similarity index 90%', 'rename from src.txt', 'rename to dst.txt', '--- a/src.txt', '+++ b/dst.txt', '@@ -1 +1 @@', '-same', '+changed', ''].join('\n');
      const result = await edited.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(edited.file('dst.txt'), 'utf-8')).toBe('changed\n');
      await expect(readFile(edited.file('src.txt'), 'utf-8')).rejects.toThrow();
    } finally {
      await edited.cleanup();
    }

    const noop = await createHarness();
    try {
      await noop.write('src.txt', 'same\n');
      const patch = ['*** Begin Patch', '*** Update File: src.txt', '@@', ' same', '*** End Patch'].join('\n');
      const result = await noop.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('no changes');
      expect(await readFile(noop.file('src.txt'), 'utf-8')).toBe('same\n');
    } finally {
      await noop.cleanup();
    }
  });
});
