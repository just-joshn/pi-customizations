import { describe, expect, test } from 'vitest';
import { badgeFor, canonicalDefaultMode, canonicalMode } from '../src/modes.ts';

describe('canonicalMode', () => {
  test.for([
    { raw: 'caveman', expected: 'caveman' },
    { raw: 'ULTRA', expected: 'ultracave' },
    { raw: 'wenyan-ultra', expected: 'megacave' },
    { raw: 'off', expected: 'off' },
    { raw: 'commit', expected: 'commit' },
    { raw: 'manual', expected: null },
    { raw: '', expected: null },
    { raw: 'constructor', expected: null },
    { raw: 42, expected: null },
    { raw: null, expected: null },
    { raw: undefined, expected: null },
  ])('$raw → $expected', ({ raw, expected }) => {
    expect(canonicalMode(raw)).toBe(expected);
  });
});

describe('canonicalDefaultMode', () => {
  test.for([
    { raw: 'Manual', expected: 'manual' },
    { raw: 'lite', expected: 'caveman' },
    { raw: 'loud', expected: null },
    { raw: undefined, expected: null },
  ])('$raw → $expected', ({ raw, expected }) => {
    expect(canonicalDefaultMode(raw)).toBe(expected);
  });
});

describe('badgeFor', () => {
  test.for([
    { mode: 'caveman', expected: '[CAVEMAN]' },
    { mode: 'megacave', expected: '[MEGACAVE]' },
    { mode: 'compress', expected: '[CAVEMAN:COMPRESS]' },
  ] as const)('$mode', ({ mode, expected }) => {
    expect(badgeFor(mode)).toBe(expected);
  });
});
