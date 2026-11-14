import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { resolvePinnedClaude } from '../scripts/pins.mjs';

const versionsDir = () => mkdtempSync(join(tmpdir(), 'claude-versions-'));

describe('resolvePinnedClaude', () => {
  test('uses claude on PATH when it is the pinned version', () => {
    expect(resolvePinnedClaude({ pin: '2.1.322', versionOf: () => '2.1.322', versionsDir: versionsDir() })).toBe('claude');
  });

  test('falls back to the installed pinned binary when PATH has moved on', () => {
    const dir = versionsDir();
    writeFileSync(join(dir, '2.1.322'), '');
    expect(resolvePinnedClaude({ pin: '2.1.322', versionOf: (bin) => (bin === 'claude' ? '2.1.323' : '2.1.322'), versionsDir: dir })).toBe(join(dir, '2.1.322'));
  });

  test('falls back to the installed pinned binary when claude is not on PATH', () => {
    const dir = versionsDir();
    writeFileSync(join(dir, '2.1.322'), '');
    const versionOf = (bin: string) => {
      if (bin === 'claude') throw new Error('spawnSync claude ENOENT');
      return '2.1.322';
    };
    expect(resolvePinnedClaude({ pin: '2.1.322', versionOf, versionsDir: dir })).toBe(join(dir, '2.1.322'));
  });

  test('refuses when no pinned binary exists', () => {
    expect(() => resolvePinnedClaude({ pin: '2.1.322', versionOf: () => '2.1.323', versionsDir: versionsDir() })).toThrow(/2\.1\.322/);
  });

  test('refuses a pinned-path binary that reports another version', () => {
    const dir = versionsDir();
    writeFileSync(join(dir, '2.1.322'), '');
    expect(() => resolvePinnedClaude({ pin: '2.1.322', versionOf: () => '2.1.323', versionsDir: dir })).toThrow(/2\.1\.322/);
  });
});
