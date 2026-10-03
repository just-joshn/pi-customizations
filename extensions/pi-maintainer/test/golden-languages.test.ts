import { describe, expect, test } from 'vitest';
import { filenameToLang } from '../src/languages.ts';
import { goldenJson } from './helpers/golden-fixtures.ts';

const PROBE_TABLE = goldenJson('languages.json') as Record<string, string | null>;

/** A recorded key is either an extension or a known basename. */
function probeFilename(key: string): string {
  return key.startsWith('.') ? `probe${key}` : key;
}

describe('filenameToLang parity with the recorded probe table', () => {
  test('records every probe the pinned reference answered', () => {
    expect(Object.keys(PROBE_TABLE)).toHaveLength(205);
    expect(PROBE_TABLE['notes.txt']).toBeNull();
  });

  test('matches the recorded language for every probe', () => {
    const mismatches = Object.entries(PROBE_TABLE)
      .map(([key, recorded]) => ({ key, recorded, actual: filenameToLang(probeFilename(key)) ?? null }))
      .filter((entry) => entry.actual !== entry.recorded);
    expect(mismatches).toEqual([]);
    expect(Object.keys(PROBE_TABLE).length).toBe(205);
  });

  test('keeps the two entries the reference spelling differs on', () => {
    expect(filenameToLang('probe.cs')).toBe('csharp');
    expect(filenameToLang('probe.XCompose')).toBe('xcompose');
  });
});
