import { mkdir, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { failureOutcome, failureText, LayerError, layerError, toFailure } from '../src/core/errors.ts';
import { fileMetadata, fileSize, fingerprintFile, isTextReadableSize, readHead } from '../src/core/metadata.ts';
import { applyHunks, PatchError, parsePatch, splitLines } from '../src/core/patch.ts';
import { runBinary, streamLines } from '../src/core/proc.ts';
import { createReadFence } from '../src/core/read-fence.ts';
import { PATH_ALIASES, repairArguments } from '../src/core/repair.ts';
import { createHarness } from './harness.ts';

describe('repairArguments', () => {
  it('maps aliases onto canonical names and drops the alias', () => {
    expect(repairArguments({ file_path: 'a.txt' }, { aliases: PATH_ALIASES })).toEqual({ path: 'a.txt' });
  });

  it('keeps an explicit canonical value over an alias', () => {
    expect(repairArguments({ path: 'real.txt', file_path: 'alias.txt' }, { aliases: PATH_ALIASES })).toEqual({ path: 'real.txt' });
  });

  it('parses arrays from JSON strings and wraps single objects', () => {
    expect(repairArguments({ edits: '[{"oldText":"a","newText":"b"}]' }, { arrays: ['edits'] })).toEqual({ edits: [{ oldText: 'a', newText: 'b' }] });
    expect(repairArguments({ edits: { oldText: 'a', newText: 'b' } }, { arrays: ['edits'] })).toEqual({ edits: [{ oldText: 'a', newText: 'b' }] });
    expect(repairArguments({ edits: 'not json' }, { arrays: ['edits'] })).toEqual({ edits: 'not json' });
  });

  it('coerces numbers, booleans, and strings', () => {
    expect(repairArguments({ limit: '50' }, { numbers: ['limit'] })).toEqual({ limit: 50 });
    expect(repairArguments({ limit: 'many' }, { numbers: ['limit'] })).toEqual({ limit: 'many' });
    expect(repairArguments({ replaceAll: 'true' }, { booleans: ['replaceAll'] })).toEqual({ replaceAll: true });
    expect(repairArguments({ path: 42 }, { strings: ['path'] })).toEqual({ path: '42' });
  });

  it('drops null fields and leaves non-objects alone', () => {
    expect(repairArguments({ path: '/a', limit: null }, {})).toEqual({ path: '/a' });
    expect(repairArguments(null, {})).toBeNull();
    expect(repairArguments([1, 2], {})).toEqual([1, 2]);
  });
});

describe('failures', () => {
  it('renders a message with an optional hint', () => {
    expect(failureText({ kind: 'error', message: 'boom' })).toBe('boom');
    expect(failureText({ kind: 'error', message: 'boom', hint: 'try again' })).toBe('boom\n\ntry again');
  });

  it('builds an error outcome with details', () => {
    const outcome = failureOutcome({ kind: 'error', message: 'boom' }, (failure) => ({ message: failure.message }));
    expect(outcome.isError).toBe(true);
    expect(outcome.content[0]).toEqual({ type: 'text', text: 'boom' });
    expect(outcome.details).toEqual({ message: 'boom' });
  });

  it('maps errno codes and passes layer errors through', () => {
    const enoent = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(toFailure(enoent, '/x').kind).toBe('file_not_found');
    const eacces = Object.assign(new Error('denied'), { code: 'EACCES' });
    expect(toFailure(eacces, '/x').kind).toBe('permission_denied');
    const enospc = Object.assign(new Error('full'), { code: 'ENOSPC' });
    expect(toFailure(enospc, '/x').kind).toBe('no_space');
    const ebusy = Object.assign(new Error('busy'), { code: 'EBUSY' });
    expect(toFailure(ebusy, '/x').kind).toBe('file_busy');
    expect(toFailure(new Error('other'), '/x').kind).toBe('error');
    expect(toFailure('string failure').message).toBe('string failure');
    const layer = layerError('invalid_args' as never, 'custom');
    expect(toFailure(layer)).toBe((layer as LayerError).failure);
  });
});

describe('metadata', () => {
  it('reports size, lines, mtime, and digest, and can skip the digest', async () => {
    const harness = await createHarness();
    try {
      await harness.write('data.txt', 'one\ntwo\n');
      const withDigest = await fileMetadata(harness.file('data.txt'));
      expect(withDigest.bytes).toBe(8);
      expect(withDigest.lines).toBe(2);
      expect(withDigest.sha256).toMatch(/^[a-f0-9]{64}$/);
      const withoutDigest = await fileMetadata(harness.file('data.txt'), { digest: false });
      expect(withoutDigest.sha256).toBeUndefined();
      expect(await fileSize(harness.file('data.txt'))).toBe(8);
      expect(await fileSize(harness.file('nope'))).toBeUndefined();
      expect(await fileSize(harness.workspace)).toBeUndefined();
      expect((await readHead(harness.file('data.txt'), 3)).toString()).toBe('one');
      expect(isTextReadableSize(10)).toBe(true);
      expect(isTextReadableSize(Number.MAX_SAFE_INTEGER)).toBe(false);
      const fingerprint = await fingerprintFile(harness.file('data.txt'));
      expect(fingerprint?.bytes).toBe(8);
    } finally {
      await harness.cleanup();
    }
  });

  it('skips fingerprints for binary files and missing paths', async () => {
    const harness = await createHarness();
    try {
      await writeFile(harness.file('bin'), Buffer.from([0, 1, 2]));
      expect(await fingerprintFile(harness.file('bin'))).toBeUndefined();
      expect(await fingerprintFile(harness.file('missing'))).toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });
});

describe('read fence', () => {
  it('records, takes, restores, forgets, and keeps entries', () => {
    const fence = createReadFence();
    const record = { kind: 'absent' as const };
    fence.record('/a', record);
    expect(fence.take('/a')).toEqual(record);
    expect(fence.take('/a')).toBeUndefined();

    fence.record('/b', record);
    fence.restore('/b', record);
    expect(fence.take('/b')).toEqual(record);

    fence.record('/c', record);
    fence.forget('/c');
    expect(fence.take('/c')).toBeUndefined();

    fence.record('/d', record);
    expect(fence.take('/d')).toEqual(record);

    fence.record('/e', record);
    expect(fence.size()).toBe(1);
  });

  it('caps the number of entries', () => {
    const fence = createReadFence();
    for (let index = 0; index < 1200; index++) {
      fence.record(`/file-${index}`, { kind: 'absent' });
    }
    expect(fence.size()).toBeLessThanOrEqual(1000);
  });
});

describe('proc', () => {
  it('runs a binary and returns stdout, stderr, and code', async ({ signal }) => {
    const result = await runBinary('sh', ['-c', 'printf out; printf err >&2; exit 3'], { cwd: process.cwd(), signal });
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.code).toBe(3);
  });

  it('rejects a missing binary and a timeout', async ({ signal }) => {
    await expect(runBinary('definitely-not-a-binary-xyz', [], { cwd: process.cwd(), signal })).rejects.toThrow();
    await expect(runBinary('sh', ['-c', 'sleep 5'], { cwd: process.cwd(), timeoutMs: 100, signal })).rejects.toThrow('Timed out');
  });

  it('rejects an abort that arrives while the process is running', async ({ signal }) => {
    const controller = new AbortController();
    const pending = streamLines('sh', ['-c', 'echo first; sleep 5'], { cwd: process.cwd(), timeoutMs: 10_000, signal: AbortSignal.any([signal, controller.signal]) });
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow('Operation aborted');
  });

  it('rejects an aborted run', async ({ signal }) => {
    const controller = new AbortController();
    const pending = runBinary('sh', ['-c', 'sleep 5'], { cwd: process.cwd(), signal: AbortSignal.any([signal, controller.signal]) });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow('Operation aborted');
  });
});

describe('patch parsing details', () => {
  it('rejects content before a file directive and unknown markers', () => {
    expect(() => parsePatch('*** Begin Patch\n@@\n-a\n+b\n*** End Patch')).toThrow(/before any file directive/);
    expect(() => parsePatch('*** Begin Patch\n*** Update File: a\n@@\n?a\n*** End Patch')).toThrow(/unexpected line/);
    expect(() => parsePatch('*** Begin Patch\n*** Update File: a\n@@\n-a\n+b\n')).toThrow(/missing \*\*\* End Patch/);
  });

  it('rejects a malformed unified diff', () => {
    expect(() => parsePatch('--- a/x\n')).toThrow(/missing the \+\+\+ line/);
    expect(() => parsePatch('--- a/x\n+++ b/x\n@@ bad\n')).toThrow(/malformed hunk header/);
    expect(() => parsePatch('--- a/x\n+++ b/x\n')).toThrow(/contains no hunks/);
  });

  it('rejects an add directive with an unmarked line', () => {
    expect(() => parsePatch('*** Begin Patch\n*** Add File: x\nplain\n*** End Patch')).toThrow(/does not start with/);
  });

  it('applies hunks and reports a miss', () => {
    const lines = splitLines('a\nb\nc\n');
    expect(applyHunks(lines, [{ oldLines: ['b'], newLines: ['B'] }], 'f')).toEqual(['a', 'B', 'c']);
    expect(() => applyHunks(lines, [{ oldLines: ['z'], newLines: ['Z'] }], 'f')).toThrow(PatchError);
  });

  it('splits lines without inventing a trailing empty line', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
  });
});

