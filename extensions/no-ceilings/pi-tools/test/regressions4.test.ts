import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { analyzeCommand, analyzeShellCommand, directoryChanges } from '../src/core/command.ts';
import { createSessionManager } from '../src/core/session.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the fourth adversarial pass. Each test names the finding it locks down. */

function textResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
}

describe('finding 1: ANSI-C quoting shows the command the shell runs', () => {
  it('decodes $\\xNN and $\\NNN before matching', () => {
    expect(analyzeCommand("echo $'\\x73ecret-value'")).toContain('echo secret-value');
    expect(analyzeCommand("echo $'\\163ecret-value'")).toContain('echo secret-value');
    expect(analyzeCommand("bash -c $'\\x65cho secret-value'")).toContain('echo secret-value');
    expect(analyzeCommand("eval $'\\x65cho secret-value'")).toContain('echo secret-value');
  });

  it('blocks the decoded command', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] } });
    try {
      for (const command of ["echo $'\\x73ecret-value'", "bash -c $'\\x65cho secret-value'", "eval $'\\x65cho secret-value'"]) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).not.toContain('secret-value\n');
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 2: a leading assignment is stripped before the executable', () => {
  it('analyzes the assignment as an assignment, not a path', () => {
    expect(analyzeCommand('FOO=/usr/bin echo secret-value')).toEqual(['echo secret-value']);
    expect(analyzeCommand('PATH=/usr/local/bin:/usr/bin touch x')).toEqual(['touch x']);
    expect(analyzeCommand('NODE_ENV=production/../x touch x')).toEqual(['touch x']);
    expect(directoryChanges('FOO=/tmp/x cd /etc && pwd')).toEqual(['/etc']);
  });

  it('blocks the command and the cd behind the assignment', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'touch*' }] } });
    try {
      const blocked = await h.call('bash', { command: 'PATH=/usr/bin:/bin touch bypassed.txt' });
      expect(blocked.isError).toBe(true);
      await expect(readFile(h.file('bypassed.txt'))).rejects.toThrow();

      const cd = await h.call('bash', { command: 'FOO=/tmp/x cd /etc && pwd' });
      expect(cd.isError).toBe(true);
      expect(textOf(cd)).toContain('outside the workspace');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 3: a wrapper outside the fixed set is unwrapped or refused', () => {
  it('looks through timeout, nice, and setsid', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'touch*' }] } });
    try {
      for (const command of ['timeout 5 touch a.txt', 'nice -n 5 touch b.txt', 'setsid touch c.txt', 'stdbuf -o0 touch d.txt']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('Blocked by permissions configuration');
      }
    } finally {
      await h.cleanup();
    }
  });

  it('refuses wrappers it cannot follow', async () => {
    expect(analyzeShellCommand('xargs -n1 touch x').untrusted).toContain('xargs');
    expect(analyzeShellCommand('sudo touch x').untrusted).toContain('sudo');
    expect(analyzeShellCommand('find . -name x -exec touch {} ;').untrusted).toContain('find -exec');
    expect(analyzeShellCommand('env -S "touch x"').untrusted).toContain('env -S');

    const h = await createHarness();
    try {
      for (const command of ['xargs -n1 touch a.txt', 'sudo touch b.txt', 'find . -name x -exec touch {} ;']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('the analyzer does not follow');
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: an inline startup assignment is refused', () => {
  it('refuses BASH_ENV, ENV, CDPATH, and IFS set on the command', async () => {
    const h = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] } });
    try {
      await h.write('startup.sh', 'echo secret-value\n');
      for (const command of ['BASH_ENV=startup.sh bash -c true', 'ENV=startup.sh sh -c true', 'CDPATH=/tmp cd .', 'IFS=: true']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('changes how the shell finds commands');
        expect(textOf(result), command).not.toContain('secret-value\n');
      }
    } finally {
      await h.cleanup();
    }
  });

  it('strips the startup variables from the inherited environment', async () => {
    vi.stubEnv('BASH_ENV', '/nonexistent/startup.sh');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const h = await createHarness();
    try {
      const result = await h.call('bash', { command: 'printenv BASH_ENV || echo absent' });
      expect(textOf(result)).toContain('absent');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5: cd resolves the way the shell does', () => {
  it('refuses ~ and $HOME when home is outside the workspace', async () => {
    const h = await createHarness();
    try {
      const outside = path.join(h.root, 'outside-home');
      await mkdir(outside, { recursive: true });
      for (const command of ['cd ~ && pwd', 'cd $HOME && pwd']) {
        const result = await h.call('bash', { command, env: { HOME: outside } });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('outside the workspace');
      }
      expect(h.confirmations).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });

  it('ignores CDPATH from the command environment', async () => {
    const h = await createHarness();
    try {
      const outside = path.join(h.root, 'cdpath');
      await mkdir(path.join(outside, 'secret-dir'), { recursive: true });
      await writeFile(path.join(outside, 'secret-dir', 'marker.txt'), 'OUTSIDE-MARKER\n');
      const result = await h.call('bash', { command: 'cd secret-dir && cat marker.txt', env: { CDPATH: outside } });
      expect(textOf(result)).not.toContain('OUTSIDE-MARKER');
    } finally {
      await h.cleanup();
    }
  });

  it('marks an unresolvable directory target untrusted', () => {
    expect(analyzeShellCommand('cd "$DIR"').untrusted).toContain('$DIR');
    expect(analyzeShellCommand('cd foo/$BAR').untrusted).toContain('expansion');
  });
});

describe('finding 6: a workspace symlink cannot root a search outside', () => {
  it('refuses grep, ls, and find on a link that resolves out', async () => {
    const h = await createHarness();
    try {
      const outside = path.join(h.root, 'outside');
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE-NEEDLE\n');
      await symlink(outside, h.file('escape-dir'), 'dir');

      const read = await h.call('read', { path: path.join('escape-dir', 'secret.txt') });
      expect(read.isError).toBe(true);
      for (const call of [h.call('grep', { pattern: 'OUTSIDE-NEEDLE', path: 'escape-dir' }), h.call('ls', { path: 'escape-dir' }), h.call('find', { pattern: 'secret.txt', path: 'escape-dir' })]) {
        const result = await call;
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('outside the workspace');
      }
      expect(textOf(await h.call('grep', { pattern: 'OUTSIDE-NEEDLE' }))).not.toContain('OUTSIDE-NEEDLE');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: a protected ignore file cannot be deleted', () => {
  it('refuses to delete .piignore and keeps the filter', async () => {
    const h = await createHarness();
    try {
      await h.write('.piignore', 'secret.txt\n');
      await h.write('secret.txt', 'SECRET-NEEDLE\n');
      const deleted = await h.call('delete', { path: '.piignore' });
      expect(deleted.isError).toBe(true);
      expect(textOf(deleted)).toContain('protected');
      expect(textOf(await h.call('read', { path: 'secret.txt' }))).toContain('filtered out by .piignore');
    } finally {
      await h.cleanup();
    }
  });

  it('reports a missing file and a directory', async () => {
    const h = await createHarness();
    try {
      const missing = await h.call('delete', { path: 'nope.txt' });
      expect(missing.isError).toBe(true);
      await mkdir(h.file('dir'));
      const directory = await h.call('delete', { path: 'dir' });
      expect(directory.isError).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 8: a patch that fails while writing leaves nothing behind', () => {
  it.skipIf(process.getuid?.() === 0)('rolls back a file written before a later move fails', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'old\n');
      await h.write('src.txt', 'same\n');
      await mkdir(h.file('locked'), { recursive: true });
      await chmod(h.file('locked'), 0o555);
      const patch = ['*** Begin Patch', '*** Update File: a.txt', '@@', '-old', '+new', '*** Update File: src.txt', '*** Move to: locked/dst.txt', '@@', ' same', '*** End Patch'].join('\n');
      const result = await h.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('old\n');
      expect(await readFile(h.file('src.txt'), 'utf-8')).toBe('same\n');
    } finally {
      await chmod(h.file('locked'), 0o755).catch(() => undefined);
      await h.cleanup();
    }
  });

  it.skipIf(process.getuid?.() === 0)('rolls back a file written before a read-only later write fails', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'old\n');
      await h.write('b.txt', 'keep\n');
      await chmod(h.file('b.txt'), 0o444);
      const patch = ['*** Begin Patch', '*** Update File: a.txt', '@@', '-old', '+new', '*** Update File: b.txt', '@@', '-keep', '+changed', '*** End Patch'].join('\n');
      const result = await h.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('old\n');
    } finally {
      await chmod(h.file('b.txt'), 0o644).catch(() => undefined);
      await h.cleanup();
    }
  });
});

describe('finding 9: zero-context insertion hunks keep their place', () => {
  it('applies two -U0 insertions in order', async () => {
    const h = await createHarness();
    try {
      await h.write('f.txt', '1\n2\n3\n4\n5\n6\n');
      const patch = ['--- a/f.txt', '+++ b/f.txt', '@@ -2,0 +3 @@', '+X', '@@ -5,0 +7 @@', '+Y', ''].join('\n');
      const result = await h.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(h.file('f.txt'), 'utf-8')).toBe('1\n2\nX\n3\n4\n5\nY\n6\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 10: a ranged read reports the lines it returned', () => {
  it('is not confused by a \n\n[ sequence in the file', async () => {
    const h = await createHarness();
    try {
      await h.write('bracket.txt', 'a\n\n[note in the file]\nb\nc\n');
      const result = await h.call('read', { path: 'bracket.txt', offset: 1, limit: 2 });
      expect(textOf(result)).toContain('lines 1-2');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 11: grep reports which lines it cut', () => {
  it('marks a line cut at the character cap', async () => {
    const h = await createHarness();
    try {
      await h.write('long.txt', `${'x'.repeat(600)} needle\nshort needle\n`);
      const result = await h.call('grep', { pattern: 'needle', path: 'long.txt' });
      const details = result.details as { linesTruncated?: boolean; matches?: { truncated: boolean }[] };
      expect(details.linesTruncated).toBe(true);
      expect(details.matches?.map((match) => match.truncated)).toEqual([true, false]);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 12: edit reports the replacements it made', () => {
  it('counts occurrences, not edit blocks', async () => {
    const h = await createHarness();
    try {
      await h.write('many.txt', 'a\na\na\n');
      const result = await h.call('edit', { path: 'many.txt', edits: [{ oldText: 'a', newText: 'b', replaceAll: true }] });
      expect(textOf(result)).toContain('3 occurrences');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 13: a URL rule covers everything beneath it', () => {
  it('denies subpaths for a host and one-segment prefix rule', async () => {
    for (const pattern of ['https://evil.example/', 'https://evil.example/*']) {
      const h = await createHarness({
        config: { mode: 'unrestricted', rules: [{ kind: 'read', action: 'deny', pattern }] },
        fetch: async () => textResponse('SECRET-BODY'),
      });
      try {
        const result = await h.call('web_fetch', { url: 'https://evil.example/a/b/c' });
        expect(result.isError, pattern).toBe(true);
        expect(textOf(result), pattern).not.toContain('SECRET-BODY');
      } finally {
        await h.cleanup();
      }
    }
  });
});

describe('finding 14: concurrent session builds are keyed by directory', () => {
  it('returns the session for each caller’s cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-tools-race-'));
    const agentDir = path.join(root, 'agent');
    const first = path.join(root, 'a');
    const second = path.join(root, 'b');
    await mkdir(agentDir, { recursive: true });
    for (const [workspace, mode] of [
      [first, 'unrestricted'],
      [second, 'allowlist'],
    ] as const) {
      await mkdir(path.join(workspace, '.pi'), { recursive: true });
      await writeFile(path.join(workspace, '.pi', 'pi-tools.json'), JSON.stringify(mode === 'allowlist' ? { mode, rules: [{ kind: 'read', action: 'allow', pattern: '**' }] } : { mode }));
    }
    const sessions = createSessionManager({ agentDir, home: root });
    const [a, b] = await Promise.all([sessions.get({ cwd: first }), sessions.get({ cwd: second })]);
    expect(a.cwd).toBe(first);
    expect(b.cwd).toBe(second);
    expect(a.policy.mode).toBe('unrestricted');
    expect(b.policy.mode).toBe('allowlist');
    expect((await sessions.get({ cwd: first })).policy.mode).toBe('unrestricted');
  });
});

describe('finding 15: find rooted at a file reports that file', () => {
  it('returns the name, not "."', async () => {
    const h = await createHarness();
    try {
      await h.write('solo.txt', 'hello');
      const result = await h.call('find', { pattern: '*.txt', path: 'solo.txt' });
      expect((result.details as { files: string[] }).files).toEqual(['solo.txt']);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 16: write refuses malformed base64', () => {
  it('rejects content that is not base64', async () => {
    const h = await createHarness();
    try {
      const result = await h.call('write', { path: 'bad.b64', content: '%%%', encoding: 'base64' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not valid base64');
      await expect(readFile(h.file('bad.b64'))).rejects.toThrow();
    } finally {
      await h.cleanup();
    }
  });

  it('accepts valid base64', async () => {
    const h = await createHarness();
    try {
      const result = await h.call('write', { path: 'ok.b64', content: Buffer.from('hello\n').toString('base64'), encoding: 'base64' });
      expect(result.isError).toBeUndefined();
      expect(await readFile(h.file('ok.b64'), 'utf-8')).toBe('hello\n');
    } finally {
      await h.cleanup();
    }
  });
});
