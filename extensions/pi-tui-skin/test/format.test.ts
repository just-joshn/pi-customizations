import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test } from 'vitest';
import { formatElapsed } from '../src/format/duration.ts';
import { shortenHomePath, shortenPathForDisplay } from '../src/format/path.ts';
import { fitLeftRight, fitWidth, padToWidth } from '../src/format/width.ts';

const ESC = '\x1b';

describe('formatElapsed', () => {
  const cases: [number, string][] = [
    [0, '0ms'],
    [400, '400ms'],
    [1000, '1s'],
    [1500, '2s'],
    [59_500, '60s'],
    [60_000, '1m'],
    [61_000, '1m 1s'],
    [3_600_000, '60m'],
    [-5, '0s'],
    [Number.NaN, '0s'],
  ];

  test.each(cases)('formats %d ms', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });
});

describe('shortenHomePath', () => {
  test('shortens a path under home', () => {
    expect(shortenHomePath('/Users/x/proj', '/Users/x')).toBe('~/proj');
  });

  test('leaves a same-prefix sibling alone', () => {
    expect(shortenHomePath('/Users/xavier/proj', '/Users/x')).toBe('/Users/xavier/proj');
  });

  test('leaves an unrelated absolute path alone', () => {
    expect(shortenHomePath('/opt/data', '/Users/x')).toBe('/opt/data');
  });

  test('leaves a relative path alone', () => {
    expect(shortenHomePath('src/format/path.ts', '/Users/x')).toBe('src/format/path.ts');
  });

  test('renders home itself as tilde', () => {
    expect(shortenHomePath('/Users/x', '/Users/x')).toBe('~');
  });
});

describe('shortenPathForDisplay', () => {
  test('tails a long path to the display width', () => {
    const result = shortenPathForDisplay('/Users/x/proj/src/deep/file.ts', '/Users/x', 10);
    expect(result).toBe('…/file.ts');
    expect(visibleWidth(result)).toBeLessThanOrEqual(10);
  });

  test('returns the shortened path when it fits', () => {
    expect(shortenPathForDisplay('/Users/x/proj/file.ts', '/Users/x', 40)).toBe('~/proj/file.ts');
  });
});

describe('fitWidth', () => {
  test('keeps a short line unchanged', () => {
    expect(fitWidth('hello', 10)).toBe('hello');
    expect(fitWidth('hello', 20)).toBe('hello');
  });

  test('truncates with the ellipsis at width ten', () => {
    expect(stripTerminalSequences(fitWidth('hello world', 10))).toBe('hello wor…');
    expect(visibleWidth(fitWidth('hello world', 10))).toBe(10);
  });

  test('truncates at width four', () => {
    expect(stripTerminalSequences(fitWidth('abcdefgh', 4))).toBe('abc…');
    expect(visibleWidth(fitWidth('abcdefgh', 4))).toBe(4);
  });

  test('returns one ellipsis at width one', () => {
    expect(stripTerminalSequences(fitWidth('abcdefgh', 1))).toBe('…');
  });

  test('returns an empty line at width zero', () => {
    expect(fitWidth('abcdefgh', 0)).toBe('');
  });

  test('counts wide CJK characters by columns', () => {
    // biome-ignore lint/security/noSecrets: CJK sample text, not a secret
    const result = fitWidth('日本語テキスト', 5);
    expect(stripTerminalSequences(result)).toBe('日本…');
    expect(visibleWidth(result)).toBe(5);
  });

  test('measures an ANSI-colored line by visible width', () => {
    const result = fitWidth('\x1b[31mhello world\x1b[0m', 6);
    expect(result).toContain('…');
    expect(visibleWidth(result)).toBeLessThanOrEqual(6);
  });
});

describe('padToWidth', () => {
  test('pads a short line to the width', () => {
    expect(padToWidth('hi', 20)).toBe('hi                  ');
    expect(visibleWidth(padToWidth('hi', 10))).toBe(10);
  });

  test('never truncates a longer line', () => {
    expect(padToWidth('hello world', 4)).toBe('hello world');
  });

  test('leaves an exact fit unchanged', () => {
    expect(padToWidth('hello', 5)).toBe('hello');
  });
});

describe('fitLeftRight', () => {
  test('separates both parts with the minimum gap', () => {
    expect(fitLeftRight('left', 'right', 20)).toBe('left           right');
    expect(visibleWidth(fitLeftRight('left', 'right', 20))).toBe(20);
  });

  test('shortens the right part first', () => {
    expect(stripTerminalSequences(fitLeftRight('hello', 'world', 10))).toBe('hello   w…');
    expect(visibleWidth(fitLeftRight('hello', 'world', 10))).toBe(10);
  });

  test('shortens the left part when it cannot fit', () => {
    expect(stripTerminalSequences(fitLeftRight('abcdefgh', 'zz', 6))).toBe('abcde…');
  });

  test('fits a wide-character left part at width ten', () => {
    expect(stripTerminalSequences(fitLeftRight('日本語', 'ab', 10))).toBe('日本語   …');
    expect(visibleWidth(fitLeftRight('日本語', 'ab', 10))).toBe(10);
  });

  test('honors a wider requested gap', () => {
    expect(stripTerminalSequences(fitLeftRight('left', 'right', 13, 5))).toBe('left     rig…');
  });

  test('returns an empty line at width zero', () => {
    expect(fitLeftRight('left', 'right', 0)).toBe('');
  });

  test('fits inside width one', () => {
    expect(stripTerminalSequences(fitLeftRight('left', 'right', 1))).toBe('…');
  });

  test('measures an ANSI-colored left part by visible width', () => {
    const result = fitLeftRight(`${ESC}[31mred${ESC}[0m`, 'right', 20);
    expect(visibleWidth(result)).toBe(20);
    expect(result).toMatch(/right$/);
  });
});