describe('tool edge cases', () => {
  it('reports an out-of-range read offset the way the reader does', async () => {
    const harness = await createHarness();
    try {
      await harness.write('short.txt', 'one\n');
      const result = await harness.call('read', { path: 'short.txt', offset: 99 });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('beyond end of file');
    } finally {
      await harness.cleanup();
    }
  });

  it('reports an empty file with zero lines', async () => {
    const harness = await createHarness();
    try {
      await writeFile(harness.file('empty.txt'), '');
      const result = await harness.call('read', { path: 'empty.txt' });
      const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
      expect(text).toContain('[file: 0 lines, 0 bytes]');
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses an edit with no edits, an empty oldText, and a missing file', async () => {
    const harness = await createHarness();
    try {
      await harness.write('target.txt', 'x\n');
      const none = await harness.call('edit', { path: 'target.txt', edits: [] });
      expect(none.isError).toBe(true);
      const empty = await harness.call('edit', { path: 'target.txt', edits: [{ oldText: '', newText: 'y' }] });
      expect(empty.isError).toBe(true);
      const missing = await harness.call('edit', { path: 'nope.txt', edits: [{ oldText: 'a', newText: 'b' }] });
      expect(missing.isError).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it('reports a truncated search output and a timed-out empty search', async () => {
    const harness = await createHarness();
    try {
      const sessionModule = await import('../src/core/session.ts');
      const session = async (ctx: { cwd: string }) => sessionModule.createSessionManager({ agentDir: harness.agentDir, home: harness.root, env: process.env }).get(ctx);
      const { createGrepLayerTool } = await import('../src/tools/grep.ts');
      const truncated = createGrepLayerTool({
        session,
        run: async () => ({ lines: [`${harness.file('a.txt')}:1: hit`], totalLines: 1, totalBytes: 20, truncated: true, timedOut: false, limitReached: false, killedByByteCap: true, stderr: '', exitCode: 0 }),
      });
      await harness.write('a.txt', 'hit\n');
      const result = await truncated.execute('call', { pattern: 'hit' }, undefined, undefined, { cwd: harness.workspace } as never);
      expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('output truncated at the search output cap');

      const timedOut = createGrepLayerTool({
        session,
        run: async () => ({ lines: [], totalLines: 0, totalBytes: 0, truncated: true, timedOut: true, limitReached: false, killedByByteCap: false, stderr: '', exitCode: null }),
      });
      const empty = await timedOut.execute('call', { pattern: 'hit' }, undefined, undefined, { cwd: harness.workspace } as never);
      expect(empty.content[0]?.type === 'text' ? empty.content[0].text : '').toContain('timed out');
    } finally {
      await harness.cleanup();
    }
  });

  it('reports a search root that does not exist and an empty pattern', async () => {
    const harness = await createHarness();
    try {
      const missing = await harness.call('grep', { pattern: 'x', path: 'nope' });
      expect(missing.isError).toBe(true);
      const emptyPattern = await harness.call('grep', { pattern: '' });
      expect(emptyPattern.isError).toBe(true);
      const emptyGlob = await harness.call('find', { pattern: '  ' });
      expect(emptyGlob.isError).toBe(true);
      const missingGlob = await harness.call('find', { pattern: '*.ts', path: 'nope' });
      expect(missingGlob.isError).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it('filters a directory named by an ignore pattern with a trailing slash', async () => {
    const harness = await createHarness();
    try {
      await harness.write('.piignore', 'generated/\n');
      await harness.write('generated/inside.txt', 'x');
      await harness.write('kept.txt', 'x');
      const result = await harness.call('ls', {});
      const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
      expect(text).toContain('kept.txt');
      expect(text).not.toContain('generated/');
    } finally {
      await harness.cleanup();
    }
  });

  it('lists an empty directory and enforces the name budget', async () => {
    const harness = await createHarness();
    try {
      await mkdir(harness.file('empty'), { recursive: true });
      const empty = await harness.call('ls', { path: 'empty' });
      expect(empty.content[0]?.type === 'text' ? empty.content[0].text : '').toBe('(empty directory)');
      for (let index = 0; index < 120; index++) {
        await harness.write(`budget/file-with-a-long-name-${index}.txt`, 'x');
      }
      const budget = await harness.call('ls', { path: 'budget' });
      expect((budget.details as { truncated?: boolean }).truncated).toBe(true);
      expect(budget.content[0]?.type === 'text' ? budget.content[0].text : '').toContain('characters');
    } finally {
      await harness.cleanup();
    }
  });
});
