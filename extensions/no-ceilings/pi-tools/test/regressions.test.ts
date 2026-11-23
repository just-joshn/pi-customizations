import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { createHarness, textOf } from './harness.ts';

/**
 * One regression per verified interrogate finding. Each test names the finding it locks down and
 * asserts the behavior the README promises.
 */

describe('finding 1: workspaceRoots resolve against the working directory', () => {
  it('keeps the project inside the workspace and the home directory outside', async () => {
    const harness = await createHarness({ config: { workspaceRoots: ['.'] } });
    try {
      const inside = await harness.call('write', { path: 'inside.txt', content: 'x' });
      expect(inside.isError).toBeUndefined();
      const home = await harness.call('write', { path: path.join('..', 'home.txt'), content: 'x' });
      expect(home.isError).toBe(true);
      expect(textOf(home)).toContain('outside the workspace');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 2: symlinks cannot bypass deny rules or the workspace boundary', () => {
  it('refuses a read and a write through a symlink to a denied file', async () => {
    const harness = await createHarness({
      config: {
        rules: [
          { kind: 'read', action: 'deny', pattern: '**/secret.txt' },
          { kind: 'write', action: 'deny', pattern: '**/secret.txt' },
        ],
      },
    });
    try {
      await harness.write('secret.txt', 'TOP-SECRET\n');
      await symlink(harness.file('secret.txt'), harness.file('link.txt'));
      const read = await harness.call('read', { path: 'link.txt' });
      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain('Blocked by permissions configuration');
      const write = await harness.call('write', { path: 'link.txt', content: 'pwned\n' });
      expect(write.isError).toBe(true);
      expect(await readFile(harness.file('secret.txt'), 'utf-8')).toBe('TOP-SECRET\n');
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses a read through a symlink that escapes the workspace', async () => {
    const harness = await createHarness();
    try {
      const outside = harness.file('../outside-secret.txt');
      await writeFile(outside, 'OUTSIDE\n', 'utf-8');
      await symlink(outside, harness.file('escape.txt'));
      const read = await harness.call('read', { path: 'escape.txt' });
      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain('outside the workspace');
    } finally {
      await harness.cleanup();
    }
  });

  it('does not return a denied file through a symlink in grep or find', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/secret.txt' }] } });
    try {
      await harness.write('secret.txt', 'needle SECRET\n');
      await symlink(harness.file('secret.txt'), harness.file('alias.txt'));
      const grep = await harness.call('grep', { pattern: 'needle' });
      expect(textOf(grep)).toBe('No matches found');
      const find = await harness.call('find', { pattern: 'alias.txt' });
      expect(textOf(find)).toBe('No files found matching pattern');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 3: containment compares canonical paths', () => {
  it('allows a write through the realpath of the workspace', async () => {
    const harness = await createHarness();
    try {
      const real = await realpath(harness.workspace);
      const result = await harness.call('write', { path: path.join(real, 'canonical.txt'), content: 'x' });
      expect(result.isError).toBeUndefined();
      expect(await readFile(path.join(real, 'canonical.txt'), 'utf-8')).toBe('x');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 4: a unified diff add writes the added lines', () => {
  it('creates the file with its content', async () => {
    const harness = await createHarness();
    try {
      const patch = ['--- /dev/null', '+++ b/added.txt', '@@ -0,0 +1,2 @@', '+hello', '+world', ''].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('added.txt'), 'utf-8')).toBe('hello\nworld\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 5: a failed move keeps the source', () => {
  it('leaves the source in place when the destination cannot be created', async () => {
    const harness = await createHarness();
    try {
      await harness.write('old.txt', 'content\n');
      await harness.write('blocker', 'not a directory\n');
      const patch = ['*** Begin Patch', '*** Update File: old.txt', '*** Move to: blocker/moved.txt', '@@', '-content', '+moved', '*** End Patch'].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(await readFile(harness.file('old.txt'), 'utf-8')).toBe('content\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 6: patches serialize with edits and with each other', () => {
  it('keeps the edit result when a patch runs at the same time', async () => {
    const harness = await createHarness();
    try {
      await harness.write('race.txt', 'base\n');
      const results = await Promise.all([
        harness.call('edit', { path: 'race.txt', edits: [{ oldText: 'base', newText: 'edited' }] }),
        harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: race.txt', '@@', '-base', '+patched', '*** End Patch'].join('\n') }),
      ]);
      expect(results.filter((result) => result.isError === undefined)).toHaveLength(1);
      const final = await readFile(harness.file('race.txt'), 'utf-8');
      expect(final).toBe(results[0]?.isError === undefined ? 'edited\n' : 'patched\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 7: delete serializes with other mutations', () => {
  it('produces exactly one success for two concurrent deletes', async () => {
    const harness = await createHarness();
    try {
      await harness.write('gone.txt', 'x');
      const results = await Promise.all([harness.call('delete', { path: 'gone.txt' }), harness.call('delete', { path: 'gone.txt' })]);
      expect(results.filter((result) => result.isError === undefined)).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 8: save_resource checks overwrite inside the queue', () => {
  it('produces exactly one success for two overwrite:false writes', async () => {
    const harness = await createHarness();
    try {
      const results = await Promise.all([harness.call('save_resource', { path: 'out.txt', content: 'A' }), harness.call('save_resource', { path: 'out.txt', content: 'B' })]);
      expect(results.filter((result) => result.isError === undefined)).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 9: a redirect cannot bypass a URL deny rule', () => {
  it('refuses the redirect target', async () => {
    const harness = await createHarness({
      config: { rules: [{ kind: 'read', action: 'deny', pattern: 'https://blocked.example/**' }] },
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === 'https://start.example/go') {
          return new Response(null, { status: 302, headers: { location: 'https://blocked.example/secret' } });
        }
        return new Response('SECRET-BODY', { status: 200, headers: { 'content-type': 'text/plain' } });
      }) as typeof fetch,
    });
    try {
      const result = await harness.call('web_fetch', { url: 'https://start.example/go' }, { hasUI: true });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Blocked by permissions configuration');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 10: web_fetch honors abort and timeout for the body', () => {
  it('aborts without saving the body', async () => {
    const harness = await createHarness({
      fetch: ((_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          setTimeout(() => undefined, 5000);
        })) as typeof fetch,
    });
    try {
      const controller = new AbortController();
      const pending = harness.call('web_fetch', { url: 'https://example.com/slow', saveTo: 'saved.txt' }, { signal: controller.signal, hasUI: true });
      setTimeout(() => controller.abort(), 50);
      const result = await pending;
      expect(result.isError).toBe(true);
      await expect(readFile(harness.file('saved.txt'), 'utf-8')).rejects.toThrow();
    } finally {
      await harness.cleanup();
    }
  });

  it('times out while reading the body', async () => {
    const harness = await createHarness({
      fetch: (async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('first'));
            },
          }),
          { status: 200, headers: { 'content-type': 'text/plain' } },
        )) as typeof fetch,
    });
    try {
      const started = Date.now();
      const result = await harness.call('web_fetch', { url: 'https://example.com/stall', timeoutMs: 1000 }, { hasUI: true });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('timed out');
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 11: web_fetch saveTo honors ignore rules', () => {
  it('refuses a path the ignore file excludes', async () => {
    const harness = await createHarness({ fetch: (async () => new Response('body', { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof fetch });
    try {
      await harness.write('.piignore', 'out/\n');
      const result = await harness.call('web_fetch', { url: 'https://example.com/page', saveTo: 'out/page.txt' }, { hasUI: true });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('filtered out by .piignore');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 12: one ignore verdict across search and read', () => {
  it('applies an ancestor ignore file to grep and find', async () => {
    const harness = await createHarness();
    try {
      await writeFile(path.join(harness.root, '.piignore'), 'workspace/vendor/\n', 'utf-8');
      await harness.write('vendor/x.txt', 'needle\n');
      await harness.write('top.txt', 'needle\n');
      const grep = await harness.call('grep', { pattern: 'needle' });
      expect(textOf(grep)).toContain('top.txt');
      expect(textOf(grep)).not.toContain('vendor/x.txt');
      const find = await harness.call('find', { pattern: '*.txt' });
      expect(textOf(find)).not.toContain('vendor/x.txt');
    } finally {
      await harness.cleanup();
    }
  });

  it('applies .gitignore outside a git repository', async () => {
    const harness = await createHarness();
    try {
      await harness.write('.gitignore', 'sub/\n');
      await harness.write('sub/x.txt', 'needle\n');
      await harness.write('top.txt', 'needle\n');
      const grep = await harness.call('grep', { pattern: 'needle' });
      expect(textOf(grep)).not.toContain('sub/x.txt');
    } finally {
      await harness.cleanup();
    }
  });

  it('applies a nested ignore file to read and search', async () => {
    const harness = await createHarness();
    try {
      await harness.write('sub/.gitignore', 'secret.txt\n');
      await harness.write('sub/secret.txt', 'needle hidden\n');
      await harness.write('visible.txt', 'needle shown\n');
      const grep = await harness.call('grep', { pattern: 'needle' });
      expect(textOf(grep)).not.toContain('sub/secret.txt');
      const read = await harness.call('read', { path: 'sub/secret.txt' });
      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain('.gitignore');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 13: a command outside the workspace needs approval', () => {
  it('refuses a cwd outside the workspace without a UI', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('bash', { command: 'pwd', cwd: '..' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('outside the workspace');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 14: exec deny rules apply to every command segment', () => {
  it('blocks a prefixed and a chained command', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] } });
    try {
      for (const command of ['cd . && echo secret-value', 'true; echo secret-value', 'echo secret-value | cat', 'echo secret-value\n']) {
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

describe('finding 15: git keeps stdout when it exits non-zero', () => {
  it('returns the diff and the exit code', async () => {
    const harness = await createHarness();
    try {
      await mkdir(harness.file('repo'), { recursive: true });
      await writeFile(harness.file('repo/tracked.txt'), 'one\n', 'utf-8');
      await harness.call('git', { subcommand: 'init', cwd: 'repo' });
      await harness.call('git', { subcommand: 'config', args: ['user.email', 't@e.com'], cwd: 'repo' });
      await harness.call('git', { subcommand: 'config', args: ['user.name', 'T'], cwd: 'repo' });
      await harness.call('git', { subcommand: 'add', args: ['tracked.txt'], cwd: 'repo' });
      await harness.call('git', { subcommand: 'commit', args: ['-m', 'one'], cwd: 'repo' });
      await writeFile(harness.file('repo/tracked.txt'), 'two\n', 'utf-8');
      const result = await harness.call('git', { subcommand: 'diff', args: ['--exit-code'], cwd: 'repo' });
      expect(textOf(result)).toContain('-one');
      expect(textOf(result)).toContain('+two');
      expect((result.details as { exitCode?: number }).exitCode).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 16: grep parses a match whose text contains a line-like token', () => {
  it('reports the real path, line, and text', async () => {
    const harness = await createHarness();
    try {
      await harness.write('notes.txt', 'first\nerror code :12: boom\n');
      const result = await harness.call('grep', { pattern: 'boom' });
      expect(textOf(result)).toBe('notes.txt:2: error code :12: boom');
      const details = result.details as { matches?: readonly { file: string; line: number; text: string }[] };
      expect(details.matches?.[0]).toMatchObject({ file: 'notes.txt', line: 2, text: 'error code :12: boom' });
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 17: an edit matches CRLF text copied from read', () => {
  it('replaces the line and keeps CRLF', async () => {
    const harness = await createHarness();
    try {
      await harness.write('crlf.txt', 'alpha\r\nbeta\r\n');
      const result = await harness.call('edit', { path: 'crlf.txt', edits: [{ oldText: 'alpha\r\n', newText: 'ALPHA\r\n' }] });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('crlf.txt'), 'utf-8')).toBe('ALPHA\r\nbeta\r\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 18: a context-only patch on a file without a final newline is a no-op', () => {
  it('refuses and leaves the bytes unchanged', async () => {
    const harness = await createHarness();
    try {
      await writeFile(harness.file('nonewline.txt'), 'line', 'utf-8');
      const result = await harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: nonewline.txt', '@@', ' line', '*** End Patch'].join('\n') });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('no changes');
      expect(await readFile(harness.file('nonewline.txt'), 'utf-8')).toBe('line');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 19: documented argument aliases work on every path tool', () => {
  it('accepts file_path on read and directory on ls', async () => {
    const harness = await createHarness();
    try {
      await harness.write('a.txt', 'content\n');
      await harness.write('sub/inner.txt', 'inner\n');
      const read = await harness.call('read', { file_path: 'a.txt' });
      expect(read.isError).toBeUndefined();
      expect(textOf(read)).toContain('content');
      const ls = await harness.call('ls', { directory: 'sub' });
      expect(textOf(ls)).toBe('inner.txt');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 20: grep reports the cap instead of no matches', () => {
  it('surfaces the cap notice when the cap left nothing', async () => {
    const harness = await createHarness();
    try {
      const sessionModule = await import('../src/core/session.ts');
      const { createGrepLayerTool } = await import('../src/tools/grep.ts');
      const tool = createGrepLayerTool({
        session: async (ctx) => sessionModule.createSessionManager({ agentDir: harness.agentDir, home: harness.root, env: process.env }).get(ctx),
        run: async () => ({ lines: [], totalLines: 12000, totalBytes: 12000, truncated: true, timedOut: false, limitReached: true, killedByByteCap: false, stderr: '', exitCode: null }),
      });
      const result = await tool.execute('call', { pattern: 'needle' }, undefined, undefined, { cwd: harness.workspace } as never);
      const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
      expect(text).not.toBe('No matches found');
      expect(text).toContain('limit');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 21: patch counts report one insertion as +1/-0', () => {
  it('reports the counts the hunk performs', async () => {
    const harness = await createHarness();
    try {
      await harness.write('insert.txt', 'line\n');
      const result = await harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: insert.txt', '@@', '+inserted', ' line', '*** End Patch'].join('\n') });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('+1/-0');
      expect(await readFile(harness.file('insert.txt'), 'utf-8')).toBe('inserted\nline\n');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 22: a tail read reports its real line range', () => {
  it('shows the last two lines of five', async () => {
    const harness = await createHarness();
    try {
      await harness.write('five.txt', 'a\nb\nc\nd\ne\n');
      const result = await harness.call('read', { path: 'five.txt', offset: -2 });
      expect(textOf(result)).toContain('lines 4-5');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('finding 23: a failed edit leaves no directory behind', () => {
  it('does not create the parent of a missing file', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('edit', { path: 'missing-dir/nope.txt', edits: [{ oldText: 'a', newText: 'b' }] });
      expect(result.isError).toBe(true);
      await expect(readFile(harness.file('missing-dir/nope.txt'), 'utf-8')).rejects.toThrow();
      const listing = await harness.call('ls', {});
      expect(textOf(listing)).not.toContain('missing-dir');
    } finally {
      await harness.cleanup();
    }
  });
});
