import { writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { createHarness, textOf } from './harness.ts';

describe('read', () => {
  it('reads a full file and reports metadata', async () => {
    const harness = await createHarness();
    try {
      await harness.write('notes.txt', 'alpha\nbeta\ngamma\n');
      const result = await harness.call('read', { path: 'notes.txt' });
      const text = textOf(result);
      expect(text).toContain('alpha\nbeta\ngamma');
      expect(text).toContain('[file: 3 lines, 17 bytes]');
      const details = result.details as { metadata?: { bytes: number; lines: number; sha256?: string } };
      expect(details.metadata?.bytes).toBe(17);
      expect(details.metadata?.lines).toBe(3);
      expect(details.metadata?.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await harness.cleanup();
    }
  });

  it('reads a window with offset and limit', async () => {
    const harness = await createHarness();
    try {
      await harness.write('lines.txt', '1\n2\n3\n4\n5\n');
      const result = await harness.call('read', { path: 'lines.txt', offset: 2, limit: 2 });
      const text = textOf(result);
      expect(text.split('\n\n')[0]).toBe('2\n3');
      expect(text).toContain('[file: 5 lines, 10 bytes · lines 2-3]');
    } finally {
      await harness.cleanup();
    }
  });

  it('reads the tail with a negative offset', async () => {
    const harness = await createHarness();
    try {
      await harness.write('lines.txt', '1\n2\n3\n4\n5\n');
      const result = await harness.call('read', { path: 'lines.txt', offset: -2 });
      const text = textOf(result);
      expect(text).toContain('4\n5');
      expect(text).not.toContain('1\n2');
    } finally {
      await harness.cleanup();
    }
  });

  it('reports a missing file, a directory, and binary content', async () => {
    const harness = await createHarness();
    try {
      await harness.write('dir/keep.txt', 'x');
      await writeFile(harness.file('blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      const missing = await harness.call('read', { path: 'nope.txt' });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toContain('File not found');
      const directory = await harness.call('read', { path: 'dir' });
      expect(directory.isError).toBe(true);
      expect(textOf(directory)).toContain('is a directory, not a file');
      const binary = await harness.call('read', { path: 'blob.bin' });
      expect(binary.isError).toBe(true);
      expect(textOf(binary)).toContain('binary data, not text');
    } finally {
      await harness.cleanup();
    }
  });

  it('applies read permission rules', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    try {
      await harness.write('.env', 'SECRET=1\n');
      const denied = await harness.call('read', { path: '.env' });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain('Blocked by permissions configuration');
    } finally {
      await harness.cleanup();
    }
  });

  it('asks before reading outside the workspace and refuses without a UI', async () => {
    const harness = await createHarness();
    try {
      const outside = harness.file('../outside.txt');
      await writeFile(outside, 'outside\n', 'utf-8');
      const denied = await harness.call('read', { path: '../outside.txt' });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain('no approval channel');

      const approved = await harness.call('read', { path: '../outside.txt' }, { hasUI: true });
      expect(approved.isError).toBeUndefined();
      expect(textOf(approved)).toContain('outside');
      expect(harness.confirmations).toHaveLength(1);
      expect(harness.confirmations[0]?.title).toContain('Allow read file');
    } finally {
      await harness.cleanup();
    }
  });

  it('returns an image block for an image file', async () => {
    const harness = await createHarness();
    try {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      await writeFile(harness.file('pixel.png'), png);
      const result = await harness.call('read', { path: 'pixel.png' });
      expect(result.content.some((block) => block.type === 'image')).toBe(true);
      expect(textOf(result)).toContain('Read image file');
    } finally {
      await harness.cleanup();
    }
  });

  it('records a fingerprint so a later write from the same call refuses stale content', async () => {
    const harness = await createHarness();
    try {
      const target = await harness.write('race.txt', 'one\n');
      const read = await harness.call('read', { path: 'race.txt' }, { toolCallId: 'same-call' });
      expect(read.isError).toBeUndefined();
      await writeFile(target, 'changed elsewhere\n', 'utf-8');
      const write = await harness.call('write', { path: 'race.txt', content: 'mine\n' }, { toolCallId: 'same-call' });
      expect(write.isError).toBe(true);
      expect(textOf(write)).toContain('changed on disk after this tool call read it');
    } finally {
      await harness.cleanup();
    }
  });

  it('does not fence a ranged read', async () => {
    const harness = await createHarness();
    try {
      const target = await harness.write('race2.txt', 'one\ntwo\n');
      await harness.call('read', { path: 'race2.txt', offset: 1, limit: 1 }, { toolCallId: 'same-call' });
      await writeFile(target, 'changed\ntwo\n', 'utf-8');
      const write = await harness.call('write', { path: 'race2.txt', content: 'mine\n' }, { toolCallId: 'same-call' });
      expect(write.isError).toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });
});
