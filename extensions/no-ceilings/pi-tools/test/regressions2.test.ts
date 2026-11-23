import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the second adversarial pass. Each test names the finding it locks down. */

describe('finding 1: search cannot leave the workspace through a symlink', () => {
  it('drops a symlinked file and directory that point outside', async () => {
    const harness = await createHarness();
    try {
      const outside = await mkdtemp(path.join(tmpdir(), 'pi-tools-outside-'));
      await writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE-NEEDLE\n', 'utf-8');
      await symlink(path.join(outside, 'secret.txt'), harness.file('escape.txt'));
      await symlink(outside, harness.file('escape-dir'));
      const grep = await harness.call('grep', { pattern: 'OUTSIDE' });
      expect(textOf(grep)).toBe('No matches found');
      const find = await harness.call('find', { pattern: 'secret.txt' });
      expect(textOf(find)).toBe('No files found matching pattern');
      await rm(outside, { recursive: true, force: true });
    } finally {
      await harness.cleanup();
    }
  });

  it('still searches an explicitly named directory outside the workspace', async () => {
    const harness = await createHarness();
    try {
      const outside = await mkdtemp(path.join(tmpdir(), 'pi-tools-outside-'));
      await writeFile(path.join(outside, 'far.txt'), 'needle far\n', 'utf-8');
      const result = await harness.call('grep', { pattern: 'needle', path: outside });
      expect(textOf(result)).toContain('far.txt');
      await rm(outside, { recursive: true, force: true });
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 2: an allowlist match on a symlink name does not authorize its target', () => {
  it('refuses read and write through the link', async () => {
    const harness = await createHarness({
      config: {
        mode: 'allowlist',
        rules: [
          { kind: 'read', action: 'allow', pattern: '**/public.txt' },
          { kind: 'write', action: 'allow', pattern: '**/public.txt' },
        ],
      },
    });
    try {
      await harness.write('secret.txt', 'SECRET-CONTENT\n');
      await symlink(harness.file('secret.txt'), harness.file('public.txt'));
      const direct = await harness.call('read', { path: 'secret.txt' });
      expect(direct.isError).toBe(true);
      const viaLink = await harness.call('read', { path: 'public.txt' });
      expect(viaLink.isError).toBe(true);
      const write = await harness.call('write', { path: 'public.txt', content: 'PWNED\n' });
      expect(write.isError).toBe(true);
      expect(await readFile(harness.file('secret.txt'), 'utf-8')).toBe('SECRET-CONTENT\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 3: a patch that fails later writes nothing', () => {
  it('leaves the first file untouched', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'old\n');
      await harness.write('b.txt', 'keep\n');
      const patch = ['*** Begin Patch', '*** Update File: a.txt', '@@', '-old', '+new', '*** Update File: b.txt', '@@', '-missing', '+x', '*** End Patch'].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(await readFile(harness.file('a.txt'), 'utf-8')).toBe('old\n');
      expect(await readFile(harness.file('b.txt'), 'utf-8')).toBe('keep\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 4: a unified-diff delete validates the removed lines', () => {
  it('refuses a delete whose hunk does not match', async () => {
    const harness = await createHarness();
    try {
      await harness.write('victim.txt', 'IMPORTANT\n');
      const patch = ['--- a/victim.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-a line that was never in the file', ''].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(await readFile(harness.file('victim.txt'), 'utf-8')).toBe('IMPORTANT\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 5: a blank line between unified-diff sections does not truncate the patch', () => {
  it('applies both files', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'old\n');
      await harness.write('b.txt', 'old\n');
      const patch = ['--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-old', '+new', '', '--- a/b.txt', '+++ b/b.txt', '@@ -1 +1 @@', '-old', '+new', ''].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('a.txt'), 'utf-8')).toBe('new\n');
      expect(await readFile(harness.file('b.txt'), 'utf-8')).toBe('new\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 6: a git-style multi-file diff is accepted', () => {
  it('skips diff --git and index headers', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'old\n');
      await harness.write('b.txt', 'old\n');
      const patch = [
        'diff --git a/a.txt b/a.txt',
        'index 1111111..2222222 100644',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/b.txt b/b.txt',
        'index 1111111..2222222 100644',
        '--- a/b.txt',
        '+++ b/b.txt',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        '',
      ].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('a.txt'), 'utf-8')).toBe('new\n');
      expect(await readFile(harness.file('b.txt'), 'utf-8')).toBe('new\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 7: the no-newline marker is honored', () => {
  it('writes the new last line without a trailing newline', async () => {
    const harness = await createHarness();
    try {
      await harness.write('f.txt', 'foo\n');
      const patch = ['*** Begin Patch', '*** Update File: f.txt', '@@', '-foo', '+bar', '\\ No newline at end of file', '*** End Patch'].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('f.txt'), 'utf-8')).toBe('bar');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 8: hunks apply in file order', () => {
  it('anchors the second hunk after the first', async () => {
    const harness = await createHarness();
    try {
      await harness.write('f.txt', 'foo\nfoo\nfoo\n');
      const patch = ['*** Begin Patch', '*** Update File: f.txt', '@@ -1,1 +1,2 @@', ' foo', '+extra', '@@ -3,1 +4,1 @@', '-foo', '+baz', '*** End Patch'].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('f.txt'), 'utf-8')).toBe('foo\nextra\nfoo\nbaz\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 9: a failed patch creates no directories', () => {
  it('leaves no parent directory behind', async () => {
    const harness = await createHarness();
    try {
      await harness.write('keep.txt', 'x\n');
      const patch = ['*** Begin Patch', '*** Add File: ghost-dir/new.txt', '+x', '*** Update File: missing.txt', '@@', '-a', '+b', '*** End Patch'].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      const listing = await harness.call('ls', {});
      expect(textOf(listing)).not.toContain('ghost-dir');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 10: a pure move renames without a content change', () => {
  it('moves the file', async () => {
    const harness = await createHarness();
    try {
      await harness.write('src.txt', 'same\n');
      const patch = ['*** Begin Patch', '*** Update File: src.txt', '*** Move to: dst.txt', '@@', ' same', '*** End Patch'].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('dst.txt'), 'utf-8')).toBe('same\n');
      await expect(readFile(harness.file('src.txt'), 'utf-8')).rejects.toThrow();
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 11: exec rules cover ordinary command spellings', () => {
  it('blocks whitespace, assignments, wrappers, substitutions, and nested shells', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] } });
    try {
      const variants = [
        'echo  secret-value',
        'SECRET=1 echo secret-value',
        'env echo secret-value',
        'echo `echo secret-value`',
        'echo "$(echo secret-value)"',
        'sh -c "echo secret-value"',
        'bash -c "echo secret-value"',
        'echo secret/value',
      ];
      for (const command of variants) {
        const result = await harness.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('Blocked by permissions configuration');
      }
      const allowed = await harness.call('bash', { command: 'echo public-value' });
      expect(allowed.isError).toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 12: allowlist mode requires every command segment to be allowed', () => {
  it('refuses a chain with one unlisted segment', async () => {
    const harness = await createHarness({ config: { mode: 'allowlist', rules: [{ kind: 'exec', action: 'allow', pattern: 'echo ok' }] } });
    try {
      const result = await harness.call('bash', { command: 'echo ok; echo pwned > pwned.txt' });
      expect(result.isError).toBe(true);
      await expect(readFile(harness.file('pwned.txt'), 'utf-8')).rejects.toThrow();
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 13: a cd inside the command respects the workspace boundary', () => {
  it('refuses cd /etc headless', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('bash', { command: 'cd /etc && pwd' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('outside the workspace');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 14: web_search gates every redirect hop', () => {
  it('refuses a redirect to a denied host', async () => {
    const harness = await createHarness({
      config: {
        rules: [
          { kind: 'read', action: 'deny', pattern: 'https://blocked.example/**' },
          { kind: 'read', action: 'allow', pattern: 'https://search.example/**' },
        ],
        web: { search: { url: 'https://search.example/?q={query}' } },
      },
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith('https://search.example/')) {
          return new Response(null, { status: 302, headers: { location: 'https://blocked.example/secret' } });
        }
        return new Response(JSON.stringify({ results: [{ title: 'x', url: 'https://blocked.example/secret', snippet: 'SECRET-BODY' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });
    try {
      const result = await harness.call('web_search', { query: 'needle' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Blocked by permissions configuration');
      expect(textOf(result)).not.toContain('SECRET-BODY');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 15: a userinfo URL cannot bypass a host deny rule', () => {
  it('refuses the same host written with credentials', async () => {
    const harness = await createHarness({
      config: { rules: [{ kind: 'read', action: 'deny', pattern: 'https://blocked.example/**' }] },
      fetch: (async () => new Response('SECRET', { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof fetch,
    });
    try {
      const result = await harness.call('web_fetch', { url: 'https://x@blocked.example/secret' }, { hasUI: true });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Blocked by permissions configuration');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 16: an edit preserves untouched line endings', () => {
  it('keeps the mixed endings of other lines', async () => {
    const harness = await createHarness();
    try {
      await harness.write('mixed.txt', 'a\nb\r\nc\n');
      const result = await harness.call('edit', { path: 'mixed.txt', edits: [{ oldText: 'a', newText: 'A' }] });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('mixed.txt'), 'utf-8')).toBe('A\nb\r\nc\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 17: the read footer reports a truthful range', () => {
  it('handles offset 0, limit 0, and a negative limit', async () => {
    const harness = await createHarness();
    try {
      await harness.write('five.txt', 'a\nb\nc\nd\ne\n');
      const zeroOffset = textOf(await harness.call('read', { path: 'five.txt', offset: 0 }));
      expect(zeroOffset).toContain('lines 1-5');
      const zeroLimit = textOf(await harness.call('read', { path: 'five.txt', limit: 0 }));
      expect(zeroLimit).not.toContain('1-0');
      const negativeLimit = textOf(await harness.call('read', { path: 'five.txt', limit: -1 }));
      expect(negativeLimit).not.toContain('--1');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 18: grep pagination is bounded and honest', () => {
  it('refuses an offset beyond the window instead of silently clamping', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'hit\n');
      const result = await harness.call('grep', { pattern: 'hit', offset: 5000 });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('offset');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 19: docs and tools match their claims', () => {
  it('declares prepareArguments on bash too and documents the ignore mechanism truthfully', async () => {
    const harness = await createHarness();
    try {
      const bash = harness.tool('bash') as unknown as { prepareArguments?: unknown };
      expect(typeof bash.prepareArguments).toBe('function');
      const readme = await readFile(path.join(import.meta.dirname, '..', 'README.md'), 'utf8');
      expect(readme).not.toContain('passed as an extra ignore');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 20: concurrent patches serialize and no reported success is lost', () => {
  it('serializes concurrent patches and refuses the loser', async () => {
    const harness = await createHarness();
    try {
      await harness.write('race.txt', 'one\ntwo\n');
      const results = await Promise.all([
        harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: race.txt', '@@', ' one', '+middle-a', ' two', '*** End Patch'].join('\n') }),
        harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: race.txt', '@@', ' one', ' two', '+middle-b', '*** End Patch'].join('\n') }),
      ]);
      const successes = results.filter((result) => result.isError === undefined);
      expect(successes.length).toBeGreaterThanOrEqual(1);
      const final = await readFile(harness.file('race.txt'), 'utf-8');
      if (results[0]?.isError === undefined) {
        expect(final).toContain('middle-a');
      }
      if (results[1]?.isError === undefined) {
        expect(final).toContain('middle-b');
      }
      // A call that reports an error must not have changed the file.
      for (const [index, result] of results.entries()) {
        if (result.isError === true) {
          expect(final).not.toContain(index === 0 ? 'middle-a' : 'middle-b');
        }
      }
    } finally {
      await harness.cleanup();
    }
  });
});
