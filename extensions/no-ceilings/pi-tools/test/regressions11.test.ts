import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the eleventh adversarial pass, wave A. Each test names the finding it locks down. */

const untrustedOf = (command: string): string | undefined => analyzeShellCommand(command, '/home/tester').untrusted;
const writesOf = (command: string): string[] =>
  analyzeShellCommand(command, '/home/tester')
    .paths.filter((entry) => entry.write)
    .map((entry) => entry.path);

describe('finding 1: a recursive reader prints denied and ignored file bodies', () => {
  it('refuses a recursive grep and a directory-walking reader in a shell command', () => {
    for (const command of ['grep -r NEEDLE .', 'grep -R NEEDLE .', 'grep -rn NEEDLE .', 'grep -RIn NEEDLE .', 'grep --recursive NEEDLE .', 'grep --dereference-recursive NEEDLE .', 'egrep -r NEEDLE .', 'fgrep -r NEEDLE .']) {
      expect(untrustedOf(command), command).toContain('recurses into directories');
    }
    for (const command of ['rg NEEDLE', 'rg --hidden -n NEEDLE .', 'ag NEEDLE', 'ack NEEDLE']) {
      expect(untrustedOf(command), command).toContain('walks directories by default');
    }

    // A single named file keeps working, and a flag value that spells `r` is not a recursive flag.
    expect(untrustedOf('grep NEEDLE file.txt')).toBeUndefined();
    expect(untrustedOf('grep -c NEEDLE file.txt')).toBeUndefined();
    expect(untrustedOf('grep -A 2 NEEDLE file.txt')).toBeUndefined();
    expect(untrustedOf("grep -e '-rn' file.txt")).toBeUndefined();
    expect(untrustedOf('grep -- -r file.txt')).toBeUndefined();
    expect(untrustedOf('ls file.txt')).toBeUndefined();
  });

  it('returns neither a read-denied nor an ignored file through bash, while the grep tool still searches', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] },
    });
    try {
      await h.write('.env', 'TOPSECRET=1\n');
      await h.write('.piignore', 'ignored.txt\n');
      await h.write('ignored.txt', 'IGNORED-SECRET\n');
      await h.write('plain.txt', 'plain\n');

      for (const command of ['grep -rn TOPSECRET .', 'rg --hidden -n TOPSECRET .', 'grep -rn IGNORED-SECRET .', 'rg -n IGNORED-SECRET .']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).not.toContain('TOPSECRET=1');
        expect(textOf(result), command).not.toContain('IGNORED-SECRET');
      }

      const named = await h.call('bash', { command: 'grep plain plain.txt' });
      expect(named.isError).toBeUndefined();

      // The layer's own search tool walks the tree itself and still applies the deny and ignore rules.
      const searched = await h.call('grep', { pattern: 'TOPSECRET|IGNORED-SECRET|plain' });
      expect(textOf(searched)).toContain('plain.txt');
      expect(textOf(searched)).not.toContain('TOPSECRET');
      expect(textOf(searched)).not.toContain('IGNORED-SECRET');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: writers outside the write table skip the outside and deny checks', () => {
  it('reads a sed w command, its s///w flag, split, openssl, and unzip as writes', () => {
    expect(writesOf("sed -n 'w /tmp/out.txt' a.txt")).toEqual(['/tmp/out.txt']);
    expect(writesOf("sed -n 'W /tmp/out.txt' a.txt")).toEqual(['/tmp/out.txt']);
    expect(writesOf("sed -n -e 'w /tmp/one.txt' -e p a.txt")).toEqual(['/tmp/one.txt']);
    expect(writesOf("sed --expression='w /tmp/two.txt' -n a.txt")).toEqual(['/tmp/two.txt']);
    expect(writesOf("sed -n 's/hello/pwned/w /tmp/three.txt' a.txt")).toEqual(['/tmp/three.txt']);
    expect(writesOf("sed -n 's/hello/pwned/gpw /tmp/four.txt' a.txt")).toEqual(['/tmp/four.txt']);
    expect(writesOf("sed -i 's/a/b/w /tmp/five.txt' a.txt")).toEqual(['/tmp/five.txt', 'a.txt']);

    // A read-only script writes nothing, and a `w` inside an address pattern is a pattern.
    expect(writesOf("sed -n 's/hello/pwned/p' a.txt")).toEqual([]);
    expect(writesOf("sed -n '/wow/p' a.txt")).toEqual([]);
    expect(writesOf("sed -n '/w out/p' a.txt")).toEqual([]);

    expect(writesOf('split -l 1 a.txt /tmp/chunk-')).toEqual(['/tmp/chunk-']);
    expect(writesOf('split -n 2 a.txt /tmp/chunk-')).toEqual(['/tmp/chunk-']);
    expect(writesOf('split a.txt')).toEqual([]);
    expect(writesOf('openssl base64 -in a.txt -out /tmp/o.txt')).toEqual(['/tmp/o.txt']);
    expect(writesOf('openssl base64 -in a.txt -out/tmp/o.txt')).toEqual(['/tmp/o.txt']);
    expect(writesOf('openssl base64 -in a.txt --out /tmp/o.txt')).toEqual(['/tmp/o.txt']);
    expect(writesOf('unzip -o a.zip -d /tmp/dir')).toEqual(['/tmp/dir']);
    expect(writesOf('unzip -o a.zip -d/tmp/dir')).toEqual(['/tmp/dir']);
    expect(writesOf('unzip -o a.zip --directory /tmp/dir')).toEqual(['/tmp/dir']);
    expect(writesOf('unzip -l a.zip')).toEqual([]);
  });

  it('refuses those writes outside the workspace, on a denied file, and on the policy file', async () => {
    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: {
        rules: [
          { kind: 'read', action: 'deny', pattern: '**/secret-token.txt' },
          { kind: 'write', action: 'deny', pattern: '**/secret-token.txt' },
        ],
      },
    });
    const outside = path.join(h.root, 'outside');
    try {
      await mkdir(outside, { recursive: true });
      await h.write('plain.txt', 'a\nb\nc\n');
      await h.write('secret-token.txt', 'DENIED-SENTINEL\n');
      await h.write('policy-body.json', '{"mode":"unrestricted"}\n');
      const policyBefore = await readFile(h.file('.pi/pi-tools.json'), 'utf8');
      const zipped = await h.call('bash', { command: 'command -v zip >/dev/null && zip -q pkg.zip plain.txt || true' });
      expect(textOf(zipped)).not.toContain('DENIED-SENTINEL');

      const outsideWrites = [
        `sed -n 'w ${outside}/sed-w.txt' plain.txt`,
        `sed -n 's/a/pwn/w ${outside}/sed-flag.txt' plain.txt`,
        `split -l 1 plain.txt ${outside}/chunk-`,
        `openssl base64 -in plain.txt -out ${outside}/openssl.txt`,
        `openssl base64 -in plain.txt --out ${outside}/openssl-long.txt`,
        `unzip -o -q pkg.zip -d ${outside}/unzipped`,
        `unzip -o -q pkg.zip --directory ${outside}/unzipped-long`,
      ];
      for (const command of outsideWrites) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('outside the workspace');
      }
      expect(await readdir(outside)).toEqual([]);

      const denied = await h.call('bash', { command: "sed -n 'w secret-token.txt' plain.txt" });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain('rule: **/secret-token.txt');
      expect(await readFile(h.file('secret-token.txt'), 'utf8')).toBe('DENIED-SENTINEL\n');

      const policy = await h.call('bash', { command: "sed -n 'w .pi/pi-tools.json' policy-body.json" });
      expect(policy.isError).toBe(true);
      expect(textOf(policy)).toContain('project policy file');
      expect(await readFile(h.file('.pi/pi-tools.json'), 'utf8')).toBe(policyBefore);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: a script fed to an interpreter on stdin runs', () => {
  it('refuses every interpreter spelling fed a program on standard input', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto' } });
    const marker = path.join(h.root, 'marker.txt');
    try {
      await h.write('script.py', `open(${JSON.stringify(marker)}, 'w').write('ran')\n`);
      await h.write('plain.txt', 'plain\n');

      const fedStdin = [
        `python3 - <<'PY'\nopen(${JSON.stringify(marker)}, 'w').write('ran')\nPY`,
        `python3 < script.py`,
        `python3 - < script.py`,
        `node - <<'JS'\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\nJS`,
        `ruby - <<'RB'\nFile.write(${JSON.stringify(marker)}, 'ran')\nRB`,
        `perl - <<'PL'\nopen(F, '>', '${marker}'); print F 'ran';\nPL`,
        `lua - <<'LUA'\nio.open('${marker}', 'w'):write('ran')\nLUA`,
        `ed -s plain.txt <<'ED'\na\npwn\n.\nw ${marker}\nq\nED`,
        `ex -s plain.txt <<'EX'\na\npwn\n.\nw ${marker}\nq\nEX`,
      ];
      for (const command of fedStdin) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('reads a script from standard input');
      }
      // A named program reads data from stdin, not its script.
      expect(analyzeShellCommand('python3 script.py < /dev/null').untrusted).toBeUndefined();
      expect(analyzeShellCommand('node script.js < data.txt').untrusted).toBeUndefined();

      const piped = await h.call('bash', { command: 'cat script.py | python3' });
      expect(piped.isError).toBe(true);
      expect(textOf(piped)).toContain('reads a script from a pipe');
      expect(existsSync(marker)).toBe(false);

      // A named script and an inline program keep working.
      const named = await h.call('bash', { command: "node -e \"require('node:fs').writeFileSync('named.txt', 'ran')\"" });
      expect(named.isError).toBeUndefined();
      expect(await readFile(h.file('named.txt'), 'utf8')).toBe('ran');
      expect((await h.call('bash', { command: 'node --version' })).isError).toBeUndefined();
      expect(untrustedOf("python3 -c 'print(1)'")).toBeUndefined();
      expect(untrustedOf('node script.js')).toBeUndefined();
      expect(untrustedOf('perl -pi -e s/a/b/ plain.txt')).toBeUndefined();
      expect(untrustedOf('node --version')).toBeUndefined();
      // A pipe into a program that carries its own code is data on stdin, not a script.
      expect(untrustedOf("cat plain.txt | node -e 'process.stdin.pipe(process.stdout)'")).toBeUndefined();
      expect(untrustedOf('cat plain.txt | node script.js')).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: git --output writes outside the workspace', () => {
  it('treats --output as a write destination in the analyzer, bash, and the git tool', async () => {
    expect(writesOf('git show --output=/tmp/show.txt HEAD')).toContain('/tmp/show.txt');
    expect(writesOf('git show --output /tmp/show.txt HEAD')).toContain('/tmp/show.txt');
    expect(writesOf('git log --output=/tmp/log.txt -1')).toContain('/tmp/log.txt');
    expect(writesOf('git diff --output=/tmp/diff.txt')).toContain('/tmp/diff.txt');
    expect(writesOf('git diff-tree --output=/tmp/tree.txt HEAD')).toContain('/tmp/tree.txt');
    expect(writesOf('git whatchanged --output=/tmp/what.txt')).toContain('/tmp/what.txt');
    expect(untrustedOf('git log --output "$file" -1')).toContain('built by an expansion');
    expect(writesOf('git log -1')).toEqual([]);

    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto' } });
    const outside = path.join(h.root, 'outside');
    try {
      await mkdir(outside, { recursive: true });
      await h.write('plain.txt', 'a\n');
      const init = await h.call('bash', { command: 'git init -q . && git add plain.txt && git -c user.email=a@b -c user.name=n commit -qm init' });
      expect(init.isError).toBeUndefined();

      // A `show` with no path operand is refused for printing the whole commit diff, so name a path
      // and keep the outside `--output` destination as the thing this assertion checks.
      const fromBash = await h.call('bash', { command: `git show --output=${outside}/show.txt HEAD -- plain.txt` });
      expect(fromBash.isError).toBe(true);
      expect(textOf(fromBash)).toContain('outside the workspace');
      const unpathed = await h.call('bash', { command: `git show --output=${outside}/show.txt HEAD` });
      expect(unpathed.isError).toBe(true);
      expect(textOf(unpathed)).toContain('commit diff prints the body');

      const fromTool = await h.call('git', { subcommand: 'log', args: [`--output=${outside}/log.txt`, '-1'] });
      expect(fromTool.isError).toBe(true);
      expect(textOf(fromTool)).toContain('outside the workspace');

      expect(await readdir(outside)).toEqual([]);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5: a wrapper prefix runs a command the analyzer never sees', () => {
  it('refuses every wrapper that starts another command', () => {
    for (const command of [
      'arch -arm64 touch victim.txt',
      '/usr/bin/arch -arm64 /usr/bin/touch victim.txt',
      'xcrun --sdk macosx touch victim.txt',
      'unshare --mount touch victim.txt',
      'setarch x86_64 touch victim.txt',
      'busybox touch victim.txt',
      'nsenter -t 1 -m touch victim.txt',
      'docker run --rm alpine touch victim.txt',
      'podman run --rm alpine touch victim.txt',
      'ssh host touch victim.txt',
      'sudo touch victim.txt',
      'flock /tmp/lock touch victim.txt',
    ]) {
      expect(untrustedOf(command), command).toContain('runs a command the analyzer does not follow');
    }
  });

  it('refuses the bypass through bash before it runs', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [{ kind: 'exec', action: 'deny', pattern: 'touch *' }] } });
    const outside = path.join(h.root, 'outside');
    try {
      await mkdir(outside, { recursive: true });
      await h.write('plain.txt', 'plain\n');
      for (const command of [`/usr/bin/arch -arm64 /usr/bin/touch ${outside}/via-arch.txt`, '/usr/bin/arch -arm64 /usr/bin/touch denied-by-rule.txt', `/usr/bin/arch -arm64 /bin/sh -c 'echo hidden > ${outside}/shell-wrote.txt'`]) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('runs a command the analyzer does not follow');
      }
      expect(await readdir(outside)).toEqual([]);
      expect(existsSync(h.file('denied-by-rule.txt'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: git stages denied files and prints them through an index pathspec', () => {
  it('checks an index pathspec as the path git opens and refuses a directory-wide stage', async () => {
    expect(analyzeShellCommand('git show :secret-token.txt').paths).toContainEqual({ path: 'secret-token.txt', write: false });
    expect(analyzeShellCommand('git show :0:secret-token.txt').paths).toContainEqual({ path: 'secret-token.txt', write: false });
    expect(analyzeShellCommand('git show :./secret-token.txt').paths).toContainEqual({ path: './secret-token.txt', write: false });
    expect(analyzeShellCommand("git show ':(top)secret-token.txt'").paths).toContainEqual({ path: 'secret-token.txt', write: false });

    for (const command of ['git add -A', 'git add --all', 'git add -u', 'git add --update', 'git add .', 'git add :/', 'git add -Av', 'git commit -a -m done', 'git commit --all -m done', 'git commit -am done']) {
      expect(untrustedOf(command), command).toContain('stages every file');
    }
    for (const command of ['git add file.txt', 'git add -N file.txt', 'git commit -m done', 'git commit -m "-a"', 'git status']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }

    const h = await createHarness({
      hasUI: false,
      confirm: false,
      config: {
        rules: [
          { kind: 'read', action: 'deny', pattern: '**/secret-token.txt' },
          { kind: 'write', action: 'deny', pattern: '**/secret-token.txt' },
        ],
      },
    });
    try {
      await h.write('secret-token.txt', 'DENIED-SENTINEL\n');
      await h.write('visible.txt', 'hello\n');
      await h.write('.piignore', 'hidden-note.txt\n');
      await h.write('hidden-note.txt', 'PIIGNORE-SENTINEL\n');
      expect((await h.call('bash', { command: 'git init -q .' })).isError).toBeUndefined();

      for (const command of ['git add -A', 'git add .', 'git commit -a -m hooked']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('stages every file');
      }

      const staged = await h.call('bash', { command: 'git add secret-token.txt' });
      expect(staged.isError).toBe(true);
      expect(textOf(staged)).toContain('rule: **/secret-token.txt');

      const allowed = await h.call('bash', { command: 'git add visible.txt && git -c user.email=a@b -c user.name=n commit -qm init' });
      expect(allowed.isError).toBeUndefined();

      const fromIndex = await h.call('bash', { command: 'git show :secret-token.txt' });
      expect(fromIndex.isError).toBe(true);
      expect(textOf(fromIndex)).toContain('rule: **/secret-token.txt');
      expect(textOf(fromIndex)).not.toContain('DENIED-SENTINEL');

      const ignored = await h.call('bash', { command: 'git show :hidden-note.txt' });
      expect(ignored.isError).toBe(true);
      expect(textOf(ignored)).toContain('.piignore');
      expect(textOf(ignored)).not.toContain('PIIGNORE-SENTINEL');

      const shown = await h.call('bash', { command: 'git show :visible.txt' });
      expect(shown.isError).toBeUndefined();
      expect(textOf(shown)).toContain('hello');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: edit and delete return the contents of a read-denied file', () => {
  it('refuses both with the read deny rule, leaks no text, and still edits a path with no read deny', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    try {
      await h.write('.env', 'TOPSECRET=1\nSECOND=2\n');
      await h.write('visible.txt', 'SECOND=2\n');
      const env = () => readFile(h.file('.env'), 'utf8');

      const read = await h.call('read', { path: '.env' });
      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain('rule: **/.env');

      const edited = await h.call('edit', { path: '.env', edits: [{ oldText: 'SECOND=2', newText: 'SECOND=3' }] });
      expect(edited.isError).toBe(true);
      expect((edited.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(textOf(edited)).toContain('rule: **/.env');
      expect(textOf(edited)).not.toContain('TOPSECRET');
      expect(JSON.stringify(edited.details ?? {})).not.toContain('TOPSECRET');
      expect(await env()).toBe('TOPSECRET=1\nSECOND=2\n');

      const removed = await h.call('delete', { path: '.env' });
      expect(removed.isError).toBe(true);
      expect((removed.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(textOf(removed)).toContain('rule: **/.env');
      expect(JSON.stringify(removed.details ?? {})).not.toContain('TOPSECRET');
      expect(existsSync(h.file('.env'))).toBe(true);
      expect(await env()).toBe('TOPSECRET=1\nSECOND=2\n');

      const allowed = await h.call('edit', { path: 'visible.txt', edits: [{ oldText: 'SECOND=2', newText: 'SECOND=3' }] });
      expect(allowed.isError).toBeUndefined();
      expect(await readFile(h.file('visible.txt'), 'utf8')).toBe('SECOND=3\n');
    } finally {
      await h.cleanup();
    }
  });

  it('needs no read allow rule to edit or delete in allowlist mode', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'allowlist', rules: [{ kind: 'write', action: 'allow', pattern: '**' }] } });
    try {
      await h.write('visible.txt', 'one\n');
      const edited = await h.call('edit', { path: 'visible.txt', edits: [{ oldText: 'one', newText: 'two' }] });
      expect(edited.isError).toBeUndefined();
      expect(await readFile(h.file('visible.txt'), 'utf8')).toBe('two\n');

      const removed = await h.call('delete', { path: 'visible.txt' });
      expect(removed.isError).toBeUndefined();
      expect(existsSync(h.file('visible.txt'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 8: .git/config and .git/hooks are agent-writable and run later', () => {
  it('refuses every write and delete surface, names the file, and still reads it', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto' } });
    const config = () => readFile(h.file('.git/config'), 'utf8');
    const hook = () => readFile(h.file('.git/hooks/pre-commit'), 'utf8');
    try {
      expect((await h.call('bash', { command: 'git init -q .' })).isError).toBeUndefined();
      const originalConfig = await config();
      const hostileHook = '#!/bin/sh\ntouch pwned\n';
      await h.write('.git/hooks/pre-commit', hostileHook);

      const writeConfig = await h.call('write', { path: '.git/config', content: `${originalConfig}\n[core]\n\tfsmonitor = ./x.sh\n` });
      expect(writeConfig.isError).toBe(true);
      expect(textOf(writeConfig)).toContain('Blocked: .git/config is git config');
      expect(await config()).toBe(originalConfig);

      const writeHook = await h.call('write', { path: '.git/hooks/pre-commit', content: '#!/bin/sh\ntouch other\n' });
      expect(writeHook.isError).toBe(true);
      expect((writeHook.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(textOf(writeHook)).toContain('Blocked: .git/hooks/pre-commit is a git hook');
      expect(await hook()).toBe(hostileHook);

      const patched = await h.call('apply_patch', {
        patch: ['*** Begin Patch', '*** Update File: .git/hooks/pre-commit', '@@', '-#!/bin/sh', '+#!/bin/sh', '*** End Patch'].join('\n'),
      });
      expect(patched.isError).toBe(true);
      expect(textOf(patched)).toContain('.git/hooks/pre-commit is a git hook');
      expect(await hook()).toBe(hostileHook);

      const saved = await h.call('save_resource', { path: '.git/hooks/pre-commit', content: '#!/bin/sh\ntouch other\n', overwrite: true });
      expect(saved.isError).toBe(true);
      expect(textOf(saved)).toContain('.git/hooks/pre-commit is a git hook');
      expect(await hook()).toBe(hostileHook);

      const edited = await h.call('edit', { path: '.git/hooks/pre-commit', edits: [{ oldText: 'touch pwned', newText: 'touch other' }] });
      expect(edited.isError).toBe(true);
      expect(textOf(edited)).toContain('.git/hooks/pre-commit is a git hook');
      expect(await hook()).toBe(hostileHook);

      for (const command of ['printf pwn > .git/config', 'printf pwn > .git/hooks/pre-commit', 'cp .git/config .git/hooks/pre-commit', 'rm .git/config']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toMatch(/is (git config|a git hook)/);
      }
      expect(await config()).toBe(originalConfig);
      expect(await hook()).toBe(hostileHook);

      const removedConfig = await h.call('delete', { path: '.git/config' });
      expect(removedConfig.isError).toBe(true);
      expect((removedConfig.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(textOf(removedConfig)).toContain('.git/config is git config');
      expect(existsSync(h.file('.git/config'))).toBe(true);

      const readConfig = await h.call('read', { path: '.git/config' });
      expect(readConfig.isError).toBeUndefined();
      expect(textOf(readConfig)).toContain('repositoryformatversion');

      // Git still writes its own metadata through the git binary.
      await h.write('tracked.txt', 'hello\n');
      const committed = await h.call('bash', { command: 'git add tracked.txt && git -c user.email=a@b.c -c user.name=Ada commit -qm init' });
      expect(committed.isError).toBeUndefined();
      expect(existsSync(h.file('.git/config'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});
