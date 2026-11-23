import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { createHarness, textOf } from './harness.ts';

describe('apply_patch', () => {
  it('updates a file with a directive patch', async () => {
    const harness = await createHarness();
    try {
      await harness.write('app.ts', 'const a = 1;\nconst b = 2;\n');
      const patch = ['*** Begin Patch', '*** Update File: app.ts', '@@', ' const a = 1;', '-const b = 2;', '+const b = 3;', '*** End Patch'].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('Applied patch to 1 file(s)');
      expect(await readFile(harness.file('app.ts'), 'utf-8')).toBe('const a = 1;\nconst b = 3;\n');
      const details = result.details as { files?: readonly { hunks: number; added: number; removed: number }[] };
      expect(details.files?.[0]?.hunks).toBe(1);
      expect(details.files?.[0]?.added).toBe(1);
      expect(details.files?.[0]?.removed).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });

  it('adds, deletes, and moves files in one patch', async () => {
    const harness = await createHarness();
    try {
      await harness.write('old.txt', 'content\n');
      await harness.write('remove.txt', 'bye\n');
      const patch = ['*** Begin Patch', '*** Add File: new/dir/added.txt', '+hello', '+world', '*** Delete File: remove.txt', '*** Update File: old.txt', '*** Move to: moved.txt', '@@', '-content', '+moved content', '*** End Patch'].join(
        '\n',
      );
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('new/dir/added.txt'), 'utf-8')).toBe('hello\nworld\n');
      await expect(readFile(harness.file('remove.txt'), 'utf-8')).rejects.toThrow();
      expect(await readFile(harness.file('moved.txt'), 'utf-8')).toBe('moved content\n');
      await expect(readFile(harness.file('old.txt'), 'utf-8')).rejects.toThrow();
    } finally {
      await harness.cleanup();
    }
  });

  it('applies a unified diff', async () => {
    const harness = await createHarness();
    try {
      await harness.write('src/u.txt', 'alpha\nbeta\ngamma\n');
      const patch = ['--- a/src/u.txt', '+++ b/src/u.txt', '@@ -1,3 +1,3 @@', ' alpha', '-beta', '+BETA', ' gamma', ''].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('src/u.txt'), 'utf-8')).toBe('alpha\nBETA\ngamma\n');
    } finally {
      await harness.cleanup();
    }
  });

  it('writes nothing when the patch is malformed', async () => {
    const harness = await createHarness();
    try {
      await harness.write('keep.txt', 'untouched\n');
      const missingEnd = await harness.call('apply_patch', { patch: '*** Begin Patch\n*** Update File: keep.txt\n@@\n-untouched\n+changed\n' });
      expect(missingEnd.isError).toBe(true);
      expect(textOf(missingEnd)).toContain('Invalid patch');
      expect(textOf(missingEnd)).toContain('missing *** End Patch');

      const unknownDirective = await harness.call('apply_patch', { patch: '*** Begin Patch\n*** Rename File: keep.txt\n*** End Patch' });
      expect(unknownDirective.isError).toBe(true);
      expect(textOf(unknownDirective)).toContain('unknown patch directive');

      const empty = await harness.call('apply_patch', { patch: '   ' });
      expect(empty.isError).toBe(true);
      expect(textOf(empty)).toContain('patch is empty');
      expect(await readFile(harness.file('keep.txt'), 'utf-8')).toBe('untouched\n');
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses a hunk that does not match', async () => {
    const harness = await createHarness();
    try {
      await harness.write('mismatch.txt', 'actual\n');
      const patch = ['*** Begin Patch', '*** Update File: mismatch.txt', '@@', '-expected', '+changed', '*** End Patch'].join('\n');
      const result = await harness.call('apply_patch', { patch });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('does not match the file contents');
      expect(textOf(result)).toContain('Nothing was written');
      expect(await readFile(harness.file('mismatch.txt'), 'utf-8')).toBe('actual\n');
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses an ambiguous hunk, an existing add target, and a missing update target', async () => {
    const harness = await createHarness();
    try {
      await harness.write('dup.txt', 'same\nsame\n');
      const ambiguous = await harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: dup.txt', '@@', '-same', '+other', '*** End Patch'].join('\n') });
      expect(ambiguous.isError).toBe(true);
      expect(textOf(ambiguous)).toContain('matches more than one place');

      await harness.write('exists.txt', 'x\n');
      const existing = await harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Add File: exists.txt', '+y', '*** End Patch'].join('\n') });
      expect(existing.isError).toBe(true);
      expect(textOf(existing)).toContain('already exists');

      const missing = await harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: nope.txt', '@@', '-a', '+b', '*** End Patch'].join('\n') });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toContain('does not exist');
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses a patch whose update produces no change', async () => {
    const harness = await createHarness();
    try {
      await harness.write('noop.txt', 'line\n');
      const result = await harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: noop.txt', '@@', ' line', '*** End Patch'].join('\n') });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('no changes');
    } finally {
      await harness.cleanup();
    }
  });

  it('rejects a patch the permission policy denies', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'write', action: 'deny', pattern: '**/locked.txt' }] } });
    try {
      await harness.write('locked.txt', 'x\n');
      const result = await harness.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: locked.txt', '@@', '-x', '+y', '*** End Patch'].join('\n') });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Blocked by permissions configuration');
    } finally {
      await harness.cleanup();
    }
  });
});
