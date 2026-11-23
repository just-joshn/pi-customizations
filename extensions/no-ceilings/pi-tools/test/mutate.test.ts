import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { createHarness, textOf } from './harness.ts';

describe('write', () => {
  it('creates a file with parents, then overwrites it', async () => {
    const harness = await createHarness();
    try {
      const created = await harness.call('write', { path: 'deep/dir/file.txt', content: 'one\ntwo\n' });
      expect(textOf(created)).toContain('Successfully wrote to deep/dir/file.txt');
      expect(textOf(created)).toContain('[wrote 2 lines, 8 bytes]');
      expect(await readFile(harness.file('deep/dir/file.txt'), 'utf-8')).toBe('one\ntwo\n');
      const details = created.details as { metadata?: { lines: number; bytes: number }; verified?: boolean };
      expect(details.metadata?.lines).toBe(2);
      expect(details.verified).toBe(true);

      const overwritten = await harness.call('write', { path: 'deep/dir/file.txt', content: 'three\n' });
      expect(overwritten.isError).toBeUndefined();
      expect(await readFile(harness.file('deep/dir/file.txt'), 'utf-8')).toBe('three\n');
    } finally {
      await harness.cleanup();
    }
  });

  it('writes base64 bytes and can return the content', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('write', { path: 'asset.bin', content: Buffer.from([0, 1, 2, 3]).toString('base64'), encoding: 'base64', returnContent: true });
      expect(result.isError).toBeUndefined();
      expect([...(await readFile(harness.file('asset.bin')))]).toEqual([0, 1, 2, 3]);
      const details = result.details as { content?: string; bytesWritten?: number };
      expect(details.bytesWritten).toBe(4);
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses a case-folding collision only on a volume that folds case', async () => {
    const harness = await createHarness();
    try {
      await harness.write('probe.txt', 'x');
      const foldsCase = await readFile(harness.file('PROBE.txt'), 'utf-8').then(
        () => true,
        () => false,
      );
      await harness.write('file.txt', 'existing\n');
      const result = await harness.call('write', { path: 'FILE.txt', content: 'mine\n' });
      if (foldsCase) {
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('does not tell names apart by case');
        expect(await readFile(harness.file('file.txt'), 'utf-8')).toBe('existing\n');
      } else {
        expect(result.isError).toBeUndefined();
        expect(await readFile(harness.file('FILE.txt'), 'utf-8')).toBe('mine\n');
      }
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses ignored paths and protected ignore files', async () => {
    const harness = await createHarness();
    try {
      await harness.write('.piignore', 'generated/\n');
      const ignored = await harness.call('write', { path: 'generated/out.txt', content: 'x' });
      expect(ignored.isError).toBe(true);
      expect(textOf(ignored)).toContain('filtered out by .piignore');
      const protectedFile = await harness.call('write', { path: '.piignore', content: 'x' });
      expect(protectedFile.isError).toBe(true);
      expect(textOf(protectedFile)).toContain('is protected');
    } finally {
      await harness.cleanup();
    }
  });

  it('asks before writing outside the workspace', async () => {
    const harness = await createHarness();
    try {
      const denied = await harness.call('write', { path: '../outside.txt', content: 'x' });
      expect(denied.isError).toBe(true);
      const approved = await harness.call('write', { path: '../outside.txt', content: 'x' }, { hasUI: true });
      expect(approved.isError).toBeUndefined();
      expect(harness.confirmations).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('edit', () => {
  it('replaces a unique block and reports a diff', async () => {
    const harness = await createHarness();
    try {
      await harness.write('app.ts', 'const a = 1;\nconst b = 2;\n');
      const result = await harness.call('edit', { path: 'app.ts', edits: [{ oldText: 'const b = 2;', newText: 'const b = 3;' }] });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('Successfully replaced 1 block(s) in app.ts.');
      expect(textOf(result)).toContain('const b = 3;');
      expect(await readFile(harness.file('app.ts'), 'utf-8')).toBe('const a = 1;\nconst b = 3;\n');
      const details = result.details as { diff?: string; patch?: string; replaced?: number; firstChangedLine?: number };
      expect(details.replaced).toBe(1);
      expect(details.diff).toContain('const b = 3;');
      expect(details.patch).toContain('---');
      expect(details.firstChangedLine).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });

  it('applies several disjoint edits in one call', async () => {
    const harness = await createHarness();
    try {
      await harness.write('multi.txt', 'one\ntwo\nthree\nfour\n');
      const result = await harness.call('edit', {
        path: 'multi.txt',
        edits: [
          { oldText: 'one', newText: 'ONE' },
          { oldText: 'four', newText: 'FOUR' },
        ],
      });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('multi.txt'), 'utf-8')).toBe('ONE\ntwo\nthree\nFOUR\n');
    } finally {
      await harness.cleanup();
    }
  });

  it('replaces every occurrence when replaceAll is set', async () => {
    const harness = await createHarness();
    try {
      await harness.write('all.txt', 'a a a\n');
      const ambiguous = await harness.call('edit', { path: 'all.txt', edits: [{ oldText: 'a', newText: 'b' }] });
      expect(ambiguous.isError).toBe(true);
      expect(textOf(ambiguous)).toContain('matches 3 places');
      expect((ambiguous.details as { failure?: { hint?: string } }).failure?.hint).toContain('replaceAll');

      const all = await harness.call('edit', { path: 'all.txt', edits: [{ oldText: 'a', newText: 'b', replaceAll: true }] });
      expect(all.isError).toBeUndefined();
      expect(await readFile(harness.file('all.txt'), 'utf-8')).toBe('b b b\n');
      expect((all.details as { replaced?: number }).replaced).toBe(3);
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses a missing match, an overlap, and a no-op edit', async () => {
    const harness = await createHarness();
    try {
      await harness.write('guard.txt', 'alpha\nbeta\n');
      const missing = await harness.call('edit', { path: 'guard.txt', edits: [{ oldText: 'gamma', newText: 'x' }] });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toContain('No match found for edit 1');

      const overlap = await harness.call('edit', {
        path: 'guard.txt',
        edits: [
          { oldText: 'alpha\nbeta', newText: 'x' },
          { oldText: 'beta', newText: 'y' },
        ],
      });
      expect(overlap.isError).toBe(true);
      expect(textOf(overlap)).toContain('overlap');

      const noop = await harness.call('edit', { path: 'guard.txt', edits: [{ oldText: 'alpha', newText: 'alpha' }] });
      expect(noop.isError).toBe(true);
      expect(textOf(noop)).toContain('made no changes');
      expect(await readFile(harness.file('guard.txt'), 'utf-8')).toBe('alpha\nbeta\n');
    } finally {
      await harness.cleanup();
    }
  });

  it('preserves a byte order mark and CRLF line endings', async () => {
    const harness = await createHarness();
    try {
      await harness.write('windows.txt', '\uFEFFfirst\r\nsecond\r\n');
      const result = await harness.call('edit', { path: 'windows.txt', edits: [{ oldText: 'second', newText: 'changed' }] });
      expect(result.isError).toBeUndefined();
      const raw = await readFile(harness.file('windows.txt'), 'utf-8');
      expect(raw).toBe('\uFEFFfirst\r\nchanged\r\n');
    } finally {
      await harness.cleanup();
    }
  });

  it('repairs legacy argument names', async () => {
    const harness = await createHarness();
    try {
      await harness.write('legacy.txt', 'old text\n');
      const definition = harness.tool('edit') as unknown as { prepareArguments?: (input: unknown) => unknown };
      const prepared = definition.prepareArguments?.({ file_path: 'legacy.txt', old_string: 'old text', new_string: 'new text' });
      const result = await harness.call('edit', prepared);
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('legacy.txt'), 'utf-8')).toBe('new text\n');
    } finally {
      await harness.cleanup();
    }
  });

  it('keeps concurrent writes to one file serialized and verified', async () => {
    const harness = await createHarness();
    try {
      const results = await Promise.all(Array.from({ length: 8 }, (_, index) => harness.call('write', { path: 'contended.txt', content: `writer ${index}\n` }, { toolCallId: `call-${index}` })));
      const failures = results.filter((result) => result.isError !== undefined).map((result) => JSON.stringify(result.content));
      expect(failures).toEqual([]);
      const final = await readFile(harness.file('contended.txt'), 'utf-8');
      expect(final).toMatch(/^writer [0-7]\n$/);
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses a file that changed since the same call read it', async () => {
    const harness = await createHarness();
    try {
      await harness.write('stale.txt', 'original\n');
      await harness.call('read', { path: 'stale.txt' }, { toolCallId: 'edit-call' });
      await harness.write('stale.txt', 'changed elsewhere\n');
      const result = await harness.call('edit', { path: 'stale.txt', edits: [{ oldText: 'original', newText: 'x' }] }, { toolCallId: 'edit-call' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('changed on disk after this tool call read it');
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses edits the permission policy denies', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'write', action: 'deny', pattern: '**/locked.txt' }] } });
    try {
      await harness.write('locked.txt', 'text\n');
      const result = await harness.call('edit', { path: 'locked.txt', edits: [{ oldText: 'text', newText: 'x' }] });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Blocked by permissions configuration');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('delete', () => {
  it('deletes a file and keeps the previous contents', async () => {
    const harness = await createHarness();
    try {
      await harness.write('gone.txt', 'byebye\n');
      const result = await harness.call('delete', { path: 'gone.txt' });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('Deleted gone.txt');
      const details = result.details as { deletedBytes?: number; previousContent?: string };
      expect(details.deletedBytes).toBe(7);
      expect(details.previousContent).toBe('byebye\n');
      const missing = await harness.call('read', { path: 'gone.txt' });
      expect(missing.isError).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses directories, missing files, ignored files, and denied paths', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'write', action: 'deny', pattern: '**/denied.txt' }] } });
    try {
      await harness.write('dir/keep.txt', 'x');
      await harness.write('denied.txt', 'x');
      await harness.write('.piignore', 'ignored.txt\n');
      await harness.write('ignored.txt', 'x');
      const directory = await harness.call('delete', { path: 'dir' });
      expect(directory.isError).toBe(true);
      expect(textOf(directory)).toContain('is a directory');
      const missing = await harness.call('delete', { path: 'nope.txt' });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toContain('File not found');
      const denied = await harness.call('delete', { path: 'denied.txt' });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain('Blocked by permissions configuration');
      const ignored = await harness.call('delete', { path: 'ignored.txt' });
      expect(ignored.isError).toBe(true);
      expect(textOf(ignored)).toContain('filtered out by .piignore');
    } finally {
      await harness.cleanup();
    }
  });
});
